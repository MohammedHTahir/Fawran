import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth';
import { DbModule } from './db/db.module';
import { LedgerModule } from './ledger/ledger.module';
import { LinksModule } from './links/links';
import { HealthModule } from './health/health';
import { WalletModule } from './wallet/wallet';
import { PaymentsModule } from './payments/payments.module';
import { RewardsModule } from './rewards/rewards.module';
import { MerchantModule } from './merchants/merchants.module';
import { SettlementModule } from './settlement/settlement.module';
import { OperationsModule } from './operations/operations.module';

@Module({ imports: [DbModule, LedgerModule, AuthModule, WalletModule, LinksModule, HealthModule, PaymentsModule, RewardsModule, MerchantModule, SettlementModule, OperationsModule] })
export class AppModule {}
