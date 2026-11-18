# Test payment orchestration

Status: development-only orchestration slice. It is not a PSP integration and cannot move customer funds.

## Test intent

Authenticated endpoint:

- `POST /payments/test/intents`
- Requires an `Idempotency-Key` header (8–200 characters).
- Body: integer minor-unit `amount`, supported `currency`, and method (`card`, `wallet`, or `instapay`).
- Creates a durable payment intent and a deterministic test-provider reference.
- Returns `testMode: true`, `realMoney: false`, and `ledgerPosted: false`.

The test provider does not charge a card, contact a bank, or create a ledger entry. The route is unavailable when `NODE_ENV=production`.

## Signed test webhook

- `POST /webhooks/test-provider`
- Requires `TEST_PROVIDER_WEBHOOK_SECRET` (at least 32 characters) in non-production environments.
- Header format: `x-test-provider-signature: t=<unix-seconds>,v1=<hex-hmac>`.
- HMAC-SHA256 signs `<timestamp>.<raw HTTP request body>`.
- Signatures expire after five minutes.
- Provider event IDs are deduplicated; a repeated ID with a different payload digest is rejected.
- Supported events: `payment.pending`, `payment.succeeded`, `payment.failed`, `payment.reversed`.

A late success after a failed intent is moved to `under_review`, not silently accepted. Webhook processing updates the payment-intent state only; it does not post to the fiat ledger or issue rewards.

## Production boundary

Both routes explicitly reject production mode. No real PSP adapter, live charge, payout, refund, FX conversion, settlement, merchant capture, or customer-fund movement is enabled. A production provider must be separately implemented with its own authentication/signature scheme, idempotency contract, webhook verification, reconciliation feed, legal/partner approval and security review.
