import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth';
import { PaymentsModule } from '../payments/payments.module';
import { FinanceAdminGuard } from '../admin/finance-admin.guard';
import { SettlementService } from './settlement.service';
import { TestPayoutController, TestRefundController, TestSettlementAdminController } from './settlement.controller';

@Module({
  imports: [AuthModule, PaymentsModule],
  controllers: [TestRefundController, TestPayoutController, TestSettlementAdminController],
  providers: [FinanceAdminGuard, SettlementService],
  exports: [SettlementService],
})
export class SettlementModule {}
