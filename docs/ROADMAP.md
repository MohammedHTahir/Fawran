# Fawran delivery roadmap

## Product direction

Build a trusted Egypt-first money movement and merchant collection experience. Keep the Flutter customer app and API in one repository. A merchant web portal can be introduced after the money movement and account model are sound; do not over-expand the first release.

## Phase 0 — Stabilize the supplied prototype (in progress)

- Preserve Claude's Flutter + NestJS + PostgreSQL implementation.
- Correct payment idempotency so retries cannot create duplicate ledger credits.
- Reject reuse of an idempotency key with a different request payload.
- Persist payment attempts before contacting the payment provider.
- Hash OTPs, add basic resend throttling, and fail closed if production SMS is not configured.
- Make user and wallet creation atomic.
- Document the current mock-only state and release blockers.

**Acceptance:** API tests cover successful transfers, overdrafts, replay, changed-payload replay, declined top-ups, and ledger integrity. Real PSP adapter remains disabled until it supports durable idempotency and webhooks.

## Phase 1 — Ledger and platform hardening

- Replace schema-on-boot with versioned migrations and controlled deployment migration jobs.
- Add database foreign keys, checks, unique constraints, indexes, and account ownership constraints.
- Add immutable ledger audit events and operational reconciliation jobs.
- Make provider webhooks signature-verified, replay-safe, and idempotent.
- Introduce durable payment intent states: created, pending, succeeded, failed, reversed, under_review.
- Implement PSP timeout recovery and a reconciliation queue; never assume a timeout means failure.
- Replace in-memory OTP state with shared Redis/DB storage; add per-IP, device, phone, and global abuse controls.
- Add refresh-token rotation, device/session listing, revocation, and access-token invalidation.
- Add role-based admin access, immutable admin audit logs, and operational runbooks.
- Add observability: structured logs, traces, metrics, alerts, and privacy-safe correlation IDs.

**Acceptance:** fault-injection tests prove safe recovery after process crashes at every provider/ledger boundary; concurrency tests run against real PostgreSQL, not only pg-mem.

## Phase 2 — Personal wallet MVP

- Customer profile and KYC status/limits sourced from the licensed partner.
- Wallet balance and activity with search, filters, transaction detail and downloadable receipt.
- Send and request money; split bills; QR receive/pay.
- Cash-in/cash-out only through approved partner agents and verified settlement flows.
- Funding methods and withdrawals through supported partner rails.
- Notifications, support, device security, and clear failed/pending states.

**Acceptance:** end-to-end customer journeys pass in Arabic and English; every movement has a server-generated transaction ID and auditable receipt.

## Phase 3 — Merchant collections

- Merchant onboarding, business verification, KYB/KYC workflow and roles.
- Public hosted checkout/payment pages with expiry, status, fees, and receipts.
- Payment links, invoices, order references and QR collections.
- Refunds, disputes/chargebacks, payout schedules and settlement reports.
- Merchant dashboard, analytics, exports, staff roles and audit history.

**Acceptance:** payment collection, settlement, partial/full refund, failed payout, and dispute journeys are reconciled against provider settlement reports.

## Phase 4 — Mobile product and UX completion

- Bring the Flutter visual system in line with the approved Fawran visual prototype.
- Implement full navigation, loading/empty/error/offline states and accessibility.
- Add push notifications, biometric app lock, localization QA and Arabic typography.
- Add deep links and verified public payer web checkout.
- Add device, network and app integrity controls appropriate to risk.

**Acceptance:** golden/widget tests, device matrix, RTL layout QA, and end-to-end test suite pass on Android and iOS.

## Phase 5 — Controlled launch

- Complete legal/regulatory assessment and contracts with licensed bank/payment partners.
- Security threat model, independent penetration test, vulnerability remediation and incident response.
- Load, resilience, backup/restore, disaster recovery and operational readiness tests.
- Production secrets, key management, data retention, privacy notices and consent.
- Limited pilot with capped partner-approved limits, monitoring, reconciliation and customer support.

**Acceptance:** signed launch checklist; no unresolved critical/high security findings; partner and compliance approvals documented.

## Scope discipline

Features such as lending, credit, stored-value issuance, international transfers, card issuing, cash-agent network, or direct InstaPay connectivity are not assumed. Each requires separate partner, legal, regulatory, and risk review.
