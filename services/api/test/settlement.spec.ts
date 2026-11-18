import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { makeApp } from './helpers';
import { signTestProviderWebhook } from '../src/payments/test-payment.controller';

describe('test refunds, payouts and settlement reconciliation', () => {
  let app: INestApplication;
  let pool: any;
  let token: string;
  const secret = 'fawran-settlement-test-secret-at-least-32-bytes';
  const timestamp = () => Math.floor(Date.now() / 1000);
  const auth = (key?: string) => ({
    Authorization: `Bearer ${token}`,
    ...(key ? { 'Idempotency-Key': key } : {}),
  });
  const createIntent = async (key: string, amount: number, currency = 'AED') => {
    const response = await request(app.getHttpServer()).post('/payments/test/intents')
      .set(auth(key)).send({ amount, currency, method: 'card' }).expect(201);
    return response.body;
  };
  const markSucceeded = async (intent: any, eventId: string) => {
    const event = {
      eventId, eventType: 'payment.succeeded',
      paymentIntentId: intent.intentId, providerRef: intent.providerRef,
    };
    const raw = Buffer.from(JSON.stringify(event));
    await request(app.getHttpServer()).post('/webhooks/test-provider')
      .set('content-type', 'application/json')
      .set('x-test-provider-signature', signTestProviderWebhook(raw, secret, timestamp()))
      .send(raw.toString()).expect(201);
  };

  beforeAll(async () => {
    process.env.TEST_PROVIDER_WEBHOOK_SECRET = secret;
    ({ app, pool } = await makeApp());
    const phone = '+20 100 000 0101';
    await request(app.getHttpServer()).post('/auth/otp').send({ phone }).expect(201);
    const login = await request(app.getHttpServer()).post('/auth/verify').send({ phone, code: '000000' }).expect(201);
    token = login.body.token;
  });

  afterAll(async () => {
    await app.close();
    delete process.env.TEST_PROVIDER_WEBHOOK_SECRET;
  });

  it('creates idempotent test refunds and prevents cumulative over-refunds', async () => {
    const intent = await createIntent('settlement-refund-intent-01', 5000);
    await markSucceeded(intent, 'evt_refund_source_01');

    const body = { paymentIntentId: intent.intentId, amountMinor: 3000, currency: 'AED', reason: 'Customer requested refund' };
    const first = await request(app.getHttpServer()).post('/payments/test/refunds')
      .set(auth('refund-idempotency-01')).send(body).expect(201);
    expect(first.body).toMatchObject({ status: 'created', amountMinor: 3000, currency: 'AED', testMode: true, realMoney: false, ledgerPosted: false });

    const replay = await request(app.getHttpServer()).post('/payments/test/refunds')
      .set(auth('refund-idempotency-01')).send(body).expect(201);
    expect(replay.body.refundId).toBe(first.body.refundId);

    await request(app.getHttpServer()).post('/payments/test/refunds')
      .set(auth('refund-idempotency-01'))
      .send({ ...body, amountMinor: 2500 }).expect(409);
    await request(app.getHttpServer()).post('/payments/test/refunds')
      .set(auth('refund-idempotency-02'))
      .send({ ...body, amountMinor: 2500 }).expect(409);

    const stored = (await pool.query('select status,ledger_txn_id from payment_intents where id=$1', [intent.intentId])).rows[0];
    expect(stored).toEqual({ status: 'succeeded', ledger_txn_id: null });
  });

  it('records merchant payout requests as blocked and never sends a payout', async () => {
    const merchant = await request(app.getHttpServer()).post('/merchants').set(auth())
      .send({ legalName: 'Settlement Test LLC', displayName: 'Settlement Test', countryCode: 'AE', currency: 'AED' })
      .expect(201);
    const body = { amountMinor: 12000, currency: 'AED' };
    const first = await request(app.getHttpServer()).post(`/merchants/${merchant.body.merchantId}/test-payouts`)
      .set(auth('payout-idempotency-01')).send(body).expect(201);
    expect(first.body).toMatchObject({
      status: 'blocked', blockedReason: 'real_money_disabled_pending_approvals',
      testMode: true, realMoney: false, payoutSent: false,
    });
    const replay = await request(app.getHttpServer()).post(`/merchants/${merchant.body.merchantId}/test-payouts`)
      .set(auth('payout-idempotency-01')).send(body).expect(201);
    expect(replay.body.payoutId).toBe(first.body.payoutId);
    const stored = (await pool.query('select status,failure_code from payout_requests where id=$1', [first.body.payoutId])).rows[0];
    expect(stored).toEqual({ status: 'blocked', failure_code: 'real_money_disabled_pending_approvals' });
  });

  it('reconciles test settlement lines and records mismatches without posting a ledger entry', async () => {
    const matchedIntent = await createIntent('settlement-charge-001', 1000);
    const mismatchIntent = await createIntent('settlement-charge-002', 2000);
    await markSucceeded(matchedIntent, 'evt_settlement_charge_01');
    await markSucceeded(mismatchIntent, 'evt_settlement_charge_02');
    const payload = {
      batchId: 'test-settlement-batch-001',
      currency: 'AED',
      settlementDate: '2026-11-18',
      lines: [
        { providerRef: matchedIntent.providerRef, lineType: 'charge', grossAmountMinor: 1000, feeAmountMinor: 10, netAmountMinor: 990, currency: 'AED' },
        { providerRef: 'test_unknown_reference_01', lineType: 'charge', grossAmountMinor: 600, feeAmountMinor: 0, netAmountMinor: 600, currency: 'AED' },
        { providerRef: mismatchIntent.providerRef, lineType: 'charge', grossAmountMinor: 1999, feeAmountMinor: 10, netAmountMinor: 1989, currency: 'AED' },
        { providerRef: matchedIntent.providerRef, lineType: 'charge', grossAmountMinor: 1000, feeAmountMinor: 0, netAmountMinor: 1000, currency: 'EGP' },
        { providerRef: 'test_unknown_reference_01', lineType: 'charge', grossAmountMinor: 600, feeAmountMinor: 0, netAmountMinor: 600, currency: 'AED' },
      ],
    };
    const userId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).sub as string;
    await pool.query("insert into admin_roles(user_id,role) values($1,'finance_admin')", [userId]);

    const imported = await request(app.getHttpServer()).post('/admin/test-settlements/import')
      .set(auth()).send(payload).expect(201);
    expect(imported.body).toMatchObject({
      status: 'has_exceptions', lineCount: 5, matchedCount: 1, exceptionCount: 4,
      testMode: true, realMoney: false, ledgerPosted: false,
    });
    expect(imported.body.lines.map((line: any) => line.match_status)).toEqual([
      'matched', 'unmatched', 'amount_mismatch', 'currency_mismatch', 'duplicate',
    ]);

    const replay = await request(app.getHttpServer()).post('/admin/test-settlements/import')
      .set(auth()).send(payload).expect(201);
    expect(replay.body.id).toBe(imported.body.id);
    await request(app.getHttpServer()).post('/admin/test-settlements/import')
      .set(auth()).send({ ...payload, lines: payload.lines.slice(0, 1) }).expect(409);
    await request(app.getHttpServer()).get(`/admin/test-settlements/${imported.body.id}`)
      .set(auth()).expect(200);

    const stored = (await pool.query(
      'select ledger_txn_id from payment_intents where id=$1', [matchedIntent.intentId],
    )).rows[0];
    expect(stored.ledger_txn_id).toBeNull();
  });
});
