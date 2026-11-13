# Blnk ledger integration decision

Status: local Blnk infrastructure and disposable EGP ledger behavior verified; NestJS adapter is not implemented or enabled.

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

Amounts remain integer piasters (100 piasters = EGP 1). Send `precise_amount` and `precision: 100` for EGP transactions. Do not convert through floating point or use Blnk's display `amount` as the authoritative amount.

## Local verification against 0.15.7

The following disposable test was performed against the local instance on 2026-11-13:

- Created one EGP ledger and two balances.
- Credited Wallet A with 1,000 piasters.
- Transferred 250 piasters from Wallet A to Wallet B using `skip_queue: true`; Blnk returned `APPLIED`.
- Read balances from Blnk: Wallet A = 750 piasters; Wallet B = 250 piasters; total = 1,000 piasters.
- Looked up the original transfer by reference; it remained `APPLIED`.
- Reposted the same reference with the default queue path. The API returned `QUEUED` with a different transaction ID, but a subsequent GET by that ID returned `TXN_NOT_FOUND`, both queue-child filters returned zero records, and both wallet balances remained unchanged.
- Reposted the same reference with `skip_queue: true`. Blnk returned `TXN_DUPLICATE_REFERENCE`.

Interpretation: the pinned instance demonstrated no second posted movement for the duplicate tests, and the synchronous duplicate was explicitly rejected. The queued duplicate response is not a final transaction result; the adapter must never treat a `QUEUED` response as proof of posting. It must resolve the original operation by its stable reference and inspect the original transaction's final status.

### Precision response caveat

The balance reads and `precise_amount: 250` confirmed the expected piaster arithmetic. However, the transaction-reference lookup returned `precision: 0` while the queued duplicate response echoed `precision: 100`. Treat this as a response-field inconsistency to investigate against the pinned version. Fawran must own its EGP scale constant (100 piasters per EGP), persist integer piasters, and avoid deriving money values from Blnk's floating-point `amount` or returned `precision` field.

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

Blnk transaction `reference` is unique. The local tests confirmed that a synchronous duplicate returns `TXN_DUPLICATE_REFERENCE`. The default queued duplicate path returned a `QUEUED` response that could not subsequently be retrieved by its returned transaction ID; the original reference still resolved to the original applied transaction and balances did not change. Do not interpret the queued response as a new applied transaction or as a definitive duplicate error.

Blnk queues transactions by default and initially returns `QUEUED`; the worker later processes or rejects queued operations. For deterministic low-volume API tests, `skip_queue: true` requests synchronous processing. Production integration must still handle timeouts and queued states explicitly.

Before switching any endpoint:
1. Persist the Fawran idempotency key, normalized request fingerprint, and operation state in Fawran PostgreSQL before calling Blnk.
2. Generate a stable, unique Blnk reference for each Fawran operation and never reuse it for a different operation.
3. On timeout or duplicate-reference response, query Blnk by the original reference and inspect the original transaction's final status; never blindly issue a new reference for a retry.
4. Reject reuse of a Fawran idempotency key with a different payload.
5. Add crash-recovery and concurrent-retry tests against real Blnk + PostgreSQL.
6. Treat `QUEUED` as pending, not successful; reconcile until a terminal status is known.
7. Keep all amounts in integer piasters and use a fixed Fawran EGP scale of 100.

If Blnk cannot provide the needed atomic uniqueness guarantee, implement a durable integration outbox / operation state machine and do not claim exactly-once behavior without proving it.

## Rollout sequence

1. Start Blnk locally and confirm health, migrations, server and worker logs.
2. Create an EGP ledger and test balances using the pinned API.
3. Verify balance arithmetic, precision, transaction status and duplicate-reference behavior. (Local disposable test completed; see above.)
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
