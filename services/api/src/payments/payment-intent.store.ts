import { randomUUID } from 'crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { getMarketByCurrency } from '../markets/market-registry';
import {
  assertProviderEventReplayMatches,
  PaymentIntentStatus,
  transitionPaymentIntent,
} from './payment-lifecycle';

export interface CreatePaymentIntentInput {
  idempotencyKey: string;
  reference: string;
  userId?: string | null;
  amount: number;
  currency?: string;
  method: string;
  requestFingerprint: string;
  expiresAt?: Date | null;
  destinationAccountId?: string | null;
  purpose?: 'wallet_topup' | 'merchant_checkout' | 'other';
}

export interface RecordProviderEventInput {
  providerName: string;
  providerEventId: string;
  eventType: string;
  payloadSha256: string;
  paymentIntentId?: string | null;
}

@Injectable()
export class PaymentIntentStore {
  constructor(private readonly pool: Pool) {}

  async create(input: CreatePaymentIntentInput) {
    const currency = (input.currency ?? 'EGP').trim().toUpperCase();
    if (!getMarketByCurrency(currency)) throw new ConflictException('Payment intent currency is not in the supported market catalog');
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
      throw new ConflictException('Payment intent amount must be a positive integer number of currency minor units');
    }
    const inserted = await this.pool.query(
      `insert into payment_intents
        (id, reference, idempotency_key, user_id, amount, currency, method, request_fingerprint, expires_at, destination_account_id, purpose)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (idempotency_key) do nothing
       returning id, reference, idempotency_key, user_id, amount, currency, method, status,
                 provider_name, provider_ref, ledger_txn_id, destination_account_id, purpose, created_at, updated_at`,
      [randomUUID(), input.reference, input.idempotencyKey, input.userId ?? null,
        input.amount, currency, input.method, input.requestFingerprint, input.expiresAt ?? null,
        input.destinationAccountId ?? null, input.purpose ?? 'other'],
    );
    if (inserted.rows[0]) return this.normalize(inserted.rows[0]);

    const existing = await this.pool.query(
      `select id, reference, idempotency_key, user_id, amount, currency, method, status,
              provider_name, provider_ref, ledger_txn_id, destination_account_id, purpose, request_fingerprint, created_at, updated_at
         from payment_intents where idempotency_key=$1`,
      [input.idempotencyKey],
    );
    const row = existing.rows[0];
    if (!row || row.request_fingerprint !== input.requestFingerprint ||
        Number(row.amount) !== input.amount || (row.currency ?? 'EGP') !== currency || row.method !== input.method ||
        (row.user_id ?? null) !== (input.userId ?? null) ||
        (row.destination_account_id ?? null) !== (input.destinationAccountId ?? null) ||
        row.purpose !== (input.purpose ?? 'other')) {
      throw new ConflictException('Idempotency key was already used for a different payment intent');
    }
    return this.normalize(row);
  }

  async get(id: string) {
    const result = await this.pool.query(
      `select id,reference,idempotency_key,user_id,amount,currency,method,status,provider_name,provider_ref,
              ledger_txn_id,destination_account_id,purpose,created_at,updated_at
       from payment_intents where id=$1`,
      [id],
    );
    return result.rows[0] ? this.normalize(result.rows[0]) : null;
  }

  async setProviderResult(id: string, providerName: string, providerRef: string) {
    await this.pool.query(
      'update payment_intents set provider_name=$2,provider_ref=$3,updated_at=now() where id=$1',
      [id, providerName, providerRef],
    );
  }

  async setLedgerTransaction(id: string, ledgerTxnId: string) {
    await this.pool.query(
      'update payment_intents set ledger_txn_id=$2,updated_at=now() where id=$1',
      [id, ledgerTxnId],
    );
  }

  async recordProviderEvent(input: RecordProviderEventInput): Promise<{ inserted: boolean; eventId: string }> {
    const id = randomUUID();
    const inserted = await this.pool.query(
      `insert into provider_events
        (id, provider_name, provider_event_id, event_type, payload_sha256, payment_intent_id)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (provider_name, provider_event_id) do nothing
       returning id`,
      [id, input.providerName, input.providerEventId, input.eventType,
        input.payloadSha256.toLowerCase(), input.paymentIntentId ?? null],
    );
    if (inserted.rows[0]) return { inserted: true, eventId: id };

    const existing = await this.pool.query(
      'select id, payload_sha256 from provider_events where provider_name=$1 and provider_event_id=$2',
      [input.providerName, input.providerEventId],
    );
    if (!existing.rows[0]) throw new ConflictException('Provider event could not be recorded safely');
    try {
      assertProviderEventReplayMatches(existing.rows[0].payload_sha256, input.payloadSha256);
    } catch {
      throw new ConflictException('Provider event ID was replayed with a different payload');
    }
    return { inserted: false, eventId: existing.rows[0].id };
  }

  async transition(id: string, next: PaymentIntentStatus) {
    const currentResult = await this.pool.query(
      'select status from payment_intents where id=$1', [id],
    );
    if (!currentResult.rows[0]) throw new NotFoundException('Payment intent not found');
    const current = currentResult.rows[0].status as PaymentIntentStatus;
    let result;
    try {
      result = transitionPaymentIntent(current, next);
    } catch {
      throw new ConflictException('Payment intent transition is not permitted');
    }
    if (!result.changed) return { status: current, changed: false };

    const updated = await this.pool.query(
      `update payment_intents
          set status=$3, updated_at=now(),
              succeeded_at=case when $3='succeeded' then coalesce(succeeded_at, now()) else succeeded_at end,
              reversed_at=case when $3='reversed' then coalesce(reversed_at, now()) else reversed_at end
        where id=$1 and status=$2
        returning status`,
      [id, current, next],
    );
    if (!updated.rows[0]) {
      throw new ConflictException('Payment intent changed concurrently; reload before retrying');
    }
    return { status: next, changed: true };
  }

  private normalize(row: Record<string, unknown>): Record<string, unknown> & { id: string; amount: number } {
    return { ...row, id: String(row.id), amount: Number(row.amount) };
  }
}

/** Factory helper keeps the store independent from any concrete PSP. */
export const paymentIntentStoreProvider = {
  provide: PaymentIntentStore,
  useFactory: (pool: Pool) => new PaymentIntentStore(pool),
  inject: [PG_POOL],
};
