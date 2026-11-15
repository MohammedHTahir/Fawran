import '../config/load-env';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { LedgerService } from './ledger.service';

async function main() {
  if ((process.env.LEDGER_PROVIDER ?? 'postgres') !== 'postgres') {
    throw new Error('ledger:verify checks the PostgreSQL ledger only. Use ledger:reconcile for Blnk pending/unknown operations.');
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const ledger = app.get(LedgerService);
    const result = await ledger.verifyIntegrity();
    process.stdout.write(JSON.stringify(result, null, 2) + '\\n');
    if (!result.ok) process.exitCode = 2;
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  process.stderr.write(`Ledger integrity verification failed: ${error instanceof Error ? error.message : 'unknown error'}\\n`);
  process.exitCode = 1;
});
