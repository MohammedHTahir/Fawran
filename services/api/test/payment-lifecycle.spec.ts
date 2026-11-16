import {
  assertProviderEventReplayMatches,
  InvalidPaymentTransitionError,
  transitionPaymentIntent,
} from '../src/payments/payment-lifecycle';

describe('payment intent transition policy', () => {
  it('allows a normal created -> pending -> succeeded lifecycle', () => {
    expect(transitionPaymentIntent('created', 'pending')).toEqual({ status: 'pending', changed: true });
    expect(transitionPaymentIntent('pending', 'succeeded')).toEqual({ status: 'succeeded', changed: true });
  });

  it('allows a provider success webhook to arrive before the synchronous response', () => {
    expect(transitionPaymentIntent('created', 'succeeded')).toEqual({ status: 'succeeded', changed: true });
  });

  it('treats repeated delivery of the same state as an idempotent no-op', () => {
    expect(transitionPaymentIntent('succeeded', 'succeeded')).toEqual({ status: 'succeeded', changed: false });
  });

  it('does not silently turn a failed payment into a success on a late event', () => {
    expect(() => transitionPaymentIntent('failed', 'succeeded'))
      .toThrow(InvalidPaymentTransitionError);
    expect(transitionPaymentIntent('failed', 'under_review')).toEqual({
      status: 'under_review', changed: true,
    });
  });

  it('allows reversal only after a payment is pending or succeeded', () => {
    expect(transitionPaymentIntent('succeeded', 'reversed')).toEqual({
      status: 'reversed', changed: true,
    });
    expect(() => transitionPaymentIntent('created', 'reversed'))
      .toThrow(InvalidPaymentTransitionError);
  });

  it('requires manual review before resolving contradictory or exceptional outcomes', () => {
    expect(transitionPaymentIntent('under_review', 'succeeded')).toEqual({
      status: 'succeeded', changed: true,
    });
    expect(() => transitionPaymentIntent('reversed', 'succeeded'))
      .toThrow(InvalidPaymentTransitionError);
  });
});

describe('provider event replay digest policy', () => {
  const digest = 'a'.repeat(64);

  it('accepts a duplicate event only when its payload digest matches', () => {
    expect(assertProviderEventReplayMatches(digest, digest)).toEqual({ duplicate: true });
  });

  it('rejects a provider event ID reused with a different payload', () => {
    expect(() => assertProviderEventReplayMatches(digest, 'b'.repeat(64)))
      .toThrow('different payload digest');
  });

  it('rejects malformed payload digests', () => {
    expect(() => assertProviderEventReplayMatches('not-a-hash', digest))
      .toThrow('SHA-256');
  });
});
