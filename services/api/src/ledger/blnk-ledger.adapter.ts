import {
  BadRequestException, HttpException, Injectable, ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { Pool } from 'pg';
import { Inject } from '@nestjs/common';
import { PG_POOL, SYSTEM_PROVIDER_ACCOUNT } from '../db/db.module';
import { LedgerPort } from './ledger.port';
import { TransferInput } from './ledger.types';

const EGP_PRECISION = 100;
const TERMINAL_SUCCESS = new Set(['APPLIED']);
const PENDING = new Set(['QUEUED', 'INFLIGHT']);
type Json = Record<string, any>;

@Injectable()
export class BlnkLedgerAdapter implements LedgerPort {
  private readonly baseUrl: string;
  private readonly ledgerId: string;
  private readonly systemBalanceId: string;
  private readonly apiKey?: string;

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {
    this.baseUrl = (process.env.BLNK_BASE_URL ?? 'http://127.0.0.1:5001').replace(/\/+$/, '');
    this.ledgerId = process.env.BLNK_LEDGER_ID ?? '';
    this.systemBalanceId = process.env.BLNK_SYSTEM_BALANCE_ID ?? '';
    this.apiKey = process.env.BLNK_API_KEY;
  }

  private config() {
    if (!this.ledgerId) throw new ServiceUnavailableException('Blnk is selected but BLNK_LEDGER_ID is not configured');
    if (!this.systemBalanceId) throw new ServiceUnavailableException('Blnk is selected but BLNK_SYSTEM_BALANCE_ID is not configured');
  }

  private async request(path: string, init: RequestInit = {}): Promise<Json> {
    this.config();
    const headers = new Headers(init.headers);
    headers.set('content-type', 'application/json');
    if (this.apiKey) headers.set('X-blnk-key', this.apiKey);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init, headers, signal: init.signal ?? AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new ServiceUnavailableException(`Blnk request failed: ${error instanceof Error ? error.message : 'network error'}`);
    }
    const raw = await response.text();
    let body: Json = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = { message: raw }; }
    if (!response.ok) {
      const code = body.error_detail?.code ?? body.code;
      const message = body.error_detail?.message ?? body.error ?? body.message ?? `Blnk HTTP ${response.status}`;
      const error = new Error(String(message)) as Error & { status?: number; code?: string };
      error.status = response.status; error.code = code;
      throw error;
    }
    return body;
  }

  private async resolveBalance(localAccountId: string): Promise<string> {
    this.config();
    const known = await this.pool.query(
      'select blnk_balance_id from ledger_account_mappings where local_account_id=$1', [localAccountId]);
    if (known.rows[0]) return known.rows[0].blnk_balance_id as string;

    if (localAccountId === SYSTEM_PROVIDER_ACCOUNT) {
      await this.pool.query(
        `insert into ledger_account_mappings (local_account_id, blnk_balance_id, ledger_id, currency)
         values ($1,$2,$3,'EGP') on conflict (local_account_id) do nothing`,
        [localAccountId, this.systemBalanceId, this.ledgerId]);
      const saved = await this.pool.query(
        'select blnk_balance_id from ledger_account_mappings where local_account_id=$1', [localAccountId]);
      if (!saved.rows[0]) throw new ServiceUnavailableException('Unable to map the configured Blnk system balance');
      return saved.rows[0].blnk_balance_id as string;
    }

    // Serialize balance creation per Fawran account. The local account row is the
    // durable lock; if a process dies after Blnk creates the balance, the mapping
    // is written in this same DB transaction before another request can create one.
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const account = await client.query('select id, owner_id, kind from accounts where id=$1 for update', [localAccountId]);
      if (!account.rows[0]) throw new BadRequestException('Unknown account');
      const again = await client.query(
        'select blnk_balance_id from ledger_account_mappings where local_account_id=$1', [localAccountId]);
      if (again.rows[0]) {
        await client.query('commit');
        return again.rows[0].blnk_balance_id as string;
      }
      const recovered = await this.request('/balances/filter', {
        method: 'POST',
        body: JSON.stringify({ filters: [{ field: 'meta_data.fawran_account_id', operator: 'eq', value: localAccountId }], limit: 1 }),
      });
      const recoveredId = recovered.data?.[0]?.balance_id ?? recovered.data?.[0]?.id;
      const created = recoveredId ? { balance_id: recoveredId } : await this.request('/balances', {
        method: 'POST',
        body: JSON.stringify({
          ledger_id: this.ledgerId, currency: 'EGP',
          meta_data: { fawran_account_id: localAccountId, fawran_owner_id: account.rows[0].owner_id ?? '' },
        }),
      });
      const remoteId = created.balance_id ?? created.id;
      if (typeof remoteId !== 'string' || !remoteId) throw new ServiceUnavailableException('Blnk balance response omitted balance_id');
      await client.query(
        `insert into ledger_account_mappings (local_account_id, blnk_balance_id, ledger_id, currency)
         values ($1,$2,$3,'EGP')`,
        [localAccountId, remoteId, this.ledgerId]);
      await client.query('commit');
      return remoteId;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async createAccount(ownerId: string | null, kind = 'user'): Promise<string> {
    const id = randomUUID();
    await this.pool.query('insert into accounts (id, owner_id, kind) values ($1,$2,$3)', [id, ownerId, kind]);
    await this.resolveBalance(id);
    return id;
  }

  async balance(accountId: string): Promise<number> {
    const remoteId = await this.resolveBalance(accountId);
    const body = await this.request(`/balances/${encodeURIComponent(remoteId)}`);
    const value = body.balance;
    if (!Number.isSafeInteger(value)) throw new ServiceUnavailableException('Blnk returned a non-integer EGP balance');
    return value;
  }

  private reference(key: string): string {
    return `fawran_${createHash('sha256').update(key).digest('hex')}`;
  }

  private fingerprint(t: TransferInput): string {
    return createHash('sha256').update(JSON.stringify({
      from: t.from, to: t.to, amount: t.amount, kind: t.kind, memo: t.memo ?? null,
    })).digest('hex');
  }

  private async findByReference(reference: string): Promise<Json | null> {
    try {
      const result = await this.request(`/transactions/reference/${encodeURIComponent(reference)}`);
      return result.data ?? result;
    } catch (error: any) {
      if (error?.status === 404 || error?.code === 'TXN_NOT_FOUND') return null;
      throw error;
    }
  }

  private async persistOperation(key: string, fingerprint: string, reference: string) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `insert into ledger_operations (idempotency_key, request_fingerprint, blnk_reference, status)
         values ($1,$2,$3,'processing') on conflict (idempotency_key) do nothing`,
        [key, fingerprint, reference]);
      const result = await client.query(
        'select request_fingerprint, blnk_reference, status, blnk_transaction_id from ledger_operations where idempotency_key=$1 for update',
        [key]);
      const op = result.rows[0];
      if (!op || op.request_fingerprint !== fingerprint || op.blnk_reference !== reference) {
        throw new BadRequestException('Idempotency key was already used for a different request');
      }
      await client.query('commit');
      return op;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  private async markOperation(key: string, status: string, txnId?: string, message?: string) {
    await this.pool.query(
      `update ledger_operations set status=$2, blnk_transaction_id=coalesce($3,blnk_transaction_id),
       last_error=$4, updated_at=now() where idempotency_key=$1`,
      [key, status, txnId ?? null, message ?? null]);
  }

  async transfer(t: TransferInput): Promise<{ txnId: string; replayed: boolean }> {
    if (!Number.isSafeInteger(t.amount) || t.amount <= 0) throw new BadRequestException('Amount must be a positive integer (piasters)');
    if (t.from === t.to) throw new BadRequestException('Cannot transfer to the same account');
    if (!t.idemKey || t.idemKey.length > 512) throw new BadRequestException('Invalid idempotency key');
    const from = await this.resolveBalance(t.from);
    const to = await this.resolveBalance(t.to);
    const fingerprint = this.fingerprint(t);
    const reference = this.reference(t.idemKey);
    const op = await this.persistOperation(t.idemKey, fingerprint, reference);
    if (op.status === 'applied' && op.blnk_transaction_id) {
      return { txnId: op.blnk_transaction_id, replayed: true };
    }

    // Always resolve by the original stable reference before retrying. A previous
    // request may have reached Blnk even if the API process timed out.
    let result = await this.findByReference(reference);
    const replayed = Boolean(result || op.status === 'applied');
    if (!result) {
      try {
        result = await this.request('/transactions', {
          method: 'POST',
          body: JSON.stringify({
            precise_amount: t.amount, precision: EGP_PRECISION, currency: 'EGP',
            source: from, destination: to, reference, description: t.memo ?? t.kind,
            skip_queue: true, allow_overdraft: false,
            meta_data: { fawran_kind: t.kind },
          }),
        });
        result = result.data ?? result;
      } catch (error: any) {
        if (error?.code === 'TXN_DUPLICATE_REFERENCE' || error?.status === 409) {
          result = await this.findByReference(reference);
          if (!result) {
            await this.markOperation(t.idemKey, 'unknown', undefined, 'Duplicate reference reported but lookup returned no transaction');
            throw new ServiceUnavailableException('Blnk reported a duplicate reference but the original transaction could not be resolved');
          }
        } else {
          await this.markOperation(t.idemKey, 'unknown', undefined, String(error?.message ?? error));
          throw error;
        }
      }
    }

    const status = String(result.status ?? '').toUpperCase();
    const txnId = result.transaction_id ?? result.id;
    if (status === 'APPLIED' && typeof txnId === 'string') {
      await this.markOperation(t.idemKey, 'applied', txnId);
      return { txnId, replayed };
    }
    if (PENDING.has(status)) {
      await this.markOperation(t.idemKey, 'pending', typeof txnId === 'string' ? txnId : undefined);
      throw new ServiceUnavailableException('Transfer is pending in Blnk; retry with the same idempotency key to reconcile it');
    }
    if (status === 'REJECTED' || status === 'VOID') {
      await this.markOperation(t.idemKey, 'failed', typeof txnId === 'string' ? txnId : undefined, status);
      throw new HttpException(`Blnk rejected the transfer: ${status}`, 422);
    }
    await this.markOperation(t.idemKey, 'unknown', typeof txnId === 'string' ? txnId : undefined, `Unexpected Blnk status: ${status || 'missing'}`);
    throw new ServiceUnavailableException('Blnk returned an unrecognized transaction state; reconciliation is required');
  }

  async history(accountId: string, limit = 50) {
    const remoteId = await this.resolveBalance(accountId);
    const pageSize = Math.max(1, Math.min(100, Math.trunc(limit)));
    const [debits, credits] = await Promise.all([
      this.request('/transactions/filter', { method: 'POST', body: JSON.stringify({
        filters: [{ field: 'source', operator: 'eq', value: remoteId }],
        sort_by: 'created_at', sort_order: 'desc', limit: pageSize,
      }) }),
      this.request('/transactions/filter', { method: 'POST', body: JSON.stringify({
        filters: [{ field: 'destination', operator: 'eq', value: remoteId }],
        sort_by: 'created_at', sort_order: 'desc', limit: pageSize,
      }) }),
    ]);
    const rows = [...(debits.data ?? []), ...(credits.data ?? [])];
    const unique = new Map<string, any>();
    for (const row of rows) {
      const id = row.transaction_id ?? row.id;
      if (!id || unique.has(id) || row.status !== 'APPLIED') continue;
      const precise = row.precise_amount;
      if (!Number.isSafeInteger(precise)) continue;
      unique.set(id, {
        id, kind: row.meta_data?.fawran_kind ?? row.description ?? 'transfer',
        memo: row.description ?? null,
        createdAt: row.created_at,
        amount: row.source === remoteId ? -precise : precise,
      });
    }
    return [...unique.values()].sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, pageSize);
  }
}
