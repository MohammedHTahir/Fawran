export const PAYMENT_INTENT_STATUSES = [
  'created', 'pending', 'succeeded', 'failed', 'reversed', 'under_review',
] as const;

export type PaymentIntentStatus = typeof PAYMENT_INTENT_STATUSES[number];

const TRANSITIONS: Record<PaymentIntentStatus, readonly PaymentIntentStatus[]> = {
  created: ['pending', 'succeeded', 'failed', 'under_review'],
  pending: ['succeeded', 'failed', 'reversed', 'under_review'],
  succeeded: ['reversed', 'under_review'],
  failed: ['under_review'],
  reversed: ['under_review'],
  under_review: ['succeeded', 'failed', 'reversed'],
};

export class InvalidPaymentTransitionError extends Error {
  constructor(from: PaymentIntentStatus, to: PaymentIntentStatus) {
    super(`Payment intent cannot transition from ${from} to ${to}`);
    this.name = 'InvalidPaymentTransitionError';
  }
}

/**
 * Pure transition policy shared by provider adapters and operator workflows.
 * A late success after a locally failed result must first enter under_review:
 * it must never silently credit a wallet after a contradictory final outcome.
 */
export function transitionPaymentIntent(
  current: PaymentIntentStatus,
  next: PaymentIntentStatus,
): { status: PaymentIntentStatus; changed: boolean } {
  if (current === next) return { status: current, changed: false };
  if (!TRANSITIONS[current].includes(next)) {
    throw new InvalidPaymentTransitionError(current, next);
  }
  return { status: next, changed: true };
}

/** Duplicate provider event IDs must carry the same payload digest. */
export function assertProviderEventReplayMatches(
  storedDigest: string,
  incomingDigest: string,
): { duplicate: true } {
  if (!/^[a-f0-9]{64}$/i.test(storedDigest) || !/^[a-f0-9]{64}$/i.test(incomingDigest)) {
    throw new Error('Provider event payload digest must be a SHA-256 hex digest');
  }
  if (storedDigest.toLowerCase() !== incomingDigest.toLowerCase()) {
    throw new Error('Provider event ID was replayed with a different payload digest');
  }
  return { duplicate: true };
}
