import { Module } from '@nestjs/common';

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

@Module({ providers: [{ provide: PAYMENT_PROVIDER, useClass: MockProvider }], exports: [PAYMENT_PROVIDER] })
export class ProviderModule {}
