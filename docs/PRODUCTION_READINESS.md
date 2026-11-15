# Production readiness — release blockers

Fawran is a development prototype. It must not process real customer funds or collect production customer identity data. A passing CI suite proves code checks, not licensing, provider approval, security certification, or operational readiness.

## Implemented engineering controls

- [x] Versioned, explicit database migrations; API startup verifies schema version and fails closed when migrations are missing.
- [x] Core foreign-key and check constraints for accounts, ledger entries, payment attempts, payment links, and ledger operation status.
- [x] Integer-piaster money representation (100 piasters = EGP 1).
- [x] Ledger provider abstraction; PostgreSQL remains default and Blnk is opt-in. Live Blnk integration tests run against a pinned local Core version.
- [x] Ledger operation idempotency and reconciliation inspection for pending/unknown Blnk operations; reconciliation never blindly reposts movements.
- [x] Durable payment-attempt records and retry recovery tests for top-ups and payment links after a ledger post.
- [x] OTP challenge storage in PostgreSQL, HMAC-SHA256 digests using a dedicated pepper, five-minute expiry, one-time use, five-attempt limit, resend cooldown, and per-phone/per-IP request limits.
- [x] Production payment and SMS adapters fail closed when not configured; mock provider and fixed development OTP are not used in production.
- [x] Mobile API timeout and actionable connection diagnostics.

## Financial correctness — still blocking

- [ ] Integrate an appropriately licensed payment partner with durable provider-side idempotency, signed webhooks, provider event replay protection, settlement reports, and documented timeout/reversal semantics.
- [ ] Complete a durable payment-intent state machine for pending, succeeded, failed, reversed, and under-review outcomes. Define webhook-before-response, charge-succeeded/ledger-failed, late success, and duplicate event behavior.
- [ ] Build automated provider-to-ledger reconciliation, exception queues, operator tooling, alerts, and signed-off runbooks. Current Blnk reconciliation is an inspection command for pending/unknown ledger operations, not a complete PSP settlement reconciler.
- [ ] Run scheduled ledger invariant and cached-balance reconciliation with alerting.
- [ ] Have a payments specialist review refunds, reversals, disputes, chargebacks, payouts, fees, holds, limits, and negative-balance policy.
- [ ] Verify migration execution, legacy-data compatibility, backup/restore, and performance against production-like PostgreSQL data.

## Identity and security — still blocking

- [ ] Select and configure an approved production SMS provider, register an appropriate sender, verify Egypt delivery and regulatory requirements, store credentials in managed secrets, and add delivery monitoring. The current production SMS adapter intentionally fails closed.
- [ ] Add device-bound and global OTP abuse controls, risk-based challenges, SMS pumping protections, and operational monitoring. Current controls are per phone and server-observed IP.
- [ ] Configure trusted proxy hops explicitly before using forwarded client IPs; do not trust arbitrary forwarded headers.
- [ ] Implement refresh-token rotation, device/session listing and revocation, logout semantics, and access-token invalidation. Current access tokens are short-lived JWTs; there is no refresh/session lifecycle.
- [ ] Configure JWT signing secrets and OTP pepper in managed secret storage, with rotation and incident procedures. Production `JWT_SECRET` and `OTP_PEPPER` must each be separate random values of at least 32 characters.
- [ ] Complete a threat model, dependency review, SAST/DAST, secret scanning, and independent penetration test; remediate all critical/high findings.
- [ ] Define PII encryption, access controls, retention/deletion, privacy notice, consent, and data-subject request workflows.
- [ ] Implement admin RBAC, maker-checker controls, and immutable admin audit trail.

## Operations — still blocking

- [ ] Structured privacy-safe logs, metrics, traces, correlation IDs, monitoring, alerting, and fraud/AML case workflow.
- [ ] Provider/ledger reconciliation runbooks, support escalation, customer complaints, incident response, and status communications.
- [ ] Automated backups, restore drills, disaster-recovery objectives, and tested failover.
- [ ] Load, concurrency, resilience, fault-injection, and mobile network-failure tests against real PostgreSQL and staging infrastructure.
- [ ] Production deployment pipeline with separate migration job, staged rollout, rollback strategy, health checks, and secret management.
- [ ] Customer support and clear pending/failed/reversed transaction experiences in Arabic and English.

## Egypt-specific partner and regulatory gates — external approvals required

- [ ] Obtain qualified Egyptian legal advice on the intended wallet/payment model and applicable Central Bank of Egypt requirements.
- [ ] Execute a written operating arrangement with an appropriately licensed bank/payment service provider.
- [ ] Confirm permitted rails and use cases (cards, account transfers, InstaPay-linked flows, mobile wallets, agent cash-in/out) with the licensed partner.
- [ ] Contractually assign KYC/KYB, AML/CFT, sanctions screening, transaction monitoring, reporting, safeguarding/settlement, consumer protection, fees, data residency, and complaint obligations.
- [ ] Obtain partner, compliance, and legal sign-off before any real-money pilot.

## Current code caveats

- `MockProvider` is development-only. It does not charge cards, connect to InstaPay, or connect to Egyptian mobile wallets. Payment method labels are placeholders, not live integrations.
- Development OTP is `000000`; production OTP uses a random six-digit code but cannot be delivered until an approved SMS adapter is configured.
- The OTP database tables are durable and shared across API instances. Phone/IP rate limits are basic controls, not a complete anti-abuse or SMS-pumping solution.
- A provider charge that succeeds while ledger posting fails leaves a recoverable processing record; safe recovery depends on the real provider deduplicating the stable reference. No real provider/webhook adapter is configured.
- Payment links currently have no signed webhook or automated settlement reconciliation.
- Blnk Core is an optional ledger service, not a licensed payment provider or bank. Its local development configuration must never be exposed publicly.
- Legacy ledger rows without request fingerprints fail closed on unverifiable idempotency replays.
- The customer app is React Native + Expo. Android export and TypeScript checks run in CI; full iOS/Android device QA and store release remain outstanding.
- No part of this checklist should be interpreted as authorization to hold or transfer customer funds.
