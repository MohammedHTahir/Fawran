import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { makeApp } from './helpers';

describe('API flow', () => {
  let app: INestApplication; let alice: string; let bob: string;
  const login = async (phone: string) => {
    await request(app.getHttpServer()).post('/auth/otp').send({ phone }).expect(201);
    const r = await request(app.getHttpServer()).post('/auth/verify').send({ phone, code: '000000' }).expect(201);
    return r.body.token as string;
  };
  beforeAll(async () => { ({ app } = await makeApp()); alice = await login('+20 100 000 0001'); bob = await login('01000000002'); });
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
});
