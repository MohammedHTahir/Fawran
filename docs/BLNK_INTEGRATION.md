# Blnk ledger integration decision

Status: infrastructure foundation added; ledger adapter is not enabled yet.

## Decision

Evaluate Blnk as the authoritative ledger for new Fawran test wallets. Keep NestJS as the only application-facing API. The mobile app must never call Blnk directly.

Blnk runs as a separate service with its own PostgreSQL database and Redis. Fawran's PostgreSQL remains the source for application identity, phone lookup, sessions, KYC state, payment links, provider attempts, and the local mapping between Fawran user IDs and Blnk identifiers.

## Local development

See [infra/blnk/README.md](../infra/blnk/README.md).

- Blnk API: `http://localhost:5001` (loopback only)
- Blnk PostgreSQL: host port `5433`; container port `5432`
- Blnk Redis: internal Compose network only
- Existing Fawran PostgreSQL remains on host port `5432`
- Blnk image is pinned to `ghcr.io/blnkfinance/blnk:0.15.7`

The Compose configuration is local-development-only. Secure mode is disabled and the local password is disposable. Never expose this stack to the internet.

## Proposed mapping

| Fawran concept | Blnk concept | Fawran keeps |
| --- | --- | --- |
| Fawran customer | Identity | Phone number, auth, KYC and consent |
| EGP wallet | Balance on the Fawran EGP ledger | Fawran user ID and Blnk balance ID |
| Wallet transfer | Blnk transaction | API request, idempotency record and user-facing receipt |
| Provider settlement | External/system balance and reconciliation | Provider references, webhook evidence and settlement state |

Amounts remain integer piasters. Confirm Blnk's EGP precision behavior in the pinned version before creating production-like balances; never convert through floating point.

## Required adapter boundary

Create a `LedgerPort` abstraction in NestJS with operations for:

- create or retrieve a customer's EGP balance;
- read an authoritative balance;
- transfer between two balances;
- credit/debit a controlled system or settlement balance;
- retrieve transaction history and status;
- reconcile local references against Blnk.

The current PostgreSQL ledger remains active until the adapter passes the same contract tests. Do not dual-write a movement to both ledgers.

## Idempotency and uncertain outcomes

The published Blnk OpenAPI currently documents `POST /transactions` with a `reference`, but the reviewed schema does not expose an explicit idempotency-key header. Do not assume `reference` is unique or replay-safe.

Before switching any endpoint:
1. Verify the pinned Blnk version's transaction-reference uniqueness and duplicate behavior.
2. Persist the Fawran idempotency key, normalized request fingerprint, and state in Fawran PostgreSQL before calling Blnk.
3. On timeout, mark the operation as unknown/pending and query Blnk by a verified unique reference before retrying.
4. Reject reuse of a Fawran idempotency key with a different payload.
5. Add crash-recovery and concurrent-retry tests against real Blnk + PostgreSQL.

If Blnk cannot provide the needed atomic uniqueness guarantee, implement a durable integration outbox / operation state machine and do not claim exactly-once behavior without proving it.

## Rollout sequence

1. Start Blnk locally and confirm health, migrations, server and worker logs.
2. Create an EGP ledger and a test identity/balance using the pinned API.
3. Verify amount precision, balance reads, transaction semantics and error responses.
4. Implement the NestJS adapter behind a configuration flag, default OFF.
5. Run the existing ledger contract suite against both implementations.
6. Add parallel overdraft, duplicate request, changed-payload replay, timeout recovery, and reconciliation tests.
7. Only then migrate disposable test data and consider a controlled test-only cutover.

## Not in scope yet

- No customer ledger data migration.
- No switch of live Fawran wallet endpoints to Blnk.
- No payment provider or InstaPay integration.
- No real funds, production credentials, or public deployment.
- No removal of the existing ledger until a reviewed migration and rollback plan exists.

## References

- [Blnk open-source deployment](https://docs.blnkfinance.com/deploy/open-source)
- [Blnk API OpenAPI definition](https://github.com/blnkfinance/blnk-docs/blob/main/openapi.json)
- [Blnk API key scopes](https://docs.blnkfinance.com/operating/api-keys/scopes)
