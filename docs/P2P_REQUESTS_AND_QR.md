# Person-to-person requests and QR receive codes

## User flows

- **Receive:** an authenticated user requests a stable, random 192-bit recipient code. The mobile app renders a QR code containing a fawran://pay?code=... deep link and can share that link.
- **Scan/open:** the receiving device's camera or an app link opens Fawran. The app resolves the opaque code through the authenticated API and pre-fills the recipient in the send-money screen.
- **Request money:** a user creates a 24-hour request against a registered phone number and a currency wallet held by both parties. The recipient sees it in the incoming request inbox.
- **Pay request:** only the named payer can accept. The app asks for confirmation, then the API posts a same-currency ledger transfer using a stable request-specific idempotency key.
- **Decline:** only the named payer can decline a still-pending request.

## API

- GET /wallet/receive-code
- GET /wallet/resolve/:code
- POST /wallet/requests — {toPhone,countryCode?,amount,currency,note?} plus Idempotency-Key
- GET /wallet/requests
- POST /wallet/requests/:id/accept
- POST /wallet/requests/:id/decline

Migration 16 adds wallet recipient handles and durable payment-request records. Requests expire after 24 hours. Reusing a create idempotency key with a changed payload is rejected. Accepting an already accepted request returns the original ledger transaction; it does not create another movement.

## Security boundaries

- The QR code is a recipient identifier, not a bearer payment authorization.
- Resolving a code requires an authenticated session. A code cannot debit an account.
- Payment requests are bound to requester and payer user IDs, amount, currency, and a request fingerprint.
- Only the designated payer can accept or decline.
- Accepting a request is an explicit payer action and uses a stable ledger idempotency key.
- Currency wallets must exist on both sides; no implicit FX is performed.
- This is an internal prototype ledger flow. It is not a bank transfer, card transaction, InstaPay rail, or live-money capability.

## Remaining validation

- API integration tests exercise code creation, resolution, request idempotency, payer-only authorization, accept/replay, decline, and balance deltas.
- Android Expo export/typecheck validates the QR renderer and deep-link handling compile.
- Device QA is still required for camera-to-app deep links, app cold-start, Android/iOS share sheets, QR scanning distance/lighting, Arabic RTL, and accessibility.
- A production payment rail still requires a licensed partner and market approvals. This flow only moves prototype ledger balances.