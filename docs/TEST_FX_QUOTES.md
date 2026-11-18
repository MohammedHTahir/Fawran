# Test-only FX quote workflow

Fawran can store administrator-configured synthetic test rates and produce preview quotes for currency pairs. This validates integer arithmetic, fees, idempotency and quote expiry without using a live FX source.

## Configure a test rate

A finance administrator can call `POST /admin/fx/test-rates` with:

- Source and target currency.
- Positive rational rate numerator and denominator (target major units per source major unit).
- Fee in basis points.
- A source label. The API prefixes it with `test:`.

The endpoint is disabled in production.

## Create and retrieve a quote

- `POST /fx/test/quotes` requires an authenticated user and `Idempotency-Key`.
- `GET /fx/test/quotes/:quoteId` returns only the authenticated user's quote.
- Quotes expire after five minutes.
- Conversion and fee calculations use integer/BigInt arithmetic and the market currency minor-unit metadata.
- Reusing an idempotency key with different inputs is rejected.

Every response is marked `testOnly: true`, `executable: false`, `realMoney: false` and `ledgerPosted: false`.

There is deliberately no FX execution endpoint. Quotes do not reserve funds, move balances, create ledger entries or imply that a rate is current or executable. A production FX implementation requires an approved rate source, quote disclosure, consent, spread/fee rules, expiry and two-sided ledger accounting.
