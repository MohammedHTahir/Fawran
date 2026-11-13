import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { BlnkLedgerAdapter } from '../src/ledger/blnk-ledger.adapter';
import { makeApp } from './helpers';

const enabled = process.env.BLNK_INTEGRATION === '1';
const suite = enabled ? describe : describe.skip;

suite('Blnk Core live integration (pinned local Core)', () => {
  let app: INestApplication;
  let pool: any;
  let adapter: BlnkLedgerAdapter;
  let ledgerId: string;
  let systemBalanceId: string;
  let accountId: string;
  const baseUrl = process.env.BLNK_BASE_URL ?? 'http://127.0.0.1:5001';

  async function call(path: string, body?: any) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const data = await response.json() as any;
    if (!response.ok) throw new Error(`Blnk ${path} failed (${response.status}): ${JSON.stringify(data)}`);
    return data;
  }

  beforeAll(async () => {
    ({ app, pool } = await makeApp());
    ledgerId = (await call('/ledgers', { name: `Fawran CI ${randomUUID()}` })).ledger_id;
    systemBalanceId = (await call('/balances', { ledger_id: ledgerId, currency: 'EGP' })).balance_id;
    const fundingBalanceId = (await call('/balances', { ledger_id: ledgerId, currency: 'EGP' })).balance_id;
    const seed = await call('/transactions', {
      precise_amount: 100_000, precision: 100, currency: 'EGP',
      source: fundingBalanceId, destination: systemBalanceId,
      reference: `fawran-ci-seed-${randomUUID()}`,
      description: 'Disposable CI funding', allow_overdraft: true, skip_queue: true,
    });
    expect(seed.status).toBe('APPLIED');
    process.env.BLNK_BASE_URL = baseUrl;
    process.env.BLNK_LEDGER_ID = ledgerId;
    process.env.BLNK_SYSTEM_BALANCE_ID = systemBalanceId;
    adapter = new BlnkLedgerAdapter(pool);
    accountId = `acct_ci_${randomUUID()}`;
    await pool.query('insert into accounts (id, kind) values ($1, $2)', [accountId, 'user']);
  }, 90_000);

  afterAll(async () => {
    await app?.close();
  });

  it('creates a real Blnk balance, handles concurrent idempotency, and reads history', async () => {
    expect(await adapter.balance(accountId)).toBe(0);
    const input = {
      from: 'sys:provider', to: accountId, amount: 1_237,
      idemKey: `ci-transfer-${randomUUID()}`, kind: 'integration_test',
    };
    const results = await Promise.all([adapter.transfer(input), adapter.transfer(input)]);
    expect(results[0].txnId).toBe(results[1].txnId);
    expect(results.filter(result => !result.replayed)).toHaveLength(1);
    expect(await adapter.balance(accountId)).toBe(1_237);
    const history = await adapter.history(accountId);
    console.log('Blnk integration history:', JSON.stringify(history));
    const mapping = await pool.query('select blnk_balance_id from ledger_account_mappings where local_account_id=$1', [accountId]);
    const rawFilter = await call('/transactions/filter', {
      filters: [{ field: 'destination', operator: 'eq', value: mapping.rows[0].blnk_balance_id }],
      sort_by: 'created_at', sort_order: 'desc', limit: 10,
    });
    console.log('Blnk raw history filter:', JSON.stringify(rawFilter));
    expect(history.some(row => row.amount === 1_237)).toBe(true);
    await expect(adapter.transfer({ ...input, amount: 1_238 })).rejects.toThrow(/different request/);
  });});
