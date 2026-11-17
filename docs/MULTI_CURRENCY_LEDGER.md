# Multi-currency ledger foundation

Status: implementation foundation in progress. This document describes the first runtime slice; it is not a market launch approval.

## Currency and amount contract

- Every wallet account has one ISO 4217 currency code. The account currency is selected at creation and must not be changed in place.
- Amounts crossing API/ledger boundaries are integer minor units. Do not use floating point for money.
- The market catalog supplies each currency's minor-unit precision.
- Transfers are allowed only between accounts with the same currency. FX is not implemented by this slice and must never be simulated by transferring unlike currencies.
- Ledger transaction history carries the transaction currency.
- Existing accounts remain EGP with their existing integer balances. Migration 6 does not rewrite, re-denominate, or copy any balance.

## Runtime endpoints

Authenticated API endpoints:

- `GET /wallets` — list the user's currency wallets and integer minor-unit balances.
- `POST /wallets` with `{"currency":"AED"}` — create a zero-balance wallet for a currency in the market catalog. Repeating the request returns the existing wallet.
- `GET /wallet?currency=AED` — read one wallet.
- `GET /transactions?currency=AED` — read that wallet's history.
- `POST /transfers` accepts optional `currency`; it resolves both sender and recipient wallets in that currency and rejects cross-currency movement.

The legacy wallet and payment top-up endpoints remain EGP-defaulted. Top-ups are still test-provider prototype flows, not live deposits. Currency-specific merchant payment links and checkout are a later phase.

## PostgreSQL migration

Migration 6:
- Preserves all existing accounts as EGP.
- Replaces the single-wallet-per-user uniqueness rule with uniqueness per user and currency.
- Adds currency to ledger transactions, payment attempts and payment links.
- Removes the EGP-only check from payment intents and validates ISO-style three-letter currency codes.

Deploy the migration as an explicit deployment step before deploying this API revision. The API startup guard will reject an outdated schema. Back up and verify the database before applying any production migration. No account balance conversion is performed.

## Blnk configuration

Blnk mode now resolves a distinct ledger and system balance configuration per currency. Existing EGP variables remain valid:

- `BLNK_LEDGER_ID` and `BLNK_SYSTEM_BALANCE_ID` (EGP compatibility)
- `BLNK_LEDGER_ID_AED` and `BLNK_SYSTEM_BALANCE_ID_AED`
- `BLNK_LEDGER_ID_SAR` and `BLNK_SYSTEM_BALANCE_ID_SAR`
- `BLNK_LEDGER_ID_GBP` and `BLNK_SYSTEM_BALANCE_ID_GBP`
- `BLNK_LEDGER_ID_USD` and `BLNK_SYSTEM_BALANCE_ID_USD`

Provision and verify each currency ledger and its system balance in Blnk before creating accounts in that currency while Blnk is selected. Do not point multiple currencies at the same ledger/balance. Existing PostgreSQL ledger history is not automatically migrated to Blnk; the adapter continues to fail closed for wallets with legacy PostgreSQL activity.

## Not yet implemented

- A database-level immutable-currency trigger and independent PostgreSQL integration test for it.
- Multi-country phone onboarding and country-aware KYC.
- Currency-aware test payment provider, payment links, refunds, payouts and FX.
- Rewards points ledger, merchant ecosystem, operations console and market-specific compliance workflows.
- Blnk provisioning/reconciliation validation against a real Blnk instance.

## Safety boundary

All production payment activation remains hard-disabled. Creating a wallet creates only a zero-balance ledger account. No cash-in, cash-out, card charge, merchant settlement, payout, customer FX or cash-value rewards are enabled. A market catalog entry is not regulatory approval.
