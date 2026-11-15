import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { makeApp } from './helpers';

describe('API flow', () => {
  let app: INestApplication; let pool: any; let alice: string; let bob: string;
  const login = async (phone: string) => {
    await request(app.getHttpServer()).post('/auth/otp').send({ phone }).expect(201);
    const r = await request(app.getHttpServer()).post('/auth/verify').send({ phone, code: '000000' }).expect(201);
    return r.body.token as string;
  };
  beforeAll(async () => { ({ app, pool } = await makeApp()); alice = await login('+20 100 000 0001'); bob = await login('01000000002'); });
  afterAll(() => app.close());
  const h = (t: string, key?: string) => ({ Authorization: `Bearer ${t}`, ...(key ? { 'Idempotency-Key': key } : {}) });

  it('rejects bad phone numbers and missing auth', async () => {
    await request(app.getHttpServer()).post('/auth/otp').send({ phone: '12345' }).expect(400);
    await request(app.getHttpServer()).get('/wallet').expect(401);
  });

  it('top up, send money, replay is safe, overdraft blocked', async () => {
    const s = app.getHttpServer();
    await request(s).post('/wallet/topup').set(h(alice, 'topup-0001')).send({ amount: 50_000, method: 'instapay' }).expect(201);
    await request(s).post('/transfers').set(h(alice, 'send-0001')).send({ toPhone: '01000000002', amount: 20_000, note: 'rent' }).expect(201);
    const replay = await request(s).post('/transfers').set(h(alice, 'send-0001')).send({ toPhone: '01000000002', amount: 20_000, note: 'rent' }).expect(201);
    expect(replay.body.replayed).toBe(true);
    expect((await request(s).get('/wallet').set(h(alice))).body.balance).toBe(30_000);
    expect((await request(s).get('/wallet').set(h(bob))).body.balance).toBe(20_000);
    await request(s).post('/transfers').set(h(alice, 'send-0002')).send({ toPhone: '01000000002', amount: 99_999 }).expect(422);
    await request(s).post('/transfers').set(h(alice)).send({ toPhone: '01000000002', amount: 100 }).expect(400); // no idempotency key
    await request(s).post('/transfers').set(h(alice, 'send-0003')).send({ toPhone: '01099999999', amount: 100 }).expect(404);
  });

  it('top-up replay posts to the ledger once and rejects changed payloads', async () => {
    const s = app.getHttpServer();
    const first = await request(s).post('/wallet/topup').set(h(alice, 'topup-replay-01'))
      .send({ amount: 2_500, method: 'instapay' }).expect(201);
    const replay = await request(s).post('/wallet/topup').set(h(alice, 'topup-replay-01'))
      .send({ amount: 2_500, method: 'instapay' }).expect(201);
    expect(replay.body.txnId).toBe(first.body.txnId);
    expect(replay.body.replayed).toBe(true);
    await request(s).post('/wallet/topup').set(h(alice, 'topup-replay-01'))
      .send({ amount: 3_000, method: 'instapay' }).expect(400);
  });

  it('declined card top-up moves no money', async () => {
    await request(app.getHttpServer()).post('/wallet/topup').set(h(bob, 'topup-bad1')).send({ amount: 1313, method: 'card' }).expect(400);
    expect((await request(app.getHttpServer()).get('/wallet').set(h(bob))).body.balance).toBe(20_000);
  });

  it('payment link: payer without account pays once, merchant is credited', async () => {
    const s = app.getHttpServer();
    const link = (await request(s).post('/links').set(h(bob)).send({ amount: 85_000, description: 'Order 1024' }).expect(201)).body;
    const view = (await request(s).get(`/links/${link.code}`).expect(200)).body;
    expect(view).toEqual({ code: link.code, amount: 85_000, description: 'Order 1024', status: 'open' });
    await request(s).post(`/links/${link.code}/pay`).send({ method: 'instapay' }).expect(201);
    await request(s).post(`/links/${link.code}/pay`).send({ method: 'instapay' }).expect(409);
    expect((await request(s).get('/wallet').set(h(bob))).body.balance).toBe(105_000);
    const tx = (await request(s).get('/transactions').set(h(bob))).body;
    expect(tx.map((t: any) => t.kind)).toContain('link_payment');
  });

  it('declined link payment re-opens the link', async () => {
    const s = app.getHttpServer();
    const link = (await request(s).post('/links').set(h(bob)).send({ amount: 1313 }).expect(201)).body;
    await request(s).post(`/links/${link.code}/pay`).send({ method: 'card' }).expect(402);
    expect((await request(s).get(`/links/${link.code}`)).body.status).toBe('open');
  });

  it('recovers a top-up after the ledger posts but before the payment attempt is marked succeeded', async () => {
    const s = app.getHttpServer();
    const key = 'topup-crash-recovery';
    const before = (await request(s).get('/wallet').set(h(alice))).body.balance;
    const first = await request(s).post('/wallet/topup').set(h(alice, key))
      .send({ amount: 4_200, method: 'instapay' }).expect(201);
    const user = (await pool.query('select id from users where phone=$1', ['01000000001'])).rows[0];
    await pool.query(
      "update payment_attempts set status='processing', ledger_txn_id=null where idempotency_key=$1",
      [`${user.id}:topup:${key}`],
    );

    const recovered = await request(s).post('/wallet/topup').set(h(alice, key))
      .send({ amount: 4_200, method: 'instapay' }).expect(201);
    expect(recovered.body.txnId).toBe(first.body.txnId);
    expect(recovered.body.replayed).toBe(true);
    expect((await request(s).get('/wallet').set(h(alice))).body.balance).toBe(before + 4_200);
    const attempt = (await pool.query(
      'select status, ledger_txn_id from payment_attempts where idempotency_key=$1',
      [`${user.id}:topup:${key}`],
    )).rows[0];
    expect(attempt).toEqual({ status: 'succeeded', ledger_txn_id: first.body.txnId });
  });

  it('recovers a payment link after the ledger posts but before the link is marked paid', async () => {
    const s = app.getHttpServer();
    const before = (await request(s).get('/wallet').set(h(bob))).body.balance;
    const link = (await request(s).post('/links').set(h(bob))
      .send({ amount: 3_300, description: 'Crash recovery test' }).expect(201)).body;
    const first = await request(s).post(`/links/${link.code}/pay`)
      .send({ method: 'instapay' }).expect(201);

    await pool.query("update payment_links set status='processing', paid_txn=null where code=$1", [link.code]);
    const recovered = await request(s).post(`/links/${link.code}/pay`)
      .send({ method: 'instapay' }).expect(201);

    expect(recovered.body).toEqual({ status: 'paid', txnId: first.body.txnId });
    expect((await request(s).get('/wallet').set(h(bob))).body.balance).toBe(before + 3_300);
    expect((await request(s).get(`/links/${link.code}`)).body.status).toBe('paid');
  });

});
