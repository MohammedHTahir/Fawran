# Test refunds, payouts and settlement reconciliation

This is a test-only orchestration layer. It is not a live payment provider integration.

## Test refunds

- `POST /payments/test/refunds` requires an authenticated user and an `Idempotency-Key`.
- Only succeeded test-provider payment intents with no fiat ledger posting can be refunded.
- Currency must match the original intent; cumulative non-failed test refunds cannot exceed the original amount.
- A refund request is recorded as `created` with a synthetic test provider reference.
- No provider is called, no wallet balance changes, and no fiat ledger entry is posted.

## Merchant payout requests

- `POST /merchants/:merchantId/test-payouts` records a payout request for an authorized merchant owner/admin.
- Since every market's real-money policy is disabled, the request is recorded as `blocked` with `real_money_disabled_pending_approvals`.
- No bank details are collected, no payout provider is called, and no money is sent.
- The request is written to the admin audit log.

## Settlement reconciliation

Finance administrators can import a test settlement file represented as structured JSON:

- `POST /admin/test-settlements/import`
- `GET /admin/test-settlements/:batchId`

The importer checks charge/refund/payout references, currency, gross amount and fee/net arithmetic. It records matched lines and explicit exceptions (unmatched, amount mismatch, currency mismatch, duplicate or invalid). Re-importing the same batch ID and payload is idempotent; a different payload under the same ID is rejected.

Reconciliation is observational only. It never posts a ledger entry, changes a wallet balance, marks an intent as paid, triggers a refund or executes a payout. Real provider settlement formats and signed delivery still require provider-specific adapters and approval.
