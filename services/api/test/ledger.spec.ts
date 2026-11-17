import { LedgerService, InsufficientFunds } from '../src/ledger/ledger.service';
import { PG_POOL, SYSTEM_PROVIDER_ACCOUNT } from '../src/db/db.module';
import { makeApp } from './helpers';

describe('Ledger', () => {
  let ledger: LedgerService; let a: string; let b: string; let close: () => Promise<void>;
  beforeEach(async () => {
    const { app } = await makeApp();
    close = () => app.close();
    ledger = app.get(LedgerService);
    a = await ledger.createAccount(null); b = await ledger.createAccount(null);
    await ledger.transfer({ from: SYSTEM_PROVIDER_ACCOUNT, to: a, amount: 10_000, idemKey: 'seed-' + a, kind: 'topup' });
  });
  afterEach(() => close());

  it('moves money and stays balanced', async () => {
    await ledger.transfer({ from: a, to: b, amount: 2_500, idemKey: 'k1', kind: 'p2p' });
    expect(await ledger.balance(a)).toBe(7_500);
    expect(await ledger.balance(b)).toBe(2_500);
    expect((await ledger.verifyIntegrity()).ok).toBe(true);
  });

  it('rejects overdraft and writes nothing', async () => {
    await expect(ledger.transfer({ from: a, to: b, amount: 10_001, idemKey: 'k2', kind: 'p2p' })).rejects.toBeInstanceOf(InsufficientFunds);
    expect(await ledger.balance(a)).toBe(10_000);
    expect((await ledger.verifyIntegrity()).ok).toBe(true);
  });

  it('is idempotent: replaying a key does not move money twice', async () => {
    const t1 = await ledger.transfer({ from: a, to: b, amount: 1_000, idemKey: 'dup', kind: 'p2p' });
    const t2 = await ledger.transfer({ from: a, to: b, amount: 1_000, idemKey: 'dup', kind: 'p2p' });
    expect(t2.replayed).toBe(true); expect(t2.txnId).toBe(t1.txnId);
    expect(await ledger.balance(b)).toBe(1_000);
  });

  it('rejects reuse of an idempotency key with a different payload', async () => {
    await ledger.transfer({ from: a, to: b, amount: 1_000, idemKey: 'same-key', kind: 'p2p' });
    await expect(ledger.transfer({ from: a, to: b, amount: 2_000, idemKey: 'same-key', kind: 'p2p' }))
      .rejects.toThrow(/different or unverifiable request/);
    expect(await ledger.balance(b)).toBe(1_000);
  });

  it('isolates balances by currency and rejects cross-currency transfers', async () => {
    const pool = app.get(PG_POOL);
    await pool.query('insert into users(id,phone) values($1,$2),($3,$4)',
      ['multi-user-a','+201000000001','multi-user-b','+201000000002']);
    const aedSource = await ledger.createAccount(null, 'system', 'AED');
    const aedA = await ledger.createAccount('multi-user-a', 'user', 'AED');
    const aedB = await ledger.createAccount('multi-user-b', 'user', 'AED');
    const usd = await ledger.createAccount('multi-user-a', 'user', 'USD');
    await ledger.transfer({ from: aedSource, to: aedA, amount: 5_000, currency: 'AED',
      idemKey: 'seed-aed-' + aedA, kind: 'test_funding' });
    await ledger.transfer({ from: aedA, to: aedB, amount: 1_250, currency: 'AED',
      idemKey: 'aed-p2p-01', kind: 'p2p' });
    expect(await ledger.balance(aedA)).toBe(3_750);
    expect(await ledger.balance(aedB)).toBe(1_250);
    await expect(ledger.transfer({ from: aedA, to: usd, amount: 100,
      idemKey: 'cross-currency-01', kind: 'p2p' })).rejects.toThrow(/same currency/);
    expect((await ledger.history(aedB))[0].currency).toBe('AED');
    expect((await ledger.verifyIntegrity()).ok).toBe(true);
  });

  it('rejects invalid amounts and self-transfers', async () => {
    await expect(ledger.transfer({ from: a, to: b, amount: 0, idemKey: 'z', kind: 'p2p' })).rejects.toThrow();
    await expect(ledger.transfer({ from: a, to: b, amount: 1.5, idemKey: 'y', kind: 'p2p' })).rejects.toThrow();
    await expect(ledger.transfer({ from: a, to: a, amount: 100, idemKey: 'x', kind: 'p2p' })).rejects.toThrow();
  });
});
