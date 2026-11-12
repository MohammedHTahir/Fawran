// Runs only against a real Postgres: DATABASE_URL=postgres://... npm test
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { LedgerService } from '../src/ledger/ledger.service';
import { SYSTEM_PROVIDER_ACCOUNT } from '../src/db/db.module';

const d = process.env.DATABASE_URL ? describe : describe.skip;
d('Ledger concurrency (real Postgres)', () => {
  let app: any; let ledger: LedgerService;
  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    await app.init(); ledger = app.get(LedgerService);
  });
  afterAll(() => app.close());

  it('parallel double-spend: only one of 10 transfers of the full balance succeeds', async () => {
    const a = await ledger.createAccount(null); const b = await ledger.createAccount(null);
    await ledger.transfer({ from: SYSTEM_PROVIDER_ACCOUNT, to: a, amount: 10_000, idemKey: 'seed-' + a, kind: 'topup' });
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) =>
      ledger.transfer({ from: a, to: b, amount: 10_000, idemKey: `ds-${a}-${i}`, kind: 'p2p' })));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await ledger.balance(a)).toBe(0);
    expect(await ledger.balance(b)).toBe(10_000);
    expect((await ledger.verifyIntegrity()).ok).toBe(true);
  });

  it('parallel requests with the same idempotency key move money once', async () => {
    const a = await ledger.createAccount(null); const b = await ledger.createAccount(null);
    await ledger.transfer({ from: SYSTEM_PROVIDER_ACCOUNT, to: a, amount: 5_000, idemKey: 'seed-' + a, kind: 'topup' });
    const rs = await Promise.all(Array.from({ length: 10 }, () =>
      ledger.transfer({ from: a, to: b, amount: 1_000, idemKey: 'same-' + a, kind: 'p2p' })));
    expect(new Set(rs.map(r => r.txnId)).size).toBe(1);
    expect(await ledger.balance(b)).toBe(1_000);
    expect((await ledger.verifyIntegrity()).ok).toBe(true);
  });

  it('opposite-direction parallel transfers do not deadlock', async () => {
    const a = await ledger.createAccount(null); const b = await ledger.createAccount(null);
    for (const x of [a, b]) await ledger.transfer({ from: SYSTEM_PROVIDER_ACCOUNT, to: x, amount: 100_000, idemKey: 'seed-' + x, kind: 'topup' });
    await Promise.all(Array.from({ length: 20 }, (_, i) =>
      ledger.transfer(i % 2 ? { from: a, to: b, amount: 100, idemKey: `x-${a}-${i}`, kind: 'p2p' }
                          : { from: b, to: a, amount: 100, idemKey: `x-${a}-${i}`, kind: 'p2p' })));
    expect(await ledger.balance(a) + await ledger.balance(b)).toBe(200_000);
    expect((await ledger.verifyIntegrity()).ok).toBe(true);
  });
});
