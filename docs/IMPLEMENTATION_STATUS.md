# Fawran implementation status

Last reviewed: 18 November 2026

## Current architecture

- React Native + Expo + TypeScript mobile app.
- NestJS API with PostgreSQL as the application database and ledger provider.
- Optional Blnk Core ledger adapter isolated behind the API; the mobile app never connects to Blnk directly.
- Multi-market catalog: AE/AED, EG/EGP, SA/SAR, GB/GBP and US/USD.
- Integer minor-unit money representation, explicit currency on accounts and transactions, and E.164 phone identity.
- Versioned SQL migrations are applied explicitly; API startup fails closed if the schema is behind.

## Delivered foundations

### Customer wallet and multi-market

- OTP onboarding with market selection and market-specific phone validation.
- E.164 phone storage; existing Egyptian users are migrated and retain EG/EGP.
- New users receive a default-currency wallet; additional currency wallets are separate accounts.
- Same-currency P2P transfers only; recipient country is explicit.
- Currency-aware personal payment links using simulated provider accounts.
- EGP top-up remains a test-only flow.

### Rewards

- Separate non-cash POINTS ledger.
- Referral codes and claims, tiers, campaign primitives and points history.
- Mobile rewards screen with points balance, tier, referral sharing/claim and history.
- Points cannot be converted into a cash wallet balance.

### Merchant ecosystem

- Merchant registration, business accounts, KYB metadata workflow and merchant team/role foundations.
- Merchant offers, payment links and points campaign APIs.
- Mobile business hub for registration, KYB metadata submission, currency accounts, payment links, offers and campaigns.
- Merchant checkout remains blocked while settlement is blocked. Offers remain drafts and campaigns remain pending funding.
- Actual KYB document upload/storage and a merchant web console are not implemented yet.

### Payments and FX

- Test payment intents and signed/deduplicated test webhooks.
- Idempotent test refunds, blocked payout requests and finance-admin settlement import/matching.
- Synthetic admin-configured FX rates and five-minute preview quotes using integer arithmetic, fee calculations, idempotency and expiry.
- No FX execution endpoint, live rate source, funds reservation or ledger conversion exists.

### Multi-market operations

- Support cases, compliance risk cases, role-scoped admin APIs and audit history.
- Maker-checker market evidence gates for legal, regulatory, partner, KYC/AML, security, reconciliation, support and disclosures.
- Readiness gates are workflow evidence only; they are not legal or regulatory determinations.

## Production blockers

| Area | Required before production |
|---|---|
| Merchant operations | Web console, actual KYB document upload/storage/review, QR rendering, invoices, offer publishing and campaign funding/fulfillment |
| Payments | Licensed bank/PSP/acquirer integrations, production webhooks, executed refunds and payouts, settlement files, disputes and chargebacks |
| FX | Approved live rate source, spread/disclosure policy, customer consent, quote locking, two-sided ledger postings and reconciliation |
| Compliance | Jurisdiction-specific KYC/AML, sanctions, transaction monitoring, consumer protection and data-residency rules reviewed by qualified counsel and licensed partners |
| Operations | Admin web console, monitoring/on-call, incident response, support runbooks, data retention, backup and disaster-recovery exercises |
| Assurance | Security architecture review, independent penetration test, privacy review, load/fault testing and reconciliation sign-off |

## Non-negotiable safety boundary

- Every market remains `realMoneyEnabled: false`.
- Top-ups, personal payment-link checkout, FX quotes and provider callbacks are test-only.
- Merchant settlement, payouts, cash-in/out and live FX are disabled.
- Test-provider success, Blnk sandbox integration, completed evidence gates or passing CI cannot activate live money movement.
- Never use customer funds or live credentials to test these flows.

## Recommended next sequence

1. Build the merchant/admin web console and KYB document workflow.
2. Add QR rendering and invoice/payment-link presentation against simulated providers.
3. Prepare country-specific compliance policy packs with qualified local counsel and licensed partners.
4. Certify provider adapters in sandbox for each intended market.
5. Complete security, privacy, reconciliation, resilience and operational acceptance testing.
6. Activate one market at a time only after its written approvals are complete.
