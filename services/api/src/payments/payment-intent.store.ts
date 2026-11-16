import { randomUUID } from 'crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
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
  method: string;
  requestFingerprint: string;
  expiresAt?: Date | null;
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
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
      throw new ConflictException('Payment intent amount must be a positive integer number of piasters');
    }
    const inserted = await this.pool.query(
      `insert into payment_intents
        (id, reference, idempotency_key, user_id, amount, method, request_fingerprint, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (idempotency_key) do nothing
       returning id, reference, idempotency_key, user_id, amount, currency, method, status,
                 provider_name, provider_ref, ledger_txn_id, created_at, updated_at`,
      [randomUUID(), input.reference, input.idempotencyKey, input.userId ?? null,
        input.amount, input.method, input.requestFingerprint, input.expiresAt ?? null],
    );
    if (inserted.rows[0]) return this.normalize(inserted.rows[0]);

    const existing = await this.pool.query(
      `select id, reference, idempotency_key, user_id, amount, currency, method, status,
              provider_name, provider_ref, ledger_txn_id, request_fingerprint, created_at, updated_at
         from payment_intents where idempotency_key=$1`,
      [input.idempotencyKey],
    );
    const row = existing.rows[0];
    if (!row || row.request_fingerprint !== input.requestFingerprint ||
        Number(row.amount) !== input.amount || row.method !== input.method ||
        (row.user_id ?? null) !== (input.userId ?? null)) {
      throw new ConflictException('Idempotency key was already used for a different payment intent');
    }
    return this.normalize(row);
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
