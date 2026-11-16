import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth';
import { DbModule } from './db/db.module';
import { LedgerModule } from './ledger/ledger.module';
import { LinksModule } from './links/links';
import { HealthModule } from './health/health';
import { WalletModule } from './wallet/wallet';
import { PaymentsModule } from './payments/payments.module';

@Module({ imports: [DbModule, LedgerModule, AuthModule, WalletModule, LinksModule, HealthModule, PaymentsModule] })
export class AppModule {}
