import { Pool } from 'pg';

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

-- The legacy bootstrap may already have installed some or all of these constraints.
-- Guard each one independently so this migration is safe on both legacy and fresh databases.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'accounts_owner_fk' and conrelid = 'accounts'::regclass) then
    alter table accounts add constraint accounts_owner_fk
      foreign key (owner_id) references users(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ledger_entries_txn_fk' and conrelid = 'ledger_entries'::regclass) then
    alter table ledger_entries add constraint ledger_entries_txn_fk
      foreign key (txn_id) references ledger_transactions(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ledger_entries_account_fk' and conrelid = 'ledger_entries'::regclass) then
    alter table ledger_entries add constraint ledger_entries_account_fk
      foreign key (account_id) references accounts(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ledger_entries_nonzero_amount' and conrelid = 'ledger_entries'::regclass) then
    alter table ledger_entries add constraint ledger_entries_nonzero_amount check (amount <> 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ledger_account_mappings_account_fk' and conrelid = 'ledger_account_mappings'::regclass) then
    alter table ledger_account_mappings add constraint ledger_account_mappings_account_fk
      foreign key (local_account_id) references accounts(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ledger_operations_status_check' and conrelid = 'ledger_operations'::regclass) then
    alter table ledger_operations add constraint ledger_operations_status_check
      check (status in ('processing','pending','applied','failed','unknown'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payment_attempts_user_fk' and conrelid = 'payment_attempts'::regclass) then
    alter table payment_attempts add constraint payment_attempts_user_fk
      foreign key (user_id) references users(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payment_attempts_amount_check' and conrelid = 'payment_attempts'::regclass) then
    alter table payment_attempts add constraint payment_attempts_amount_check check (amount > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payment_attempts_status_check' and conrelid = 'payment_attempts'::regclass) then
    alter table payment_attempts add constraint payment_attempts_status_check
      check (status in ('processing','succeeded','failed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payment_links_merchant_fk' and conrelid = 'payment_links'::regclass) then
    alter table payment_links add constraint payment_links_merchant_fk
      foreign key (merchant_account) references accounts(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payment_links_amount_check' and conrelid = 'payment_links'::regclass) then
    alter table payment_links add constraint payment_links_amount_check check (amount > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payment_links_status_check' and conrelid = 'payment_links'::regclass) then
    alter table payment_links add constraint payment_links_status_check
      check (status in ('open','processing','paid','cancelled','expired'));
  end if;
end $$;

insert into accounts (id, kind) values ('sys:provider', 'system') on conflict (id) do nothing;
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
