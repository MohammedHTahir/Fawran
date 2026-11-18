import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth';
import { AdminRoleGuard } from '../admin/admin-role.guard';
import {
  CustomerSupportController, MarketReadinessAdminController, OperationsAdminController,
  RiskAdminController, SupportAdminController,
} from './operations.controller';
import { OperationsService } from './operations.service';

@Module({
  imports: [AuthModule],
  controllers: [
    CustomerSupportController, OperationsAdminController, RiskAdminController,
    SupportAdminController, MarketReadinessAdminController,
  ],
  providers: [AdminRoleGuard, OperationsService],
  exports: [OperationsService],
})
export class OperationsModule {}
