# Fawran — Full Multi-Market Fintech Product Plan

Status: architecture and delivery plan. This document does not authorize financial activity.

## Product direction

Build Fawran as a multi-market financial platform with one customer experience and country-specific operating configurations. The product combines:

1. Consumer wallets and payment experiences.
2. Person-to-person transfers and payment requests.
3. Merchant accounts, checkout and payment links.
4. Rewards, cashback, referrals and loyalty campaigns.
5. Business accounts, team access and business payouts.
6. Merchant discovery and partner offers.
7. Operations, risk, compliance and reconciliation tooling.

The first architecture must support multiple markets and currencies without pretending that payment rails or regulatory permissions are interchangeable.

## Initial market catalog

The initial planning catalog is AE (AED), EG (EGP), SA (SAR), GB (GBP) and US (USD). These are architecture targets, not approved launch markets. The market registry is metadata only. No market has production payment activation.

Choose actual launch order only after partner availability, regulatory advice, economics, customer demand, data-residency obligations and operational coverage are assessed. Do not infer that the user's residence or company registration authorizes a product launch in that jurisdiction.

## Target architecture

- **Mobile/web clients:** country-aware onboarding, locale, currency display, wallet views, merchant checkout and rewards.
- **Fawran API:** authentication, market resolution, authorization, limits, risk decisions, idempotency and orchestration. Clients never call Blnk or payment partners directly.
- **Market configuration service:** supported countries, currencies, minor-unit precision, locales, time zones, KYC tiers, transaction limits, fees, disclosures and provider routing.
- **Ledger:** Blnk as the financial ledger engine, with separate currency ledgers/balances and explicit inter-ledger FX accounting. Never transfer unlike currencies as if they were the same asset.
- **Payment orchestration:** provider adapters, payment intents, signed webhook inbox, outbox, retry state machines and provider settlement reconciliation.
- **Rewards ledger:** points are a separate unit (e.g. POINTS), not cash. Campaign liabilities, merchant funding, expiry, redemption and reversals must be accounted for separately.
- **Merchant platform:** KYB status, stores, terminals/checkout, offers, settlement accounts, refunds and merchant-funded campaigns.
- **Operations console:** least-privilege RBAC, maker-checker approvals, immutable audit history, exception queues and customer support workflows.
- **Analytics:** privacy-minimized reporting from reconciled data, not ad-hoc reads from the live money-moving path.

## Delivery phases

### Phase 0 — Safety and foundations
- Keep production money movement disabled in code and infrastructure.
- Define market registry, currency minor-unit metadata and country-aware data contracts.
- Inventory all EGP-only assumptions in API, database, mobile app, payment links, receipts, limits and tests.
- Preserve the current PostgreSQL ledger and Blnk adapter boundary; do not dual-write.
- Add architecture decision records for money representation, market isolation, FX and ledger ownership.

### Phase 1 — Multi-currency ledger foundation
- Model account currency as immutable after creation.
- Make every transaction carry currency, precision/minor-unit metadata and market context.
- Create separate Blnk ledger/balance configuration per currency; verify the exact supported Blnk behavior before rollout.
- Enforce same-currency transfers. FX must be a separate, explicit two-sided operation with rate source, quote expiry, spread, fees and linked ledger entries.
- Design safe migration for existing EGP accounts. No implicit currency conversion or balance copying.
- Test precision for zero-, two- and three-decimal currencies, concurrency, overdraft prevention, idempotency and recovery.

### Phase 2 — Customer wallet and payment experience
- Country-aware signup and phone normalization.
- Multiple currency wallets where allowed by the market policy.
- Wallet-to-wallet transfers, requests, split payments and payment links.
- Payment-intent lifecycle with pending, succeeded, failed, reversed and under-review states.
- Keep simulated payment providers isolated from production builds and visibly label test money.

### Phase 3 — Rewards and loyalty
- Separate POINTS ledger/unit from fiat ledgers.
- Merchant-funded and Fawran-funded campaign budgets.
- Earn rules by eligible settled transaction, merchant, category, country and campaign period.
- Redemption, expiry, caps, reversals, refunds and dispute adjustments.
- Referral attribution and anti-abuse controls.
- Tier progression based on settled eligible activity, with transparent terms.
- Never describe points as cash or promise cash redemption unless a market-specific legal and accounting review approves it.

### Phase 4 — Merchant and business platform
- Merchant onboarding and KYB workflow.
- Business accounts, owners, team roles and approval limits.
- Payment links, QR checkout, invoices and transaction exports.
- Merchant offers, campaign creation, audience targeting with consent and opt-out controls.
- Merchant-funded rewards with campaign budget reservation and spend reporting.
- Payouts only through approved providers after reconciliation.

### Phase 5 — Provider integrations, market by market
For each market independently:
- Select a licensed bank/PSP/acquirer and confirm permitted use cases in writing.
- Confirm who is the regulated issuer/merchant of record/payment service provider and who holds/safeguards funds.
- Contractually allocate KYC/KYB, AML/CFT, sanctions screening, fraud monitoring, reporting, complaints, refunds, chargebacks and safeguarding.
- Implement provider-specific payment, payout, refund and signed-webhook adapters.
- Add settlement-file ingestion, automated reconciliation, exception management and runbooks.
- Complete local legal, privacy, security, data-residency and partner approval before enabling a controlled pilot.

### Phase 6 — Production operations
- Threat model, SAST/DAST, secret scanning and independent penetration test.
- Device and account risk, fraud/AML case management and abuse monitoring.
- Admin RBAC, maker-checker and immutable audit trail.
- Backups, restore drills, disaster recovery, monitoring, alerting and incident response.
- Load, concurrency, fault-injection and mobile device QA.
- Country-specific disclosures, terms, fees, privacy notices and customer support.

## Non-negotiable money rules

- Blnk is a ledger, not a bank, PSP, card network or regulatory permission.
- A ledger credit must only follow a verified funding event or an explicitly authorized test fixture.
- Never treat a client callback or redirect as proof of payment.
- Verify webhook signatures and deduplicate provider event IDs and payloads.
- Never blindly retry an ambiguous financial operation with a new reference.
- Never dual-write a movement to PostgreSQL and Blnk.
- Store amounts as integer minor units and currency codes; never use binary floating point for money.
- Never silently convert balances when a user changes country.
- Never net different currencies without an explicit FX transaction and accounting trail.
- Keep test balances and production funds completely separated.

## Current implementation reality (18 November 2026)

The repository now has a multi-market test foundation, merged to `main`:

- **Markets and wallets:** AE/AED, EG/EGP, SA/SAR, GB/GBP and US/USD are catalogued. Test users can onboard with market-specific phone formats stored as E.164 and receive a default-currency wallet. Existing Egyptian users are migrated to E.164 and retain EGP. Additional currency wallets are separate accounts; currency is immutable per account and transfers remain same-currency only.
- **Mobile:** market selection at OTP onboarding, recipient-country selection for phone transfers, currency wallet selection and currency-aware personal payment links.
- **Rewards:** separate non-cash POINTS ledger, referral codes/claims, tiers and points history are exposed in the mobile app. Points cannot be converted to wallet cash.
- **Merchants:** backend and mobile flows cover business registration, KYB metadata submission, business currency accounts, offers, payment links and points campaigns. Actual document uploads are not implemented. Offers remain drafts and campaigns remain pending funding until their respective review/funding workflows are completed.
- **Payments:** test payment intents, signed/deduplicated test webhooks, idempotent test refunds, blocked payout requests and finance-admin settlement reconciliation. Personal links can use isolated simulated provider accounts by currency. Merchant checkout and settlement remain blocked.
- **FX:** synthetic, admin-configured test rates can produce five-minute preview quotes using integer arithmetic. There is no FX execution endpoint, live rate source, funds reservation or ledger conversion.
- **Operations:** support cases, compliance risk cases, role-scoped admin APIs, audit history and maker-checker market evidence gates are available. These are workflow controls, not local legal or regulatory determinations.
- **Safety:** all markets still return `realMoneyEnabled: false`. Test rates, test provider flows, successful CI, Blnk sandbox integration or verified evidence gates cannot activate live money movement.

This is a meaningful backend and mobile foundation, not a production-ready wallet or licensed financial service. Remaining work includes a merchant/admin web console, actual KYB document upload and verification, QR rendering, offer publishing and campaign funding/issuance, licensed PSP/bank adapters, live signed webhooks, real refunds/payouts/settlement formats, jurisdiction-specific KYC/AML and consumer-protection rules, localization, security review, operational runbooks and written approvals for each launch market.
