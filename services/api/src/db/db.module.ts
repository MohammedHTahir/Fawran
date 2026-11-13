import { Global, Inject, Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';

export const PG_POOL = 'PG_POOL';
export const SYSTEM_PROVIDER_ACCOUNT = 'sys:provider';

const SCHEMA = `
create table if not exists users (
  id text primary key, phone text not null unique, created_at timestamptz not null default now());
create table if not exists accounts (
  id text primary key, owner_id text unique, kind text not null, currency text not null default 'EGP',
  balance bigint not null default 0, created_at timestamptz not null default now());
create unique index if not exists accounts_owner_unique on accounts(owner_id);
create table if not exists ledger_transactions (
  id text primary key, idem_key text not null unique, kind text not null, memo text,
  created_at timestamptz not null default now());
create table if not exists ledger_entries (
  id text primary key, txn_id text not null, account_id text not null, amount bigint not null);
alter table ledger_transactions add column if not exists request_fingerprint text;
create table if not exists ledger_account_mappings (
  local_account_id text primary key references accounts(id),
  blnk_balance_id text not null unique,
  ledger_id text not null,
  currency text not null default 'EGP',
  created_at timestamptz not null default now()
);
create table if not exists ledger_operations (
  idempotency_key text primary key,
  request_fingerprint text not null,
  blnk_reference text not null unique,
  status text not null check (status in ('processing','pending','applied','failed','unknown')),
  blnk_transaction_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ledger_operations_status_idx on ledger_operations(status, updated_at);
create table if not exists payment_attempts (
  idempotency_key text primary key,
  user_id text not null,
  request_fingerprint text not null,
  amount bigint not null check (amount > 0),
  method text not null,
  status text not null check (status in ('processing','succeeded','failed')),
  provider_ref text,
  ledger_txn_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists payment_links (
  id text primary key, code text not null unique, merchant_account text not null,
  amount bigint not null, description text, status text not null default 'open',
  paid_txn text, created_at timestamptz not null default now());
`;

@Injectable()
class DbBootstrap implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(PG_POOL) private pool: Pool) {}
  async onModuleDestroy() { await this.pool.end().catch(() => undefined); }
  async onModuleInit() {
    await this.pool.query(SCHEMA);
    await this.pool.query(
      `insert into accounts (id, kind) values ($1, 'system') on conflict (id) do nothing`,
      [SYSTEM_PROVIDER_ACCOUNT],
    );
  }
}

@Global()
@Module({
  providers: [
    { provide: PG_POOL, useFactory: () => new Pool({ connectionString: process.env.DATABASE_URL }) },
    DbBootstrap,
  ],
  exports: [PG_POOL],
})
export class DbModule {}
