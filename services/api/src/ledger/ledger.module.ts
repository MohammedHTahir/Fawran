import { Global, Module } from '@nestjs/common';
import { BlnkLedgerAdapter } from './blnk-ledger.adapter';
import { LEDGER_PORT } from './ledger.port';
import { LedgerService } from './ledger.service';

@Global()
@Module({
  providers: [
    LedgerService,
    BlnkLedgerAdapter,
    {
      provide: LEDGER_PORT,
      useFactory: (postgres: LedgerService, blnk: BlnkLedgerAdapter) =>
        process.env.LEDGER_PROVIDER === 'blnk' ? blnk : postgres,
      inject: [LedgerService, BlnkLedgerAdapter],
    },
  ],
  exports: [LedgerService, BlnkLedgerAdapter, LEDGER_PORT],
})
export class LedgerModule {}
