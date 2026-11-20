# Tap to Pay and in-person phone acceptance

## Product behavior

Fawran will support two distinct experiences:

1. **Person-to-person Fawran transfer** — a customer sends money to another Fawran customer. The transfer is authorized by the Fawran API and posted to the same-currency ledger. The recipient is resolved by an authenticated recipient reference, QR code, or payment request. NFC is not used as a substitute for server-side authorization or ledger posting.
2. **Merchant Tap to Pay (SoftPOS)** — a merchant's supported phone acts as a contactless payment terminal. A customer taps a contactless debit/credit card, Apple Pay, Google Pay, or another supported wallet on the merchant's phone. The licensed/acquiring PSP performs card acceptance and authorization; Fawran records the resulting provider payment lifecycle.

A phone-to-phone Fawran transfer is not the same thing as SoftPOS. Direct NFC device-to-device transfer is not a cross-platform payment protocol and must not be represented as a bank/card payment.

## UAE integration direction

Use **Adyen Mobile Solutions as the first technical integration candidate** for UAE, subject to a signed acquiring/PSP agreement, merchant-account approval, commercial review and confirmation of supported local card schemes/currencies/MCCs.

Reasons:
- Apple's official Tap to Pay on iPhone region list includes Adyen in the UAE.
- Adyen documents Tap to Pay on Android and its Mobile SDK/Terminal API flow for NFC-enabled Android commercial devices.
- The same provider family has documented Android and iOS mobile acceptance options, reducing the chance of maintaining separate acquiring integrations.

This is a technical candidate, not a claim that Fawran has an Adyen account, merchant approval, or permission to process payments. UAE provider support does not imply Egypt availability. Egypt requires its own PSP/acquirer and market approval.

## Required architecture

### Merchant and device controls
- Tap to Pay is available only to an active, KYB-approved merchant and authorized merchant team member.
- Bind terminal sessions to merchant, store, staff member, market, currency, device installation and PSP terminal identifier.
- Store device registration and terminal status server-side. Do not store provider secrets in the mobile app.
- Enforce merchant/store currency and market eligibility before a terminal session is issued.
- Require device security/integrity checks and provider-required location/device permissions.
- Provide terminal activation, suspend/revoke, device replacement and audit history.

### Payment lifecycle
1. Mobile app requests a payment intent from Fawran with amount, currency, store and idempotency key.
2. API validates merchant membership, KYB, store status, limits, currency and market gate; creates a durable intent before asking the PSP to start a terminal transaction.
3. API creates a PSP Terminal API request using server-held credentials and a stable provider reference.
4. The native PSP SDK starts the contactless reader session on the merchant phone.
5. SDK result is treated as provisional UI feedback. The authoritative payment outcome comes from a verified PSP response/webhook and reconciliation.
6. Provider event is signature-verified, timestamp/replay-checked, deduplicated and persisted before applying a valid state transition.
7. Ledger posting is idempotent and occurs once only after the PSP confirms the authorized/captured outcome under the agreed provider semantics.
8. Merchant receives a receipt and transaction status. Unknown outcomes remain pending until provider reconciliation resolves them.

### Required payment states
- created
- pending
- authorized (only if supported and meaningful for the provider flow)
- succeeded
- failed
- reversed
- under_review

Do not equate SDK completion, a client callback, a timeout, or a success-looking screen with a settled payment. Handle webhook-before-client-response, duplicate/out-of-order webhooks, late success after failure, app termination, PSP timeout, ledger-post failure, reversal, partial/full refund and dispute/chargeback events.

### Native mobile integration
- The current app is React Native + Expo. Expo Go cannot load a proprietary native SoftPOS SDK.
- Implement a custom Expo native module/config plugin or a provider-supported React Native wrapper, then use EAS development/production builds.
- iOS requires the provider's supported SDK and Apple's Tap to Pay entitlement/ProximityReader flow, approved merchant configuration and App Store review.
- Android requires the provider's certified Mobile SDK, supported NFC hardware/OS, device security requirements and terminal registration.
- The provider SDK must own secure card capture and PIN entry. Fawran must never read, log, transmit or store raw PAN, CVV or PIN data.

## Provider adapter contract

Keep provider-specific terminal setup, payment requests, result parsing, refunds and webhook verification behind a server-side adapter. Do not expose PSP API keys, setup tokens, SDK secrets or terminal credentials through Expo public environment variables. The mobile app receives only short-lived, device/merchant-bound session material required by the provider SDK.

A provider adapter must not be marked production-capable until:
- the PSP supplies test and live credentials and certified SDK artifacts;
- merchant account, stores, MCC, currencies, local schemes and terminal capabilities are enabled;
- webhook signatures and event semantics are implemented against provider documentation;
- provider-side idempotency, timeout, reversal and refund behavior are proven in sandbox;
- settlement reports reconcile to payment intents and ledger postings;
- PSP and security reviews approve the app and device configuration.

## Test matrix

### Native acceptance
- Supported iPhone and Android device enrollment and unsupported-device rejection.
- NFC disabled, permissions denied, device integrity failure, unsupported OS and unsupported card.
- Contactless physical Visa/Mastercard and supported digital wallets in PSP sandbox.
- Approved, declined, cancelled, PIN-required, timeout, interrupted network and app-killed scenarios.
- Duplicate tap, double-submit, retry with same idempotency key and changed-payload replay.

### Backend and ledger
- Webhook signature failure, stale timestamp, replay, duplicate event ID and same ID/different payload.
- Webhook before SDK response; SDK success with webhook delayed; webhook success after client timeout.
- PSP approved but ledger unavailable; retry must post once without a second charge.
- Late success after failed/cancelled state routes to under_review/exception handling.
- Full/partial refund, reversal, dispute and settlement mismatch.
- Cross-merchant/store/device authorization attempts and team role boundaries.
- Multi-currency isolation; no implicit FX.

### Release gates
- Real PSP sandbox certification and signed-off end-to-end tests.
- Provider/merchant agreement, legal and regulatory approvals for the specific market.
- Apple entitlement and App Store approval for iOS Tap to Pay.
- Provider Android SDK certification and supported-device matrix.
- Penetration test, PCI/SoftPOS responsibility confirmation, operational runbooks and reconciliation sign-off.

## Current status

Fawran currently has test-only payment intents and a test webhook path. It does not yet have a production PSP adapter, native SoftPOS SDK, terminal enrollment, live webhook integration or automated PSP settlement reconciliation. Those must be implemented and certified; adding credentials alone cannot create these capabilities.
