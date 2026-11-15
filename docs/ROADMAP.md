# Fawran delivery roadmap

## Product direction

Build a trusted Egypt-first money movement and merchant collection experience. Keep the React Native + Expo customer app and NestJS API in one repository. A merchant web portal can be introduced after the money movement, partner model, and account controls are sound.

## Phase 0 — Stabilize the supplied prototype (completed for development)

- Preserve the React Native + NestJS + PostgreSQL implementation.
- Correct payment idempotency so retries cannot create duplicate ledger credits.
- Reject reuse of an idempotency key with a different request payload.
- Persist payment attempts before contacting the payment provider.
- Persist OTP challenges and rate limits in PostgreSQL; hash OTP material with a dedicated HMAC pepper.
- Make user and wallet creation atomic.
- Add explicit versioned migrations and core integrity constraints.
- Document the current mock-only state and release blockers.

**Acceptance:** API tests cover successful transfers, overdrafts, replay, changed-payload replay, declined top-ups, payment recovery, OTP expiry/attempt/cooldown behavior, and ledger integrity. Real PSP and SMS adapters remain disabled until approved providers and the required security contracts are in place.

## Phase 1 — Ledger and platform hardening (in progress)

- Add automated provider webhooks with signature verification, replay protection, and idempotent event processing.
- Introduce a complete durable payment-intent state machine: created, pending, succeeded, failed, reversed, under_review.
- Implement PSP timeout recovery, settlement reconciliation, and exception queues; never assume a timeout means failure.
- Add device-bound and global abuse controls for OTP, SMS pumping protection, and production SMS delivery monitoring.
- Add refresh-token rotation, device/session listing, revocation, and access-token invalidation.
- Add role-based admin access, immutable admin audit logs, and operator runbooks.
- Add privacy-safe structured logs, traces, metrics, alerts, and correlation IDs.
- Run concurrency and fault-injection tests against real PostgreSQL and a provider sandbox.

**Acceptance:** fault-injection tests prove safe recovery after process crashes at provider/ledger boundaries; concurrency tests run against real PostgreSQL; provider events and settlement files reconcile to the ledger.

## Phase 2 — Partner-backed personal wallet MVP

- Customer profile and KYC status/limits sourced from the licensed partner.
- Wallet balance and activity with search, filters, transaction detail, and downloadable receipt.
- Send and request money; split bills; QR receive/pay.
- Cash-in/cash-out only through approved partner agents and verified settlement flows.
- Funding methods and withdrawals through supported partner rails.
- Notifications, support, device security, and clear failed/pending states.

**Acceptance:** end-to-end customer journeys pass in Arabic and English; every movement has a server-generated transaction ID and auditable receipt.

## Phase 3 — Merchant collections

- Merchant onboarding, business verification, KYB/KYC workflow, and roles.
- Public hosted checkout/payment pages with expiry, status, fees, and receipts.
- Payment links, invoices, order references, and QR collections.
- Refunds, disputes/chargebacks, payout schedules, and settlement reports.
- Merchant dashboard, analytics, exports, staff roles, and audit history.

**Acceptance:** payment collection, settlement, partial/full refund, failed payout, and dispute journeys reconcile against provider settlement reports.

## Phase 4 — Mobile product and UX completion

- Complete customer navigation, loading/empty/error/offline states, and accessibility.
- Add push notifications, biometric app lock, localization QA, and Arabic typography.
- Add deep links and verified public payer web checkout.
- Add device, network, and app integrity controls appropriate to risk.

**Acceptance:** golden/component tests, device matrix, RTL layout QA, and end-to-end tests pass on Android and iOS.

## Phase 5 — Controlled launch

- Complete legal/regulatory assessment and contracts with licensed bank/payment partners.
- Security threat model, independent penetration test, vulnerability remediation, and incident response.
- Load, resilience, backup/restore, disaster recovery, and operational readiness tests.
- Production secrets, key management, data retention, privacy notices, and consent.
- Limited pilot with capped partner-approved limits, monitoring, reconciliation, and customer support.

**Acceptance:** signed launch checklist; no unresolved critical/high security findings; partner and compliance approvals documented.

## Scope discipline

Features such as lending, credit, stored-value issuance, international transfers, card issuing, cash-agent network, or direct InstaPay connectivity are not assumed. Each requires separate partner, legal, regulatory, and risk review.
