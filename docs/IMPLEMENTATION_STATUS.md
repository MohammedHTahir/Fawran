# Implementation status

## Completed in this revision

- Replaced the Flutter/Dart mobile client with React Native + Expo + TypeScript.
- Preserved the NestJS API, PostgreSQL ledger and API contract.
- Rebuilt Arabic-first login, wallet, activity, account, mock top-up, P2P transfer, receipt and payment-code flows.
- Added Expo SecureStore session persistence and idempotency keys for top-ups and transfers.
- Added EAS preview/production profiles and replaced Flutter CI with Expo typechecking and Android export.
- Added automatic local `.env` loading for the API so local setup does not require shell-specific exports.
- Kept mock SMS/payment behavior clearly labelled as prototype-only.

## Not yet complete

- A successful first EAS cloud build and a deployed HTTPS staging API for hosted previews.
- Public payment-link checkout page, request money, split bill, QR, KYC, cash-in/out locator, merchant dashboard, push notifications and biometric app lock.
- Real PSP/bank integrations, signed webhooks, durable provider idempotency and reconciliation.
- Production SMS adapter and shared OTP/rate-limit store.
- Payment-link recovery after provider/ledger partial failure.
- Complete migration runner, database constraint hardening, production secrets, monitoring, audit back office, compliance and security testing.

## Verification status

The migration source and configuration have been authored, but package installation from the npm registry was unavailable in this execution environment. TypeScript checking, Expo bundling, EAS builds and API tests have not yet been verified here. GitHub Actions is configured to run the mobile typecheck and Android export after push; do not treat configuration alone as a passing build.
