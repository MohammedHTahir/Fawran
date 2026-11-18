import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth';
import { PaymentIntentStore, paymentIntentStoreProvider } from './payment-intent.store';
import { TestPaymentIntentController, TestProviderWebhookController } from './test-payment.controller';
import { TestPaymentService } from './test-payment.service';

@Module({
  imports: [AuthModule],
  controllers: [TestPaymentIntentController, TestProviderWebhookController],
  providers: [paymentIntentStoreProvider, TestPaymentService],
  exports: [PaymentIntentStore, TestPaymentService],
})
export class PaymentsModule {}
