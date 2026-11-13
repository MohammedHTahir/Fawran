import '../config/load-env';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { BlnkLedgerAdapter } from './blnk-ledger.adapter';

async function main() {
  if (process.env.LEDGER_PROVIDER !== 'blnk') {
    throw new Error('Set LEDGER_PROVIDER=blnk before running ledger:reconcile');
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const adapter = app.get(BlnkLedgerAdapter);
    const result = await adapter.reconcilePending();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.pending || result.unknown) process.exitCode = 2;
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  process.stderr.write(`Blnk reconciliation failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
