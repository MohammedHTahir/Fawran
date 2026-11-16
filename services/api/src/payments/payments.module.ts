import { Module } from '@nestjs/common';
import { PaymentIntentStore, paymentIntentStoreProvider } from './payment-intent.store';

@Module({
  providers: [paymentIntentStoreProvider],
  exports: [PaymentIntentStore],
})
export class PaymentsModule {}
