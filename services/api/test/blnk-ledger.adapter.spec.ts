import { INestApplication } from '@nestjs/common';
import { BlnkLedgerAdapter } from '../src/ledger/blnk-ledger.adapter';
import { makeApp } from './helpers';

describe('BlnkLedgerAdapter', () => {
  let app: INestApplication;
  let pool: any;
  let adapter: BlnkLedgerAdapter;
  const originalFetch = global.fetch;
  const originalEnv = {
    BLNK_BASE_URL: process.env.BLNK_BASE_URL,
    BLNK_LEDGER_ID: process.env.BLNK_LEDGER_ID,
    BLNK_SYSTEM_BALANCE_ID: process.env.BLNK_SYSTEM_BALANCE_ID,
  };
  const remoteBalances = new Map<string, number>();
  const balanceIds = new Map<string, string>();
  const txns = new Map<string, any>();
  let nextBalance = 0;

  const json = (body: any, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });

  beforeAll(async () => {
    process.env.BLNK_BASE_URL = 'http://blnk.test';
    process.env.BLNK_LEDGER_ID = 'ldg_test';
    process.env.BLNK_SYSTEM_BALANCE_ID = 'bln_system';
    ({ app, pool } = await makeApp());
    adapter = new BlnkLedgerAdapter(pool);
    remoteBalances.set('bln_system', 1_000_000);
    global.fetch = jest.fn(async (input: any, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/balances/filter')) return json({ data: [] });
      if (url.endsWith('/balances') && method === 'POST') {
        const id = `bln_user_${++nextBalance}`;
        const payload = JSON.parse(String(init?.body));
        balanceIds.set(payload.meta_data.fawran_account_id, id);
        remoteBalances.set(id, 0);
        return json({ balance_id: id }, 201);
      }
      if (url.includes('/balances/') && method === 'GET') {
        const id = decodeURIComponent(url.split('/').pop()!);
        if (!remoteBalances.has(id)) return json({ error: 'not found' }, 404);
        return json({ balance: remoteBalances.get(id), ledger_id: 'ldg_test', currency: 'EGP' });
      }
      if (url.includes('/transactions/reference/')) {
        const ref = decodeURIComponent(url.split('/').pop()!);
        return txns.has(ref) ? json(txns.get(ref)) : json({ error_detail: { code: 'TXN_NOT_FOUND' } }, 404);
      }
      if (url.endsWith('/transactions') && method === 'POST') {
        const payload = JSON.parse(String(init?.body));
        if (txns.has(payload.reference)) return json({ error_detail: { code: 'TXN_DUPLICATE_REFERENCE' } }, 400);
        const amount = payload.precise_amount;
        if ((remoteBalances.get(payload.source) ?? 0) < amount) {
          return json({ error_detail: { code: 'TXN_INSUFFICIENT_FUNDS' } }, 400);
        }
        remoteBalances.set(payload.source, (remoteBalances.get(payload.source) ?? 0) - amount);
        remoteBalances.set(payload.destination, (remoteBalances.get(payload.destination) ?? 0) + amount);
        const txn = { transaction_id: 'txn_test_1', reference: payload.reference, status: 'APPLIED', precise_amount: amount };
        txns.set(payload.reference, txn);
        return json(txn, 201);
      }
      if (url.endsWith('/transactions/filter')) return json({ data: [] });
      return json({ error: 'unexpected test request', url, method }, 500);
    }) as any;
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await app.close();
  });

  it('creates a durable Fawran-to-Blnk balance mapping and reads integer piasters', async () => {
    const accountId = 'acct_blnk_test_1';
    await pool.query('insert into accounts (id, kind) values ($1, $2)', [accountId, 'user']);
    expect(await adapter.balance(accountId)).toBe(0);
    expect(balanceIds.get(accountId)).toBe('bln_user_1');
    const mapping = await pool.query('select blnk_balance_id from ledger_account_mappings where local_account_id=$1', [accountId]);
    expect(mapping.rows[0].blnk_balance_id).toBe('bln_user_1');
  });

  it('posts EGP piasters with precision 100 and replays the same idempotency key once', async () => {
    const from = 'sys:provider';
    const to = 'acct_blnk_test_1';
    const first = await adapter.transfer({ from, to, amount: 250, idemKey: 'adapter-test-transfer-01', kind: 'topup' });
    const replay = await adapter.transfer({ from, to, amount: 250, idemKey: 'adapter-test-transfer-01', kind: 'topup' });
    expect(first.txnId).toBe('txn_test_1');
    expect(first.replayed).toBe(false);
    expect(replay).toEqual({ txnId: 'txn_test_1', replayed: true });
    expect(await adapter.balance(to)).toBe(250);
    const post = (global.fetch as jest.Mock).mock.calls.find(([url, init]) =>
      String(url).endsWith('/transactions') && init?.method === 'POST');
    const body = JSON.parse(String(post[1].body));
    expect(body.precise_amount).toBe(250);
    expect(body.precision).toBe(100);
    expect(body.skip_queue).toBe(true);
  });

  it('rejects changed-payload reuse of an idempotency key', async () => {
    await expect(adapter.transfer({
      from: 'sys:provider', to: 'acct_blnk_test_1', amount: 251,
      idemKey: 'adapter-test-transfer-01', kind: 'topup',
    })).rejects.toThrow(/different request/);
  });
});
