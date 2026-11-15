# Production readiness — release blockers

Fawran is a prototype and must not process real customer funds yet.

## Financial correctness

- [ ] Real payment provider with idempotency keys, signed webhooks, settlement reports and documented timeout/reversal semantics.
- [ ] Durable payment-intent state machine and reconciliation for charge-succeeded/ledger-failed and webhook-before-response cases.
- [x] Versioned database migrations and core foreign-key/check constraints added; verify migration execution and constraints against production-like PostgreSQL before release.
- [ ] Ledger invariant and cached-balance reconciliation scheduled and alerted.
- [ ] Refund, reversal, dispute and payout accounting reviewed by a payments specialist.
- [ ] Fees, limits, holds and negative-balance policy approved by partner and risk team.

## Identity and security

- [ ] Licensed/approved KYC/KYB process and tier-based limits.
- [ ] Production SMS adapter; OTP store shared across instances; abuse limits by phone, IP, device and network.
- [ ] Refresh-token rotation, device/session revocation and secure recovery.
- [ ] Secrets in managed secret storage; strong JWT signing key; key rotation plan.
- [ ] Threat model, dependency scanning, SAST, DAST and independent penetration test.
- [ ] PII encryption, access controls, retention/deletion policy and privacy notice.
- [ ] Admin RBAC, maker-checker controls and immutable audit trail.

## Operations

- [ ] Structured logs, monitoring, alerting, traces and fraud/AML case workflow.
- [ ] Provider and ledger reconciliation runbooks; support escalation and incident response.
- [ ] Backups, restore drills, disaster recovery objectives and tested failover.
- [ ] Load, concurrency, resilience and mobile network-failure tests.
- [ ] Customer support, complaints, error handling and status communications.

## Egypt-specific partner and regulatory gates

- [ ] Qualified Egyptian legal advice on the intended wallet/payment model and Central Bank of Egypt requirements.
- [ ] Written operating arrangement with an appropriately licensed bank/payment service provider.
- [ ] Confirmed permitted rails and use cases (cards, account transfers, InstaPay-linked flows, mobile wallets, agent cash-in/out).
- [ ] KYC/KYB, AML/CFT, sanctions screening, transaction monitoring and reporting responsibilities contractually assigned.
- [ ] Data residency, privacy, consumer protection, fees, safeguarding/settlement and complaint obligations confirmed.

## Current code caveats

- Payment provider is `MockProvider`; it does not charge cards, connect to InstaPay, or connect to Egyptian mobile wallets.
- Development OTP is `000000`; production SMS adapter is intentionally unconfigured and fails closed.
- OTP throttling is process-local and is not sufficient for a multi-instance production service.
- Payment-link provider/ledger recovery is incomplete; a crash can leave a link in `processing`.
- API startup now verifies the installed schema version and fails closed if migrations are missing; deployments must run `npm run db:migrate` as a separate step. Migration execution and legacy-data compatibility still require production-like verification.
- Flutter is a thin prototype and lacks many journeys described in the roadmap.
- Existing legacy ledger rows have no request fingerprint. The new code rejects unverifiable legacy idempotency replays rather than risking a duplicate charge.
