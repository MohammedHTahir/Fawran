# Fawran backend (core)

NestJS + PostgreSQL. Money is stored as integer **piasters** (1 EGP = 100). All money movement goes through a
double-entry ledger (`src/ledger`), is idempotent, and is checked by `verifyIntegrity()`.

## Run
```bash
docker compose up -d db
cp .env.example .env && export $(cat .env | xargs)
npm install && npm run dev        # http://localhost:3000
```
Dev OTP is always `000000` (SMS is logged to the console). Production OTPs are random and need a real SMS adapter (`SmsPort`).

## API
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | /auth/otp `{phone}` | no | Egyptian mobile numbers only |
| POST | /auth/verify `{phone,code}` | no | returns JWT (1h) |
| GET | /wallet, /transactions | yes | |
| POST | /wallet/topup `{amount,method}` | yes | needs `Idempotency-Key` header |
| POST | /transfers `{toPhone,amount,note?}` | yes | needs `Idempotency-Key` header |
| POST | /links `{amount,description?}` | yes | create payment link |
| GET | /links/:code | no | what the payer sees |
| POST | /links/:code/pay `{method}` | no | payer needs no account |

## Tests
`npm test` runs against an in-memory Postgres emulator. Set `DATABASE_URL` to also run the **concurrency tests on real Postgres**
(parallel double-spend, same-key replay, opposite-direction deadlock). Run those in CI.

## Not built yet / must be done before real money
- Real payment provider adapter (`src/provider`): the mock is for development only.
- KYC tiers and limits (`LIMITS` in `src/wallet/wallet.ts` are placeholders, not policy).
- Refresh tokens, device binding, OTP rate limiting per IP/device, fraud rules, AML monitoring.
- Reconciliation job for links stuck in `processing` (charge succeeded, ledger write failed) and provider settlement files.
- Fees, refunds, disputes, cash-out, admin back-office, audit log, migrations tool (schema is created on boot for now).
- Security review, penetration test, and the licensing/legal work described in the development plan.
