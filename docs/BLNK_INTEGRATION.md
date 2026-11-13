# Blnk ledger integration decision

Status: Blnk adapter implemented behind an opt-in provider flag and covered by adapter tests. PostgreSQL remains the default provider. A real local Blnk end-to-end run and cutover validation are still required before enabling it.

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

The NestJS `LedgerPort` interface now defines the application-facing account, balance, transfer and history operations. The existing PostgreSQL `LedgerService` implements this interface and is registered as the current provider. Wallet and payment-link services now depend on the port token rather than the concrete PostgreSQL service. This is a refactor only: runtime behavior and the active ledger remain PostgreSQL. Next, implement the Blnk adapter and its durable mapping/state tables behind an explicit feature flag. The port must cover these operations:

- create or retrieve a customer's EGP balance;
- read an authoritative balance;
- transfer between two balances;
- credit/debit a controlled system or settlement balance;
- retrieve transaction history and status;
- reconcile local references against Blnk.

The current PostgreSQL ledger remains active by default. Select Blnk only with `LEDGER_PROVIDER=blnk`, `BLNK_LEDGER_ID`, and `BLNK_SYSTEM_BALANCE_ID` configured. The adapter uses Fawran's local account IDs and a durable mapping table; it never exposes Blnk IDs to the mobile app. It uses synchronous `skip_queue: true` posting, stable references derived from the Fawran idempotency key, and a durable operation state table. A timeout or pending result is not reported as success. On retry, the adapter first looks up the original Blnk reference. Do not dual-write a movement to both ledgers.

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

## Adapter implementation

- `BlnkLedgerAdapter` implements the same `LedgerPort` as the PostgreSQL ledger.
- `LEDGER_PROVIDER=postgres` is the default. `LEDGER_PROVIDER=blnk` is an explicit opt-in.
- `ledger_account_mappings` stores local account ID to Blnk balance ID mappings. Fawran accounts with no legacy PostgreSQL ledger entries are mapped lazily on first use; accounts with legacy ledger activity fail closed until a separately reviewed migration/reconciliation is performed. Balance creation is serialized with a PostgreSQL row lock and recovers a remote balance by its Fawran account metadata before creating another.
- `ledger_operations` stores request fingerprints, deterministic Blnk references, and operation states (`processing`, `pending`, `applied`, `failed`, `unknown`).
- Transfers send integer piasters as `precise_amount` with `precision: 100`, `currency: EGP`, and `skip_queue: true`. Only `APPLIED` is returned as successful. `QUEUED` and `INFLIGHT` remain pending; ambiguous outcomes fail closed and require retry/reconciliation with the same key.
- History reads applied transactions from both source and destination filters, deduplicates them, and signs amounts from the account perspective.
- `npm run ledger:reconcile` inspects local `processing`, `pending`, and `unknown` operations by their original Blnk references. It only updates local state; it never submits another financial movement. Exit code 2 means pending/unknown records still need investigation.
- The adapter uses the configured Blnk system balance for Fawran's `sys:provider` account. This balance must belong to the configured EGP ledger and must be a controlled test/settlement balance.

### Enabling locally (test data only)

1. Keep the local Blnk stack loopback-only and confirm the Blnk EGP ledger and system/funding balance exist.
2. In `services/api/.env`, set `LEDGER_PROVIDER=blnk`, `BLNK_BASE_URL=http://127.0.0.1:5001`, `BLNK_LEDGER_ID=<your EGP ledger id>`, and `BLNK_SYSTEM_BALANCE_ID=<your controlled system balance id>`.
3. Leave `BLNK_API_KEY` blank only for the local instance with secure mode disabled. Use a scoped secret key when secure mode is enabled; never commit it.
4. Restart the API. New wallet reads lazily create Blnk balances and persist their mapping. Existing PostgreSQL balances are not migrated or copied. Accounts with legacy ledger entries are deliberately blocked from lazy mapping; use fresh disposable test users and fund only through the test provider.
5. To inspect uncertain operations, run `npm run ledger:reconcile` from `services/api` with the same Blnk environment and database connection. Review any pending/unknown records before retrying user requests.
6. To roll back, set `LEDGER_PROVIDER=postgres` and restart. Do not switch back and forth for accounts that have already received Blnk transactions: the PostgreSQL ledger will not contain those movements.

The automated adapter tests mock the Blnk HTTP API and cover durable account mapping, integer-piaster precision, idempotent replay, and changed-payload rejection. They do not replace a live integration test against the pinned Blnk container, particularly for balance filter response shape, transaction errors, timeout recovery, and the configured system balance.

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
