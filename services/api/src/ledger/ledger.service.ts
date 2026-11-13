import { HttpException, Inject, Injectable, BadRequestException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { LedgerPort } from './ledger.port';
import { TransferInput } from './ledger.types';

export class InsufficientFunds extends HttpException {
  constructor() { super('Insufficient funds', 422); }
}

/** Double-entry ledger. Every transaction has entries that sum to zero.
 *  accounts.balance is a cached value kept in the same DB transaction as the entries. */
@Injectable()
export class LedgerService implements LedgerPort {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  async createAccount(ownerId: string | null, kind = 'user'): Promise<string> {
    const id = randomUUID();
    await this.pool.query('insert into accounts (id, owner_id, kind) values ($1,$2,$3)', [id, ownerId, kind]);
    return id;
  }

  async balance(accountId: string): Promise<number> {
    const r = await this.pool.query('select balance from accounts where id=$1', [accountId]);
    if (!r.rows[0]) throw new BadRequestException('Unknown account');
    return Number(r.rows[0].balance);
  }

  async transfer(t: TransferInput): Promise<{ txnId: string; replayed: boolean }> {
    if (!Number.isSafeInteger(t.amount) || t.amount <= 0) throw new BadRequestException('Amount must be a positive integer (piasters)');
    if (t.from === t.to) throw new BadRequestException('Cannot transfer to the same account');
    const fingerprint = createHash('sha256').update(JSON.stringify({
      from: t.from, to: t.to, amount: t.amount, kind: t.kind, memo: t.memo ?? null,
    })).digest('hex');
    const existing = await this.findByKey(t.idemKey);
    if (existing) {
      await this.assertSameRequest(t.idemKey, fingerprint);
      return { txnId: existing, replayed: true };
    }

    const c = await this.pool.connect();
    try {
      await c.query('begin');
      // Lock both accounts in a stable order to avoid deadlocks.
      const locked = await c.query(
        'select id, kind, balance from accounts where id = $1 or id = $2 order by id for update', [t.from, t.to]);
      if (locked.rows.length !== 2) throw new BadRequestException('Unknown account');
      const from = locked.rows.find((r: any) => r.id === t.from);
      if (from.kind !== 'system' && Number(from.balance) < t.amount) throw new InsufficientFunds();

      const txnId = randomUUID();
      await c.query(
        'insert into ledger_transactions (id, idem_key, kind, memo, request_fingerprint) values ($1,$2,$3,$4,$5)',
        [txnId, t.idemKey, t.kind, t.memo ?? null, fingerprint]);
      await c.query('insert into ledger_entries (id, txn_id, account_id, amount) values ($1,$2,$3,$4)', [randomUUID(), txnId, t.from, -t.amount]);
      await c.query('insert into ledger_entries (id, txn_id, account_id, amount) values ($1,$2,$3,$4)', [randomUUID(), txnId, t.to, t.amount]);
      await c.query('update accounts set balance = balance + $2 where id = $1', [t.from, -t.amount]);
      await c.query('update accounts set balance = balance + $2 where id = $1', [t.to, t.amount]);
      await c.query('commit');
      return { txnId, replayed: false };
    } catch (e: any) {
      await c.query('rollback').catch(() => undefined);
      if (e?.code === '23505') { // concurrent request with the same idempotency key
        const id = await this.findByKey(t.idemKey);
        if (id) {
          await this.assertSameRequest(t.idemKey, fingerprint);
          return { txnId: id, replayed: true };
        }
      }
      throw e;
    } finally {
      c.release();
    }
  }

  private async assertSameRequest(key: string, fingerprint: string): Promise<void> {
    const r = await this.pool.query(
      'select request_fingerprint from ledger_transactions where idem_key=$1', [key]);
    const stored = r.rows[0]?.request_fingerprint;
    // Existing rows created before this migration have no fingerprint; they are not
    // safe to replay automatically because the original request cannot be verified.
    if (!stored || stored !== fingerprint) {
      throw new BadRequestException('Idempotency key was already used for a different or unverifiable request');
    }
  }

  private async findByKey(key: string): Promise<string | null> {
    const r = await this.pool.query('select id from ledger_transactions where idem_key=$1', [key]);
    return r.rows[0]?.id ?? null;
  }

  async history(accountId: string, limit = 50) {
    const r = await this.pool.query(
      `select t.id, t.kind, t.memo, t.created_at, e.amount
         from ledger_entries e join ledger_transactions t on t.id = e.txn_id
        where e.account_id = $1 order by t.created_at desc limit $2`, [accountId, limit]);
    return r.rows.map((x: any) => ({ id: x.id, kind: x.kind, memo: x.memo, createdAt: x.created_at, amount: Number(x.amount) }));
  }

  /** Reconciliation check: cached balances match entries, and every transaction sums to zero. */
  async verifyIntegrity() {
    const bal = await this.pool.query(
      `select a.id, a.balance, coalesce(sum(e.amount),0) as total
         from accounts a left join ledger_entries e on e.account_id = a.id group by a.id, a.balance`);
    const bad = bal.rows.filter((r: any) => Number(r.balance) !== Number(r.total)).map((r: any) => r.id);
    const sums = await this.pool.query('select txn_id, sum(amount) as total from ledger_entries group by txn_id');
    const unbalanced = { rows: sums.rows.filter((r: any) => Number(r.total) !== 0) };
    return { ok: bad.length === 0 && unbalanced.rows.length === 0, badAccounts: bad, unbalancedTxns: unbalanced.rows.map((r: any) => r.txn_id) };
  }
}
