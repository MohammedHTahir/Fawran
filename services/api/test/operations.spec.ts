import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { makeApp } from './helpers';

describe('multi-market operations controls', () => {
  let app: INestApplication;
  let pool: any;
  let customerToken: string;
  let supportAdminToken: string;
  let secondAdminToken: string;
  let customerId: string;
  let supportAdminId: string;
  let secondAdminId: string;

  const tokenUserId = (token: string) =>
    JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).sub as string;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const login = async (phone: string) => {
    await request(app.getHttpServer()).post('/auth/otp').send({ phone }).expect(201);
    const response = await request(app.getHttpServer()).post('/auth/verify').send({ phone, code: '000000' }).expect(201);
    return response.body.token as string;
  };

  beforeAll(async () => {
    ({ app, pool } = await makeApp());
    customerToken = await login('+20 100 000 0201');
    supportAdminToken = await login('+20 100 000 0202');
    secondAdminToken = await login('+20 100 000 0203');
    customerId = tokenUserId(customerToken);
    supportAdminId = tokenUserId(supportAdminToken);
    secondAdminId = tokenUserId(secondAdminToken);
    await pool.query("insert into admin_roles(user_id,role) values($1,'support_admin')", [supportAdminId]);
    await pool.query("insert into admin_roles(user_id,role) values($1,'compliance_admin')", [supportAdminId]);
    await pool.query("insert into admin_roles(user_id,role) values($1,'finance_admin')", [supportAdminId]);
    await pool.query("insert into admin_roles(user_id,role) values($1,'compliance_admin')", [secondAdminId]);
  });

  afterAll(async () => { await app.close(); });

  it('scopes customer support cases to the owner and allows support admins to manage the queue', async () => {
    const created = await request(app.getHttpServer()).post('/support/cases').set(auth(customerToken))
      .send({ category: 'payment', subject: 'Payment receipt missing', description: 'I completed a test payment but cannot see the receipt in my activity.' })
      .expect(201);
    expect(created.body).toMatchObject({ status: 'open', priority: 'normal' });

    const own = await request(app.getHttpServer()).get('/support/cases').set(auth(customerToken)).expect(200);
    expect(own.body).toHaveLength(1);
    expect(own.body[0].id).toBe(created.body.id);

    const other = await request(app.getHttpServer()).get('/support/cases').set(auth(secondAdminToken)).expect(200);
    expect(other.body).toHaveLength(0);

    const queue = await request(app.getHttpServer()).get('/admin/support/cases').set(auth(supportAdminToken)).expect(200);
    expect(queue.body.some((item: any) => item.id === created.body.id)).toBe(true);

    await request(app.getHttpServer()).post(`/admin/support/cases/${created.body.id}/status`)
      .set(auth(supportAdminToken)).send({ status: 'resolved', note: 'Receipt issue checked in test environment.' }).expect(201);
    const refreshed = await request(app.getHttpServer()).get('/support/cases').set(auth(customerToken)).expect(200);
    expect(refreshed.body[0].status).toBe('resolved');
  });

  it('creates and resolves compliance risk cases with an audit trail', async () => {
    const created = await request(app.getHttpServer()).post('/admin/risk-cases').set(auth(supportAdminToken))
      .send({
        countryCode: 'AE', category: 'aml', severity: 'high', userId: customerId,
        summary: 'Test transaction pattern requires compliance review',
        details: { source: 'automated_test', rule: 'velocity_review' },
      }).expect(201);
    expect(created.body).toMatchObject({ countryCode: 'AE', category: 'aml', severity: 'high', status: 'open' });

    const queue = await request(app.getHttpServer()).get('/admin/risk-cases?status=open').set(auth(supportAdminToken)).expect(200);
    expect(queue.body.some((item: any) => item.id === created.body.id)).toBe(true);

    await request(app.getHttpServer()).post(`/admin/risk-cases/${created.body.id}/decision`)
      .set(auth(supportAdminToken)).send({ status: 'resolved', note: 'Reviewed test case; no real customer funds involved.' }).expect(201);
  });

  it('enforces maker-checker market gates and never enables real-money operations', async () => {
    await request(app.getHttpServer()).post('/admin/markets/AE/gates/legal_opinion/submit')
      .set(auth(supportAdminToken))
      .send({ evidenceReference: 'evidence://ae/legal-opinion-v1', note: 'Legal review document submitted for independent approval.' })
      .expect(201);

    await request(app.getHttpServer()).post('/admin/markets/AE/gates/legal_opinion/approve')
      .set(auth(supportAdminToken)).send({ note: 'Cannot approve own submission.' }).expect(403);

    const approved = await request(app.getHttpServer()).post('/admin/markets/AE/gates/legal_opinion/approve')
      .set(auth(secondAdminToken)).send({ note: 'Independent reviewer checked the attached evidence reference.' }).expect(201);
    expect(approved.body).toMatchObject({ countryCode: 'AE', gateKey: 'legal_opinion', status: 'verified', realMoneyEnabled: false });

    const markets = await request(app.getHttpServer()).get('/admin/operations/markets').set(auth(supportAdminToken)).expect(200);
    const ae = markets.body.find((market: any) => market.countryCode === 'AE');
    expect(ae.realMoneyEnabled).toBe(false);
    expect(ae.readinessComplete).toBe(false);
    expect(ae.gates.find((gate: any) => gate.gate_key === 'legal_opinion').status).toBe('verified');

    const overview = await request(app.getHttpServer()).get('/admin/operations/overview').set(auth(supportAdminToken)).expect(200);
    expect(overview.body.realMoneyEnabled).toBe(false);
  });

  it('denies admin endpoints to customers without an active admin role and exposes audit history to admins', async () => {
    await request(app.getHttpServer()).get('/admin/operations/overview').set(auth(customerToken)).expect(403);
    const audit = await request(app.getHttpServer()).get('/admin/operations/audit').set(auth(supportAdminToken)).expect(200);
    expect(audit.body.some((event: any) => event.action === 'risk_case.created')).toBe(true);
    expect(audit.body.some((event: any) => event.action === 'market_gate.verified')).toBe(true);
  });
});
