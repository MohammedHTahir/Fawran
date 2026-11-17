import { Pool } from 'pg';

type ConstraintMigration = { table: string; name: string; sql: string };

// Keep constraints separate from the base DDL so we can inspect the catalog and
// add only missing constraints. This works on PostgreSQL and lightweight test DBs
// without relying on PostgreSQL procedural DO blocks.
const INTEGRITY_CONSTRAINTS: ConstraintMigration[] = [
  { table: 'accounts', name: 'accounts_owner_fk', sql: `alter table accounts add constraint accounts_owner_fk foreign key (owner_id) references users(id) on delete restrict` },
  { table: 'ledger_entries', name: 'ledger_entries_txn_fk', sql: `alter table ledger_entries add constraint ledger_entries_txn_fk foreign key (txn_id) references ledger_transactions(id) on delete restrict` },
  { table: 'ledger_entries', name: 'ledger_entries_account_fk', sql: `alter table ledger_entries add constraint ledger_entries_account_fk foreign key (account_id) references accounts(id) on delete restrict` },
  { table: 'ledger_entries', name: 'ledger_entries_nonzero_amount', sql: `alter table ledger_entries add constraint ledger_entries_nonzero_amount check (amount <> 0)` },
  { table: 'ledger_account_mappings', name: 'ledger_account_mappings_account_fk', sql: `alter table ledger_account_mappings add constraint ledger_account_mappings_account_fk foreign key (local_account_id) references accounts(id) on delete restrict` },
  { table: 'ledger_operations', name: 'ledger_operations_status_check', sql: `alter table ledger_operations add constraint ledger_operations_status_check check (status in ('processing','pending','applied','failed','unknown'))` },
  { table: 'payment_attempts', name: 'payment_attempts_user_fk', sql: `alter table payment_attempts add constraint payment_attempts_user_fk foreign key (user_id) references users(id) on delete restrict` },
  { table: 'payment_attempts', name: 'payment_attempts_amount_check', sql: `alter table payment_attempts add constraint payment_attempts_amount_check check (amount > 0)` },
  { table: 'payment_attempts', name: 'payment_attempts_status_check', sql: `alter table payment_attempts add constraint payment_attempts_status_check check (status in ('processing','succeeded','failed'))` },
  { table: 'payment_links', name: 'payment_links_merchant_fk', sql: `alter table payment_links add constraint payment_links_merchant_fk foreign key (merchant_account) references accounts(id) on delete restrict` },
  { table: 'payment_links', name: 'payment_links_amount_check', sql: `alter table payment_links add constraint payment_links_amount_check check (amount > 0)` },
  { table: 'payment_links', name: 'payment_links_status_check', sql: `alter table payment_links add constraint payment_links_status_check check (status in ('open','processing','paid','cancelled','expired'))` },
];

export const MIGRATIONS = [{
  version: 1,
  name: 'initial_schema_and_integrity_constraints',
  sql: `
create table if not exists users (
  id text primary key, phone text not null unique, created_at timestamptz not null default now()
);
create table if not exists accounts (
  id text primary key, owner_id text unique, kind text not null, currency text not null default 'EGP',
  balance bigint not null default 0, created_at timestamptz not null default now()
);
create unique index if not exists accounts_owner_unique on accounts(owner_id);
create table if not exists ledger_transactions (
  id text primary key, idem_key text not null unique, kind text not null, memo text,
  created_at timestamptz not null default now()
);
alter table ledger_transactions add column if not exists request_fingerprint text;
create table if not exists ledger_entries (
  id text primary key, txn_id text not null, account_id text not null, amount bigint not null
);
create table if not exists ledger_account_mappings (
  local_account_id text primary key, blnk_balance_id text not null unique,
  ledger_id text not null, currency text not null default 'EGP', created_at timestamptz not null default now()
);
create table if not exists ledger_operations (
  idempotency_key text primary key, request_fingerprint text not null, blnk_reference text not null unique,
  status text not null, blnk_transaction_id text, last_error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists ledger_operations_status_idx on ledger_operations(status, updated_at);
create table if not exists payment_attempts (
  idempotency_key text primary key, user_id text not null, request_fingerprint text not null,
  amount bigint not null, method text not null, status text not null, provider_ref text, ledger_txn_id text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists payment_links (
  id text primary key, code text not null unique, merchant_account text not null, amount bigint not null,
  description text, status text not null default 'open', paid_txn text,
  created_at timestamptz not null default now()
);
insert into accounts (id, kind) values ('sys:provider', 'system') on conflict (id) do nothing;
`,
}, {
  version: 2,
  name: 'durable_otp_challenges_and_rate_limits',
  sql: `
create table if not exists otp_challenges (
  phone_key text primary key, code_digest text not null, expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0 and attempts <= 5),
  created_at timestamptz not null default now()
);
create table if not exists otp_rate_limits (
  scope text not null check (scope in ('phone','ip')), key_hash text not null,
  window_started_at timestamptz not null, request_count integer not null default 0 check (request_count >= 0),
  last_sent_at timestamptz, primary key(scope,key_hash)
);
create index if not exists otp_challenges_expiry_idx on otp_challenges(expires_at);
`,
}, {
  version: 3,
  name: 'otp_verification_ip_rate_limits',
  sql: `
create table if not exists otp_verify_rate_limits (
  ip_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0)
);
`,
}, {
  version: 4,
  name: 'rotating_auth_sessions',
  sql: `
create table if not exists auth_sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  refresh_token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists auth_sessions_user_active_idx on auth_sessions(user_id, revoked_at, expires_at);
create table if not exists auth_refresh_token_history (
  token_hash text primary key,
  session_id text not null references auth_sessions(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  used_at timestamptz not null default now()
);
create index if not exists auth_refresh_token_history_user_idx on auth_refresh_token_history(user_id);
`,
}, {
  version: 5,
  name: 'durable_payment_intents_and_provider_event_inbox',
  sql: `
create table if not exists payment_intents (
  id text primary key,
  reference text not null unique,
  idempotency_key text not null unique,
  user_id text references users(id) on delete restrict,
  amount bigint not null check (amount > 0),
  currency text not null default 'EGP' check (currency = 'EGP'),
  method text not null,
  status text not null default 'created'
    check (status in ('created','pending','succeeded','failed','reversed','under_review')),
  provider_name text,
  provider_ref text,
  ledger_txn_id text,
  request_fingerprint text not null,
  failure_code text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  succeeded_at timestamptz,
  reversed_at timestamptz
);
create unique index if not exists payment_intents_provider_ref_unique
  on payment_intents(provider_name, provider_ref)
  where provider_name is not null and provider_ref is not null;
create index if not exists payment_intents_status_updated_idx
  on payment_intents(status, updated_at);
create index if not exists payment_intents_user_created_idx
  on payment_intents(user_id, created_at desc);

create table if not exists provider_events (
  id text primary key,
  provider_name text not null,
  provider_event_id text not null,
  event_type text not null,
  payload_sha256 text not null,
  payment_intent_id text references payment_intents(id) on delete restrict,
  status text not null default 'received'
    check (status in ('received','processed','ignored','failed')),
  failure_code text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(provider_name, provider_event_id)
);
create index if not exists provider_events_pending_idx
  on provider_events(status, received_at);
create index if not exists provider_events_intent_idx
  on provider_events(payment_intent_id, received_at);
`,
}, {
  version: 6,
  name: 'multi_currency_accounts_and_payment_context',
  sql: `
-- Existing wallets remain EGP. No balance conversion or ledger rewrite occurs.
alter table accounts drop constraint if exists accounts_owner_id_key;
drop index if exists accounts_owner_unique;
create unique index if not exists accounts_owner_currency_unique
  on accounts(owner_id, currency) where owner_id is not null;
alter table accounts add constraint accounts_currency_code_check
  check (currency ~ '^[A-Z][A-Z][A-Z]$');
alter table ledger_transactions add column if not exists currency text not null default 'EGP';
alter table ledger_transactions add constraint ledger_transactions_currency_code_check
  check (currency ~ '^[A-Z][A-Z][A-Z]$');
alter table payment_attempts add column if not exists currency text not null default 'EGP';
alter table payment_attempts add constraint payment_attempts_currency_code_check
  check (currency ~ '^[A-Z][A-Z][A-Z]$');
alter table payment_links add column if not exists currency text not null default 'EGP';
alter table payment_links add constraint payment_links_currency_code_check
  check (currency ~ '^[A-Z][A-Z][A-Z]$');
alter table payment_intents drop constraint if exists payment_intents_currency_check;
alter table payment_intents add constraint payment_intents_currency_code_check
  check (currency ~ '^[A-Z][A-Z][A-Z]$');
create index if not exists accounts_owner_currency_idx on accounts(owner_id, currency);
`,
}] as const;

/** Run as an explicit deployment step, never during API startup. */
export async function runMigrations(pool: Pool): Promise<{ applied: number[]; current: number }> {
  await pool.query(`create table if not exists schema_migrations (
    version integer primary key, name text not null, applied_at timestamptz not null default now()
  )`);
  const applied: number[] = [];
  for (const migration of MIGRATIONS) {
    const existing = await pool.query('select version from schema_migrations where version=$1', [migration.version]);
    if (existing.rows.length) continue;
    const client = await pool.connect();
    try {
      await client.query('begin');
      const check = await client.query('select version from schema_migrations where version=$1', [migration.version]);
      if (!check.rows.length) {
        await client.query(migration.sql);
        for (const constraint of INTEGRITY_CONSTRAINTS) {
          const present = await client.query(
            'select constraint_name from information_schema.table_constraints where table_name = $1 and constraint_name = $2',
            [constraint.table, constraint.name],
          );
          if (!present.rows.length) {
            try {
              await client.query(constraint.sql);
            } catch (error) {
              // pg-mem can omit already-installed constraints from its
              // information_schema view. Ignore only a duplicate of this
              // exact named constraint; all other migration errors fail closed.
              const message = error instanceof Error ? error.message : String(error);
              if (!message.includes(constraint.name) || !/already exists|duplicate/i.test(message)) throw error;
            }
          }
        }
        await client.query('insert into schema_migrations(version,name) values($1,$2)', [migration.version, migration.name]);
        applied.push(migration.version);
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }
  const result = await pool.query('select coalesce(max(version),0)::int as version from schema_migrations');
  return { applied, current: Number(result.rows[0]?.version ?? 0) };
}

export async function assertMigrationsCurrent(pool: Pool): Promise<void> {
  const expected = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;
  let current = 0;
  try {
    const result = await pool.query('select coalesce(max(version),0)::int as version from schema_migrations');
    current = Number(result.rows[0]?.version ?? 0);
  } catch {
    throw new Error('Database migrations are missing. Run npm run db:migrate before starting the API.');
  }
  if (current !== expected) {
    throw new Error(`Database schema is at migration ${current}; expected ${expected}. Run npm run db:migrate before starting the API.`);
  }
}
