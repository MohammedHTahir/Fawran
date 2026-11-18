import { signTestProviderWebhook, verifyTestProviderWebhook } from '../src/payments/test-payment.controller';

describe('test provider webhook signatures', () => {
  const secret = 'test-webhook-secret-that-is-at-least-32-bytes-long';
  const raw = Buffer.from('{"eventId":"evt_12345678","eventType":"payment.succeeded"}');
  const timestamp = 1_800_000_000;

  it('accepts a valid timestamped HMAC signature', () => {
    const signature = signTestProviderWebhook(raw, secret, timestamp);
    expect(verifyTestProviderWebhook(raw, signature, secret, timestamp)).toBe(true);
  });

  it('rejects a changed body, invalid secret and stale timestamp', () => {
    const signature = signTestProviderWebhook(raw, secret, timestamp);
    expect(verifyTestProviderWebhook(Buffer.from(raw.toString() + ' '), signature, secret, timestamp)).toBe(false);
    expect(verifyTestProviderWebhook(raw, signature, 'short', timestamp)).toBe(false);
    expect(verifyTestProviderWebhook(raw, signature, secret, timestamp + 301)).toBe(false);
  });

  it('rejects malformed signatures', () => {
    expect(verifyTestProviderWebhook(raw, 'v1=not-a-signature', secret, timestamp)).toBe(false);
  });
});
