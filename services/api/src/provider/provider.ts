import { Module, ServiceUnavailableException } from '@nestjs/common';

export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';
export type PayMethod = 'instapay' | 'card' | 'wallet';

/** Port for a licensed payment partner. Production has no concrete implementation
 * until a partner is approved and configured. All references must be idempotent. */
export interface PaymentProvider {
  readonly name?: string;
  charge(r: { amount: number; currency?: string; method: PayMethod; reference: string }): Promise<{ ok: boolean; providerRef: string }>;
  refund(r: { amount: number; currency: string; providerRef: string; reference: string }): Promise<{ ok: boolean; providerRef: string }>;
  payout(r: { amount: number; currency: string; destinationRef: string; reference: string }): Promise<{ ok: boolean; providerRef: string }>;
}

/** Non-production simulator. It never connects to a bank, card network or PSP. */
export class MockProvider implements PaymentProvider {
  readonly name = 'mock';

  async charge(r: { amount: number; currency?: string; method: PayMethod; reference: string }) {
    return { ok: !(r.method === 'card' && r.amount === 1313), providerRef: `mock_charge_${r.currency ?? 'EGP'}_${r.reference}` };
  }

  async refund(r: { amount: number; currency: string; providerRef: string; reference: string }) {
    return { ok: true, providerRef: `mock_refund_${r.currency}_${r.reference}` };
  }

  async payout(r: { amount: number; currency: string; destinationRef: string; reference: string }) {
    return { ok: true, providerRef: `mock_payout_${r.currency}_${r.reference}` };
  }
}

class UnconfiguredProductionPaymentProvider implements PaymentProvider {
  readonly name = 'unconfigured';
  async charge(): Promise<{ ok: boolean; providerRef: string }> {
    throw new ServiceUnavailableException('No licensed payment provider is configured. Mock payments are disabled in production.');
  }
  async refund(): Promise<{ ok: boolean; providerRef: string }> {
    throw new ServiceUnavailableException('Refunds are disabled until a licensed payment partner is approved.');
  }
  async payout(): Promise<{ ok: boolean; providerRef: string }> {
    throw new ServiceUnavailableException('Payouts are disabled until a licensed payment partner is approved.');
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
