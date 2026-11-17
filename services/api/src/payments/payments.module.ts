import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth';
import { FinanceAdminGuard } from '../admin/finance-admin.guard';
import { LedgerModule } from '../ledger/ledger.module';
import { ProviderModule } from '../provider/provider';
import { PaymentIntentStore, paymentIntentStoreProvider } from './payment-intent.store';
import { PaymentOrchestrationService } from './payment-orchestration.service';
import {
  MerchantPayoutController, PaymentController, RefundAdminController, TestProviderWebhookController,
} from './payments.controller';

@Module({
  imports: [AuthModule, LedgerModule, ProviderModule],
  controllers: [PaymentController, TestProviderWebhookController, RefundAdminController, MerchantPayoutController],
  providers: [paymentIntentStoreProvider, PaymentOrchestrationService, FinanceAdminGuard],
  exports: [PaymentIntentStore, PaymentOrchestrationService],
})
export class PaymentsModule {}
