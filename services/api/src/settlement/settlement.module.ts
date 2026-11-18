import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth';
import { FinanceAdminGuard } from '../admin/finance-admin.guard';
import { SettlementService } from './settlement.service';
import { TestPayoutController, TestRefundController, TestSettlementAdminController } from './settlement.controller';

@Module({
  imports: [AuthModule],
  controllers: [TestRefundController, TestPayoutController, TestSettlementAdminController],
  providers: [FinanceAdminGuard, SettlementService],
  exports: [SettlementService],
})
export class SettlementModule {}
