import { INestApplication } from '@nestjs/common';
import { createHmac } from 'crypto';
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

  it('persists OTP challenges, enforces resend cooldown, and consumes a code once', async () => {
    const phone = '01000000031';
    await request(app.getHttpServer()).post('/auth/otp').send({ phone }).expect(201);
    const key = createHmac('sha256', 'dev-only-otp-pepper-change-before-deployment').update(phone).digest('hex');
    const challenge = (await pool.query('select phone_key, attempts, expires_at from otp_challenges where phone_key=$1',[key])).rows[0];
    expect(challenge).toBeTruthy();
    expect(challenge.attempts).toBe(0);
    expect(new Date(challenge.expires_at).getTime()).toBeGreaterThan(Date.now());
    await request(app.getHttpServer()).post('/auth/otp').send({ phone }).expect(400);
    await request(app.getHttpServer()).post('/auth/verify').send({ phone, code: '000000' }).expect(201);
    expect((await pool.query('select phone_key from otp_challenges where phone_key=$1',[key])).rows).toHaveLength(0);
    await request(app.getHttpServer()).post('/auth/verify').send({ phone, code: '000000' }).expect(401);
  });

  it('throttles OTP verification attempts across phone numbers from one IP', async () => {
    const phone = '01000000033';
    await request(app.getHttpServer()).post('/auth/otp').send({ phone }).expect(201);
    await pool.query('delete from otp_verify_rate_limits');
    for (let i = 0; i < 30; i++) {
      await request(app.getHttpServer()).post('/auth/verify').send({ phone, code: '111111' }).expect(401);
    }
    await request(app.getHttpServer()).post('/auth/verify').send({ phone, code: '111111' }).expect(429);
    await pool.query('delete from otp_verify_rate_limits');
  });

  it('limits OTP verification attempts and rejects malformed codes', async () => {
    const phone = '01000000032';
    await request(app.getHttpServer()).post('/auth/otp').send({ phone }).expect(201);
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).post('/auth/verify').send({ phone, code: '111111' }).expect(401);
    }
    await request(app.getHttpServer()).post('/auth/verify').send({ phone, code: '000000' }).expect(401);
    await request(app.getHttpServer()).post('/auth/verify').send({ phone, code: '123' }).expect(400);
  });

  it('rotates refresh tokens and revokes the session when an old token is reused', async () => {
    const phone = '01000000034';
    await request(app.getHttpServer()).post('/auth/otp').send({ phone }).expect(201);
    const first = await request(app.getHttpServer()).post('/auth/verify').send({ phone, code:'000000' }).expect(201);
    expect(first.body.refreshToken).toBeTruthy();
    expect(first.body.expiresAt).toBeTruthy();
    await request(app.getHttpServer()).get('/wallet').set('Authorization',`Bearer ${first.body.token}`).expect(200);

    const rotated = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken:first.body.refreshToken }).expect(201);
    expect(rotated.body.refreshToken).toBeTruthy();
    expect(rotated.body.refreshToken).not.toBe(first.body.refreshToken);
    const rotatedAgain = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken:rotated.body.refreshToken }).expect(201);
    expect(rotatedAgain.body.refreshToken).not.toBe(rotated.body.refreshToken);
    await request(app.getHttpServer()).get('/wallet').set('Authorization',`Bearer ${rotatedAgain.body.token}`).expect(200);

    // Replaying a token from two rotations ago must still be detected.
    await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken:first.body.refreshToken }).expect(401);
    await request(app.getHttpServer()).get('/wallet').set('Authorization',`Bearer ${rotatedAgain.body.token}`).expect(401);
    await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken:rotatedAgain.body.refreshToken }).expect(401);
  });

  it('lists sessions and logout immediately revokes the active access token', async () => {
    const phone = '01000000035';
    await request(app.getHttpServer()).post('/auth/otp').send({ phone }).expect(201);
    const login = await request(app.getHttpServer()).post('/auth/verify').send({ phone, code:'000000' }).expect(201);
    const headers = { Authorization:`Bearer ${login.body.token}` };
    const sessions = await request(app.getHttpServer()).get('/auth/sessions').set(headers).expect(200);
    expect(sessions.body).toHaveLength(1);
    expect(sessions.body[0].id).toBeTruthy();
    await request(app.getHttpServer()).post('/auth/logout').set(headers).send({}).expect(201);
    await request(app.getHttpServer()).get('/wallet').set(headers).expect(401);
    await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken:login.body.refreshToken }).expect(401);
  });

});
