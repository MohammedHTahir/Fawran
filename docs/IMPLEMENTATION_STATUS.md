# Implementation status

Last reviewed: 2026-11-16

## Current application architecture

- React Native + Expo + TypeScript mobile app.
- NestJS API with PostgreSQL as the default application database and ledger provider.
- Optional Blnk Core ledger adapter, isolated behind the API; the mobile app never connects to Blnk directly.
- Integer-piaster money representation (100 piasters = EGP 1).
- Versioned SQL migrations are applied explicitly; API startup checks the schema version and fails closed if migrations are missing.

## Implemented in the development prototype

### Customer app and API
- Arabic-first authentication, wallet, activity, account, mock top-up, P2P transfer, receipt and payment-code flows.
- Expo SecureStore session persistence, short-lived access tokens, rotating refresh tokens and single-flight refresh handling.
- Active session listing, current-session logout, logout-all and individual session revocation.
- Idempotency keys for money movement requests, durable payment-attempt records and recovery tests for top-ups/payment links.
- Mobile API timeouts and actionable network/error messages, including mapped rate-limit, declined-payment and service-unavailable responses.
- API liveness and readiness endpoints; readiness checks database connectivity and migration version.

### Authentication and abuse controls
- Durable OTP challenges and rate-limit records in PostgreSQL.
- OTP digests use HMAC-SHA256 with a dedicated pepper; challenges expire, are one-time-use and have attempt limits and resend cooldowns.
- Per-phone and per-IP send limits, plus per-phone and per-IP verification throttles.
- Optional Twilio SMS adapter with Egyptian number normalization; production SMS fails closed until credentials and an appropriate sender configuration are supplied.
- Refresh tokens are stored as HMAC digests with a separate pepper. Reuse of a consumed refresh token revokes the user's sessions.
- Transactional auth cleanup command: `npm run auth:cleanup`.

### Ledger and integrity
- PostgreSQL ledger remains the default. Blnk is opt-in and is not a bank, payment provider or licensed wallet service.
- Blnk integration is pinned to a tested Core version and has a separate local development stack.
- Blnk adapter treats only an applied operation as completed; queued/in-flight operations remain pending and unknown states fail closed.
- Blnk reconciliation inspects pending/unknown operations and does not blindly repost movements: `npm run ledger:reconcile`.
- PostgreSQL cached-balance and double-entry integrity verification: `npm run ledger:verify`. Do not use this PostgreSQL verifier when Blnk is the selected ledger provider.

### Engineering automation
- GitHub Actions checks API build, migrations, API tests, mobile TypeScript checks, Android Expo export and the pinned Blnk integration.
- Dependabot weekly updates are configured for API/mobile npm dependencies, GitHub Actions and the Blnk Docker dependency.
- Recent compatible dependency updates merged: React patch update, Jest/@types update, mobile TypeScript 7 update, and GitHub Actions setup-node update.
- The actions/checkout update is still open because its branch conflicts after the setup-node update. API TypeScript 7 and NestJS 12 updates remain unmerged because their API/Blnk CI checks fail; do not force these major upgrades.


### Payment lifecycle foundation (new, not a live PSP integration)
- Migration v5 adds durable payment-intent records with a constrained status vocabulary and provider-event inbox rows.
- Provider-event IDs are unique per provider; a duplicate event ID with a different SHA-256 payload digest is rejected.
- A provider-neutral state-transition policy covers created, pending, succeeded, failed, reversed and under-review outcomes. Late success after a failed result must enter under_review first.
- The PaymentIntentStore supports idempotent intent creation, payload-fingerprint mismatch rejection, event inbox deduplication and compare-and-set status updates.
- This foundation is not yet wired to a provider webhook endpoint and does not verify provider signatures, trigger ledger postings, reconcile settlements or make real payments.

## Not yet implemented or externally blocked

- No live payment provider, bank, card processor, Egyptian mobile-wallet rail or InstaPay integration is configured. Mock payment behavior is development-only.
- No provider-specific signed webhook ingestion, provider event replay protection, complete payment-intent state machine or automated PSP settlement reconciliation.
- No production customer funds, live top-ups, cash-in/out, payouts, refunds or chargebacks.
- No licensed operating partner or regulatory/legal approval for the intended Egypt wallet/payment model.
- Twilio credentials, approved Egyptian sender setup, live network delivery tests and SMS delivery monitoring are not configured.
- No complete admin RBAC, maker-checker workflow or immutable admin audit back office.
- No production fraud/AML operations, support escalation, observability/alerting, automated backups/restore drills or disaster-recovery validation.
- No independent penetration test, full threat-model sign-off, load/concurrency/fault-injection test campaign or production-like staging certification.
- Full Android/iOS physical-device QA, accessibility/RTL QA, EAS cloud build and app-store release remain outstanding.
- Daily scheduling of `npm run auth:cleanup` and the applicable ledger verification/reconciliation command must be configured in deployment operations; adding the commands does not schedule them.

## Important safety boundary

Fawran remains a development prototype. A green CI run verifies code checks only; it does not establish licensing, provider approval, regulatory compliance, production security or operational readiness. Do not process real customer funds or collect production identity data until the licensed-partner, legal, security, provider, reconciliation and operational gates in [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md) have been completed and signed off.
