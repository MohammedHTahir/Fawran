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
  check (currency in ('AED','EGP','SAR','GBP','USD'));
alter table ledger_transactions add column if not exists currency text not null default 'EGP';
alter table ledger_transactions add constraint ledger_transactions_currency_code_check
  check (currency in ('AED','EGP','SAR','GBP','USD'));
alter table payment_attempts add column if not exists currency text not null default 'EGP';
alter table payment_attempts add constraint payment_attempts_currency_code_check
  check (currency in ('AED','EGP','SAR','GBP','USD'));
alter table payment_links add column if not exists currency text not null default 'EGP';
alter table payment_links add constraint payment_links_currency_code_check
  check (currency in ('AED','EGP','SAR','GBP','USD'));
alter table payment_intents drop constraint if exists payment_intents_currency_check;
-- pg-mem auto-names the inline legacy EGP-only check differently from PostgreSQL.
alter table payment_intents drop constraint if exists payment_intents_constraint_2;
alter table payment_intents add constraint payment_intents_currency_code_check
  check (currency in ('AED','EGP','SAR','GBP','USD'));
create index if not exists accounts_owner_currency_idx on accounts(owner_id, currency);
`,
}, {
  version: 7,
  name: 'rewards_points_ledger_and_campaign_foundation',
  sql: `
create table reward_accounts (
  id text primary key,
  owner_id text unique references users(id) on delete cascade,
  kind text not null check (kind in ('customer','issuance','redemption','expiry')),
  balance_points bigint not null default 0,
  lifetime_earned_points bigint not null default 0,
  tier text not null default 'starter' check (tier in ('starter','bronze','silver','gold')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'customer' or balance_points >= 0)
);

create table reward_transactions (
  id text primary key,
  idempotency_key text not null unique,
  request_fingerprint text not null,
  owner_id text not null references users(id) on delete restrict,
  kind text not null check (kind in ('earn','redeem','expire','reverse','adjust')),
  points bigint not null check (points > 0),
  reference text,
  campaign_id text,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index reward_transactions_owner_created_idx
  on reward_transactions(owner_id, created_at desc);

create table reward_entries (
  id text primary key,
  transaction_id text not null references reward_transactions(id) on delete restrict,
  account_id text not null references reward_accounts(id) on delete restrict,
  points_delta bigint not null check (points_delta <> 0),
  created_at timestamptz not null default now(),
  unique(transaction_id, account_id)
);

create table reward_lots (
  id text primary key,
  earn_transaction_id text not null unique references reward_transactions(id) on delete restrict,
  account_id text not null references reward_accounts(id) on delete restrict,
  points_issued bigint not null check (points_issued > 0),
  points_remaining bigint not null check (points_remaining >= 0 and points_remaining <= points_issued),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index reward_lots_available_idx
  on reward_lots(account_id, expires_at, created_at) where points_remaining > 0;

create table reward_invite_codes (
  owner_id text primary key references users(id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now()
);
create table reward_referrals (
  id text primary key,
  code text not null references reward_invite_codes(code) on delete restrict,
  inviter_user_id text not null references users(id) on delete restrict,
  invitee_user_id text not null unique references users(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','qualified','rewarded','void')),
  created_at timestamptz not null default now(),
  qualified_at timestamptz,
  rewarded_at timestamptz
);
create index reward_referrals_inviter_idx on reward_referrals(inviter_user_id, created_at desc);

create table reward_campaigns (
  id text primary key,
  owner_id text not null references users(id) on delete restrict,
  merchant_id text,
  name text not null,
  funding_source text not null check (funding_source in ('fawran','merchant')),
  currency text not null check (currency in ('AED','EGP','SAR','GBP','USD')),
  budget_minor bigint not null check (budget_minor > 0),
  spent_minor bigint not null default 0 check (spent_minor >= 0 and spent_minor <= budget_minor),
  points_per_minor integer not null check (points_per_minor > 0),
  max_points_per_user bigint,
  status text not null default 'draft' check (status in ('draft','pending_funding','active','paused','ended')),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  check (funding_source <> 'merchant' or merchant_id is not null)
);
create index reward_campaigns_status_dates_idx on reward_campaigns(status, starts_at, ends_at);

create table reward_tiers (
  tier text primary key check (tier in ('starter','bronze','silver','gold')),
  lifetime_points_required bigint not null unique check (lifetime_points_required >= 0)
);
insert into reward_tiers(tier, lifetime_points_required) values
  ('starter',0),('bronze',1000),('silver',10000),('gold',50000)
on conflict (tier) do nothing;
`,
}, {
  version: 8,
  name: 'merchant_accounts_kyb_and_admin_audit',
  sql: `
create table merchants (
  id text primary key,
  owner_user_id text not null references users(id) on delete restrict,
  legal_name text not null,
  display_name text not null,
  country_code text not null,
  currency text not null check (currency in ('AED','EGP','SAR','GBP','USD')),
  kyb_status text not null default 'not_started' check (kyb_status in ('not_started','pending','needs_info','approved','rejected')),
  status text not null default 'pending' check (status in ('pending','active','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index merchants_owner_created_idx on merchants(owner_user_id, created_at desc);

create table merchant_members (
  merchant_id text not null references merchants(id) on delete cascade,
  user_id text not null references users(id) on delete restrict,
  role text not null check (role in ('owner','admin','manager','viewer')),
  created_at timestamptz not null default now(),
  primary key(merchant_id,user_id)
);
create index merchant_members_user_idx on merchant_members(user_id, created_at desc);

create table merchant_kyb_cases (
  id text primary key,
  merchant_id text not null references merchants(id) on delete restrict,
  status text not null check (status in ('submitted','under_review','needs_info','approved','rejected')),
  submitted_by text not null references users(id) on delete restrict,
  document_types jsonb not null default '[]'::jsonb,
  registration_number text,
  reviewed_by text references users(id) on delete restrict,
  decision_reason text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index merchant_kyb_status_idx on merchant_kyb_cases(status, submitted_at);

create table merchant_accounts (
  id text primary key,
  merchant_id text not null references merchants(id) on delete restrict,
  currency text not null check (currency in ('AED','EGP','SAR','GBP','USD')),
  ledger_account_id text not null unique references accounts(id) on delete restrict,
  settlement_status text not null default 'blocked' check (settlement_status in ('blocked','pending_partner','active','suspended')),
  created_at timestamptz not null default now(),
  unique(merchant_id,currency)
);

create table merchant_stores (
  id text primary key,
  merchant_id text not null references merchants(id) on delete cascade,
  name text not null,
  country_code text not null,
  address text,
  status text not null default 'draft' check (status in ('draft','active','suspended')),
  created_at timestamptz not null default now()
);
create index merchant_stores_merchant_idx on merchant_stores(merchant_id, created_at desc);

create table merchant_offers (
  id text primary key,
  merchant_id text not null references merchants(id) on delete cascade,
  name text not null,
  description text,
  campaign_id text references reward_campaigns(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft','published','paused','ended')),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

alter table reward_campaigns add constraint reward_campaigns_merchant_fk
  foreign key (merchant_id) references merchants(id) on delete restrict;
alter table payment_links add column merchant_id text references merchants(id) on delete restrict;
create index payment_links_merchant_idx on payment_links(merchant_id, created_at desc);

create table admin_roles (
  user_id text not null references users(id) on delete cascade,
  role text not null check (role in ('super_admin','compliance_admin','support_admin','finance_admin')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key(user_id,role)
);
create table admin_audit_events (
  id text primary key,
  actor_user_id text not null references users(id) on delete restrict,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index admin_audit_events_created_idx on admin_audit_events(created_at desc);
`,
  }, {
    version: 9,
    name: 'test_refunds_payout_requests_and_settlement_reconciliation',
    sql: `
create table payment_refunds (
  id text primary key,
  payment_intent_id text not null references payment_intents(id) on delete restrict,
  user_id text not null references users(id) on delete restrict,
  amount bigint not null check (amount > 0),
  currency text not null check (currency in ('AED','EGP','SAR','GBP','USD')),
  reason text not null,
  idempotency_key text not null unique,
  request_fingerprint text not null,
  status text not null default 'created' check (status in ('created','pending','succeeded','failed','under_review')),
  provider_name text,
  provider_ref text,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider_name,provider_ref)
);
create index payment_refunds_intent_idx on payment_refunds(payment_intent_id,created_at desc);

create table payout_requests (
  id text primary key,
  merchant_id text not null references merchants(id) on delete restrict,
  requested_by text not null references users(id) on delete restrict,
  amount bigint not null check (amount > 0),
  currency text not null check (currency in ('AED','EGP','SAR','GBP','USD')),
  idempotency_key text not null unique,
  request_fingerprint text not null,
  status text not null default 'blocked' check (status in ('blocked','created','pending','succeeded','failed','under_review')),
  provider_name text,
  provider_ref text,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider_name,provider_ref)
);
create index payout_requests_merchant_idx on payout_requests(merchant_id,created_at desc);

create table settlement_batches (
  id text primary key,
  provider_name text not null,
  external_batch_id text not null,
  request_fingerprint text not null,
  currency text not null check (currency in ('AED','EGP','SAR','GBP','USD')),
  settlement_date date not null,
  status text not null default 'imported' check (status in ('imported','reconciled','has_exceptions')),
  imported_by text not null references users(id) on delete restrict,
  line_count integer not null default 0,
  matched_count integer not null default 0,
  exception_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique(provider_name,external_batch_id)
);
create index settlement_batches_created_idx on settlement_batches(created_at desc);

create table settlement_lines (
  id text primary key,
  batch_id text not null references settlement_batches(id) on delete restrict,
  line_number integer not null,
  provider_ref text not null,
  line_type text not null check (line_type in ('charge','refund','payout')),
  gross_amount_minor bigint not null check (gross_amount_minor > 0),
  fee_amount_minor bigint not null default 0 check (fee_amount_minor >= 0),
  net_amount_minor bigint not null check (net_amount_minor >= 0),
  currency text not null check (currency in ('AED','EGP','SAR','GBP','USD')),
  match_status text not null check (match_status in ('matched','unmatched','amount_mismatch','currency_mismatch','duplicate','invalid')),
  payment_intent_id text references payment_intents(id) on delete restrict,
  refund_id text references payment_refunds(id) on delete restrict,
  payout_id text references payout_requests(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(batch_id,line_number)
);
create index settlement_lines_batch_idx on settlement_lines(batch_id,line_number);

create table reconciliation_exceptions (
  id text primary key,
  batch_id text not null references settlement_batches(id) on delete restrict,
  settlement_line_id text not null references settlement_lines(id) on delete restrict,
  kind text not null check (kind in ('unmatched','amount_mismatch','currency_mismatch','duplicate','invalid')),
  details jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open','resolved','ignored')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text references users(id) on delete restrict
);
create index reconciliation_exceptions_status_idx on reconciliation_exceptions(status,created_at desc);
`,
  }, {
    version: 10,
    name: 'multi_market_risk_support_and_readiness_operations',
    sql: `
create table risk_cases (
  id text primary key,
  country_code text not null,
  category text not null check (category in ('fraud','aml','sanctions','account_takeover','transaction_anomaly','merchant_risk','other')),
  severity text not null check (severity in ('low','medium','high','critical')),
  status text not null default 'open' check (status in ('open','under_review','resolved','false_positive')),
  user_id text references users(id) on delete restrict,
  merchant_id text references merchants(id) on delete restrict,
  payment_intent_id text references payment_intents(id) on delete restrict,
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  created_by text not null references users(id) on delete restrict,
  assigned_to text references users(id) on delete restrict,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index risk_cases_queue_idx on risk_cases(status,severity,created_at desc);
create index risk_cases_user_idx on risk_cases(user_id,created_at desc);

create table support_cases (
  id text primary key,
  user_id text not null references users(id) on delete restrict,
  category text not null check (category in ('general','account','payment','merchant','security','other')),
  subject text not null,
  description text not null,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'open' check (status in ('open','in_progress','waiting_customer','resolved','closed')),
  assigned_to text references users(id) on delete restrict,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index support_cases_queue_idx on support_cases(status,priority,created_at desc);
create index support_cases_user_idx on support_cases(user_id,created_at desc);

create table market_gate_reviews (
  country_code text not null,
  currency text not null check (currency in ('AED','EGP','SAR','GBP','USD')),
  gate_key text not null check (gate_key in ('legal_opinion','regulatory_permission','licensed_partner','kyc_aml_controls','security_assessment','settlement_reconciliation','support_readiness','customer_disclosures')),
  status text not null default 'not_started' check (status in ('not_started','in_progress','blocked','verified')),
  evidence_reference text,
  submission_note text,
  submitted_by text references users(id) on delete restrict,
  submitted_at timestamptz,
  approved_by text references users(id) on delete restrict,
  approval_note text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(country_code,gate_key),
  check (status <> 'verified' or (evidence_reference is not null and submitted_by is not null and approved_by is not null and approved_at is not null))
);
create index market_gate_reviews_status_idx on market_gate_reviews(country_code,status);
`,
  }, {
    version: 11,
    name: 'multi_market_user_phone_and_default_currency',
    sql: `
alter table users add column if not exists country_code text not null default 'EG';
alter table users add column if not exists default_currency text not null default 'EGP';
-- Existing Egyptian national-format numbers are normalized to E.164 in place.
update users set phone = '+20' || substring(phone from 2)
 where phone ~ '^01[0125][0-9]{8}
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
;
alter table users add constraint users_country_currency_pair_check
 check (
   (country_code='AE' and default_currency='AED') or
   (country_code='EG' and default_currency='EGP') or
   (country_code='SA' and default_currency='SAR') or
   (country_code='GB' and default_currency='GBP') or
   (country_code='US' and default_currency='USD')
 );
create unique index if not exists users_phone_e164_unique on users(phone);
`,
  },
] as const;

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
