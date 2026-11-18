import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { makeApp } from './helpers';

describe('test-only FX quotes', () => {
  let app: INestApplication;
  let pool: any;
  let token: string;
  let userId: string;
  const auth = (key?: string) => ({
    Authorization: `Bearer ${token}`,
    ...(key ? { 'Idempotency-Key': key } : {}),
  });

  beforeAll(async () => {
    ({ app, pool } = await makeApp());
    const phone = '+20 100 000 0401';
    await request(app.getHttpServer()).post('/auth/otp').send({ phone }).expect(201);
    const login = await request(app.getHttpServer()).post('/auth/verify').send({ phone, code: '000000' }).expect(201);
    token = login.body.token;
    userId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).sub;
    await pool.query("insert into admin_roles(user_id,role) values($1,'finance_admin')", [userId]);
  });

  afterAll(async () => { await app.close(); });

  it('calculates test FX quotes with integer arithmetic, fees and idempotency only', async () => {
    const before = Number((await pool.query('select count(*)::int as count from ledger_transactions')).rows[0].count);
    await request(app.getHttpServer()).post('/admin/fx/test-rates').set(auth()).send({
      fromCurrency: 'AED', toCurrency: 'EGP',
      rateNumerator: 2, rateDenominator: 1, feeBps: 100,
      sourceLabel: 'synthetic-aed-egp-v1',
    }).expect(201);

    const body = { fromCurrency: 'AED', toCurrency: 'EGP', amountMinor: 10000 };
    const first = await request(app.getHttpServer()).post('/fx/test/quotes')
      .set(auth('fx-quote-idempotency-01')).send(body).expect(201);
    expect(first.body).toMatchObject({
      fromCurrency: 'AED', toCurrency: 'EGP', sourceAmountMinor: 10000,
      grossTargetAmountMinor: 20000, feeTargetAmountMinor: 200,
      netTargetAmountMinor: 19800, rateNumerator: 2, rateDenominator: 1,
      feeBps: 100, rateSource: 'test:synthetic-aed-egp-v1',
      status: 'quoted', testOnly: true, executable: false, realMoney: false, ledgerPosted: false,
    });

    const replay = await request(app.getHttpServer()).post('/fx/test/quotes')
      .set(auth('fx-quote-idempotency-01')).send(body).expect(201);
    expect(replay.body.quoteId).toBe(first.body.quoteId);
    await request(app.getHttpServer()).post('/fx/test/quotes')
      .set(auth('fx-quote-idempotency-01')).send({ ...body, amountMinor: 11000 }).expect(409);

    const fetched = await request(app.getHttpServer()).get(`/fx/test/quotes/${first.body.quoteId}`)
      .set(auth()).expect(200);
    expect(fetched.body.netTargetAmountMinor).toBe(19800);

    const after = Number((await pool.query('select count(*)::int as count from ledger_transactions')).rows[0].count);
    expect(after).toBe(before);
  });

  it('rejects same-currency and unconfigured pairs, and expires quotes after five minutes', async () => {
    await request(app.getHttpServer()).post('/fx/test/quotes')
      .set(auth('fx-quote-invalid-01'))
      .send({ fromCurrency: 'AED', toCurrency: 'AED', amountMinor: 1000 }).expect(400);
    await request(app.getHttpServer()).post('/fx/test/quotes')
      .set(auth('fx-quote-invalid-02'))
      .send({ fromCurrency: 'GBP', toCurrency: 'USD', amountMinor: 1000 }).expect(409);

    const quote = await request(app.getHttpServer()).post('/fx/test/quotes')
      .set(auth('fx-quote-expire-01'))
      .send({ fromCurrency: 'AED', toCurrency: 'EGP', amountMinor: 5000 }).expect(201);
    await pool.query("update fx_quotes set expires_at=now()-interval '1 minute' where id=$1", [quote.body.quoteId]);
    const expired = await request(app.getHttpServer()).get(`/fx/test/quotes/${quote.body.quoteId}`)
      .set(auth()).expect(200);
    expect(expired.body.status).toBe('expired');
    expect(expired.body.executable).toBe(false);
  });
});
