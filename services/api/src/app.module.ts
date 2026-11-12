import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth';
import { DbModule } from './db/db.module';
import { LedgerModule } from './ledger/ledger.module';
import { LinksModule } from './links/links';
import { WalletModule } from './wallet/wallet';

@Module({ imports: [DbModule, LedgerModule, AuthModule, WalletModule, LinksModule] })
export class AppModule {}
