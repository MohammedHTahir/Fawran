# Architecture

## Current shape

```text
React Native + Expo mobile app
          | HTTPS + bearer JWT
          v
NestJS API -------------------- approved PSP/bank adapter (not implemented)
          |
          v
PostgreSQL: users, accounts, double-entry ledger, payment links, payment attempts
```

Amounts are integer piasters. The ledger is the source of truth; `accounts.balance` is a transactionally maintained cache and must be periodically reconciled against ledger entries.

## Mobile client

The Expo app is Arabic-first with RTL layout and an English toggle. It stores the JWT using Expo SecureStore and sends authenticated requests to the NestJS API. Top-ups and P2P transfers use idempotency keys. Payment-link creation currently returns a code only; the public payer checkout page is not implemented.

Cloud builds and hosted previews must use `EXPO_PUBLIC_API_URL` pointing to a publicly reachable HTTPS staging API. Never point a cloud device at localhost or put secrets in `EXPO_PUBLIC_*` variables.

## Critical payment boundary

A payment is not complete merely because a client tapped a button or an HTTP request timed out. The API must persist a payment intent before contacting the partner. The partner request must carry a stable idempotency reference. A signed webhook and reconciliation worker must settle the final state. Ledger posting must be idempotent and happen once. Unknown outcomes remain pending until reconciled; never automatically create a second charge with a new reference.

The current top-up path persists an attempt and reuses the same provider reference on retries. The included mock provider is a development stub, not proof of durable provider idempotency.

## Trust boundaries

- Mobile clients are untrusted; validate ownership and limits on the API.
- Provider webhooks require signature verification, timestamp/replay protection and event idempotency.
- Admin actions require separate RBAC, maker-checker approval for sensitive operations, and immutable audit events.
- KYC status and limits must be sourced from the contracted licensed partner, not client-submitted flags.
