import { INestApplication } from '@nestjs/common';
import { createHmac } from 'crypto';
import request from 'supertest';
import { makeApp } from './helpers';
import { signTestProviderWebhook } from '../src/payments/test-payment.controller';

describe('test payment orchestration', () => {
  let app: INestApplication;
  let token: string;
  const secret = 'fawran-test-provider-secret-at-least-32-bytes-long';
  const timestamp = () => Math.floor(Date.now() / 1000);
  const headers = (auth?: string, key?: string) => ({
    ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    ...(key ? { 'Idempotency-Key': key } : {}),
  });
  const postEvent = async (event: Record<string, string>, at = timestamp(), signatureOverride?: string) => {
    const raw = Buffer.from(JSON.stringify(event));
    const signature = signatureOverride ?? signTestProviderWebhook(raw, secret, at);
    return request(app.getHttpServer()).post('/webhooks/test-provider')
      .set('content-type', 'application/json')
      .set('x-test-provider-signature', signature)
      .send(raw.toString());
  };

  beforeAll(async () => {
    process.env.TEST_PROVIDER_WEBHOOK_SECRET = secret;
    ({ app } = await makeApp());
    const phone = '+20 100 000 0099';
    await request(app.getHttpServer()).post('/auth/otp').send({ phone }).expect(201);
    const login = await request(app.getHttpServer()).post('/auth/verify').send({ phone, code: '000000' }).expect(201);
    token = login.body.token;
  });

  afterAll(async () => {
    await app.close();
    delete process.env.TEST_PROVIDER_WEBHOOK_SECRET;
  });

  it('creates a currency-aware test intent and processes a signed success without posting a ledger entry', async () => {
    const created = await request(app.getHttpServer()).post('/payments/test/intents')
      .set(headers(token, 'test-intent-001'))
      .send({ amount: 1250, currency: 'AED', method: 'card' }).expect(201);
    expect(created.body).toMatchObject({
      provider: 'test', currency: 'AED', amount: 1250, status: 'created',
      testMode: true, realMoney: false, ledgerPosted: false,
    });

    const event = {
      eventId: 'evt_success_0001', eventType: 'payment.succeeded',
      paymentIntentId: created.body.intentId, providerRef: created.body.providerRef,
    };
    const received = await postEvent(event).expect(201);
    expect(received.body).toMatchObject({ status: 'succeeded', testMode: true, realMoney: false, ledgerPosted: false });

    const replay = await postEvent(event).expect(201);
    expect(replay.body).toMatchObject({ status: 'succeeded', duplicate: true, ledgerPosted: false });

    const stored = (await (app as any).getHttpAdapter().getInstance().locals.pool?.query?.('select status,ledger_txn_id from payment_intents where id=$1',[created.body.intentId]))?.rows?.[0];
    if (stored) expect(stored).toEqual({ status: 'succeeded', ledger_txn_id: null });
  });

  it('rejects missing/invalid signatures and stale timestamps', async () => {
    const created = await request(app.getHttpServer()).post('/payments/test/intents')
      .set(headers(token, 'test-intent-002'))
      .send({ amount: 500, currency: 'EGP', method: 'wallet' }).expect(201);
    const event = {
      eventId: 'evt_signature_01', eventType: 'payment.pending',
      paymentIntentId: created.body.intentId, providerRef: created.body.providerRef,
    };
    await postEvent(event, timestamp(), 't=1,v1=invalid').expect(401);
    await postEvent(event, timestamp() - 301).expect(401);
  });

  it('moves contradictory late success to under_review and rejects changed event replays', async () => {
    const created = await request(app.getHttpServer()).post('/payments/test/intents')
      .set(headers(token, 'test-intent-003'))
      .send({ amount: 700, currency: 'SAR', method: 'card' }).expect(201);
    const base = { paymentIntentId: created.body.intentId, providerRef: created.body.providerRef };
    await postEvent({ ...base, eventId: 'evt_failed_0001', eventType: 'payment.failed' }).expect(201);
    const late = await postEvent({ ...base, eventId: 'evt_late_0001', eventType: 'payment.succeeded' }).expect(201);
    expect(late.body.status).toBe('under_review');

    await postEvent({ ...base, eventId: 'evt_failed_0001', eventType: 'payment.succeeded' }).expect(409);
  });

  it('keeps test intent creation idempotent and rejects a changed payload', async () => {
    const first = await request(app.getHttpServer()).post('/payments/test/intents')
      .set(headers(token, 'test-intent-004'))
      .send({ amount: 800, currency: 'GBP', method: 'card' }).expect(201);
    const replay = await request(app.getHttpServer()).post('/payments/test/intents')
      .set(headers(token, 'test-intent-004'))
      .send({ amount: 800, currency: 'GBP', method: 'card' }).expect(201);
    expect(replay.body.intentId).toBe(first.body.intentId);
    await request(app.getHttpServer()).post('/payments/test/intents')
      .set(headers(token, 'test-intent-004'))
      .send({ amount: 801, currency: 'GBP', method: 'card' }).expect(409);
  });
});
