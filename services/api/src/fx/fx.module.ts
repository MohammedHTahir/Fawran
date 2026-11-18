import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth';
import { FinanceAdminGuard } from '../admin/finance-admin.guard';
import { FxQuoteService } from './fx-quote.service';
import { TestFxQuoteController, TestFxRateAdminController } from './fx-quote.controller';

@Module({
  imports: [AuthModule],
  controllers: [TestFxQuoteController, TestFxRateAdminController],
  providers: [FinanceAdminGuard, FxQuoteService],
  exports: [FxQuoteService],
})
export class FxModule {}
