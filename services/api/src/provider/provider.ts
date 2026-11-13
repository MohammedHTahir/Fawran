import { Module, ServiceUnavailableException } from '@nestjs/common';

export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';
export type PayMethod = 'instapay' | 'card' | 'wallet';

/** Port for an approved payment partner. A production adapter MUST deduplicate
 * charges by `reference` across retries and expose signed webhooks/reconciliation.
 * The method labels here are product categories, not direct InstaPay integrations. */
export interface PaymentProvider {
  charge(r: { amount: number; method: PayMethod; reference: string }): Promise<{ ok: boolean; providerRef: string }>;
}

/** Dev-only mock. A card payment of exactly 1313 piasters is declined, to test failures. */
export class MockProvider implements PaymentProvider {
  async charge(r: { amount: number; method: PayMethod; reference: string }) {
    return { ok: !(r.method === 'card' && r.amount === 1313), providerRef: `mock_${r.reference}` };
  }
}

class UnconfiguredProductionPaymentProvider implements PaymentProvider {
  async charge(): Promise<{ ok: boolean; providerRef: string }> {
    throw new ServiceUnavailableException(
      'No licensed payment provider is configured. Mock payments are disabled in production.',
    );
  }
}

@Module({
  providers: [{
    provide: PAYMENT_PROVIDER,
    useFactory: (): PaymentProvider => process.env.NODE_ENV === 'production'
      ? new UnconfiguredProductionPaymentProvider()
      : new MockProvider(),
  }],
  exports: [PAYMENT_PROVIDER],
})
export class ProviderModule {}
