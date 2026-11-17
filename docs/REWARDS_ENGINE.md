# Fawran Rewards Engine

Status: first points-ledger slice implemented; merchant campaign activation remains gated on the merchant and funding workflows.

## Points are not money

- Rewards use a separate integer `POINTS` unit and separate ledger accounts.
- Points are not a wallet currency, cannot be transferred to cash wallets, and have no automatic cash/FX conversion.
- Every earn, redeem and expiry creates balanced double-entry reward-ledger entries.
- Customer point balances cannot go below zero.
- Earn operations require an idempotency key and a trusted server-side caller. There is no public earn endpoint.

## Implemented API and service operations

- `GET /rewards` returns points balance, lifetime earned points, tier, referral code and recent history.
- `POST /rewards/referrals/claim` claims another user's referral code once.
- `RewardsService.earn(...)` is the internal settlement hook for a trusted, confirmed transaction.
- `RewardsService.redeem(...)` consumes unexpired reward lots FIFO and refuses insufficient balances.
- `RewardsService.expireDue(...)` expires only unspent points from expired lots and is safe to retry.
- `RewardsService.qualifyReferral(...)` awards both inviter and invitee only when called by a trusted qualification workflow. Each reward has its own idempotency key.

Tier thresholds are lifetime earned points: Starter 0, Bronze 1,000, Silver 10,000 and Gold 50,000. Redemptions do not reduce lifetime earned points.

## Campaign foundation

Migration 7 creates campaign records with:
- Funding source: Fawran or merchant
- Explicit funding currency and integer minor-unit budget
- Spent amount, points-per-minor-unit, per-user cap, date window and lifecycle status

Campaigns default to `draft`. Merchant campaigns cannot be activated until the merchant exists, KYB is approved, and an approved funding/reservation flow exists. This slice does not spend merchant funds or issue campaign rewards automatically.

## Remaining work

- Merchant onboarding, KYB review and merchant-account linking.
- Campaign create/approve/fund/activate controls and merchant-specific spend caps.
- Connect trusted earn/qualification hooks to settled test-provider payment events.
- Reward offer catalog, redemption fulfilment and reversal/refund handling.
- Scheduled expiry worker and operational monitoring.
- Fraud controls for referrals, self-referrals, device/account farms and campaign abuse.

No rewards operation enables cash payouts, cash-equivalent balances or live payment activity.
