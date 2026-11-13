import { Global, Module } from '@nestjs/common';
import { LEDGER_PORT } from './ledger.port';
import { LedgerService } from './ledger.service';

@Global()
@Module({
  providers: [
    LedgerService,
    { provide: LEDGER_PORT, useExisting: LedgerService },
  ],
  exports: [LedgerService, LEDGER_PORT],
})
export class LedgerModule {}
