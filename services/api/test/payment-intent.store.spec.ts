import { Pool } from 'pg';
import { ConflictException } from '@nestjs/common';
import { PaymentIntentStore } from '../src/payments/payment-intent.store';

describe('PaymentIntentStore', () => {
  const pool = { query: jest.fn() } as unknown as Pool;
  let store: PaymentIntentStore;

  beforeEach(() => {
    jest.clearAllMocks();
    store = new PaymentIntentStore(pool);
  });

  it('creates a durable intent using integer piasters', async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [{ id: 'intent-1', amount: '2500', status: 'created' }],
    });
    const result = await store.create({
      idempotencyKey: 'user:funding:abc12345',
      reference: 'funding-abc12345',
      userId: 'user-1',
      amount: 2500,
      method: 'card',
      requestFingerprint: 'fingerprint',
    });
    expect(result.amount).toBe(2500);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('insert into payment_intents'), expect.any(Array));
  });

  it('returns the existing intent for a matching idempotent retry', async () => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        id: 'intent-1', amount: '2500', method: 'card', user_id: 'user-1',
        request_fingerprint: 'fingerprint',
      }] });
    const result = await store.create({
      idempotencyKey: 'user:funding:abc12345',
      reference: 'funding-new-reference-is-ignored',
      userId: 'user-1',
      amount: 2500,
      method: 'card',
      requestFingerprint: 'fingerprint',
    });
    expect(result.id).toBe('intent-1');
  });

  it('rejects an idempotency key reused with a different request', async () => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        id: 'intent-1', amount: '2500', method: 'card', user_id: 'user-1',
        request_fingerprint: 'original',
      }] });
    await expect(store.create({
      idempotencyKey: 'user:funding:abc12345',
      reference: 'funding-abc12345',
      userId: 'user-1',
      amount: 3000,
      method: 'card',
      requestFingerprint: 'changed',
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('records provider events once and treats same-digest retries as duplicates', async () => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'event-1', payload_sha256: 'a'.repeat(64) }] });
    const result = await store.recordProviderEvent({
      providerName: 'example-psp',
      providerEventId: 'evt-1',
      eventType: 'payment.succeeded',
      payloadSha256: 'a'.repeat(64),
    });
    expect(result).toEqual({ inserted: false, eventId: 'event-1' });
  });

  it('rejects a provider event ID replayed with a different digest', async () => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'event-1', payload_sha256: 'a'.repeat(64) }] });
    await expect(store.recordProviderEvent({
      providerName: 'example-psp',
      providerEventId: 'evt-1',
      eventType: 'payment.succeeded',
      payloadSha256: 'b'.repeat(64),
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('uses compare-and-set to avoid overwriting a concurrent intent transition', async () => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ status: 'pending' }] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(store.transition('intent-1', 'succeeded'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(pool.query).toHaveBeenLastCalledWith(
      expect.stringContaining('where id=$1 and status=$2'),
      ['intent-1', 'pending', 'succeeded'],
    );
  });
});
