# Fawran backend (core)

NestJS + PostgreSQL. Money is stored as integer piasters (1 EGP = 100). All money movement goes through a double-entry ledger (`src/ledger`), is idempotent, and is checked by `verifyIntegrity()`.

## Run

```bash
cp .env.example .env
docker compose up -d db
npm ci
npm run db:migrate
npm run dev
```

The API loads `.env` automatically when run from this service directory. Run `npm run db:migrate` after configuring the database and before the first API start or after deploying a new migration. API startup only verifies the schema version; it does not create or alter tables. Development OTP is `000000` (SMS is a console stub); production OTP requires a real `SmsPort` adapter.

## API

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | /auth/otp `{phone}` | no | Egyptian mobile numbers only |
| POST | /auth/verify `{phone,code}` | no | returns JWT (1h) |
| GET | /wallet, /transactions | yes | |
| POST | /wallet/topup `{amount,method}` | yes | requires `Idempotency-Key`; provider is mocked |
| POST | /transfers `{toPhone,amount,note?}` | yes | requires `Idempotency-Key` |
| POST | /links `{amount,description?}` | yes | creates payment code |
| GET | /links/:code | no | payer-facing metadata |
| POST | /links/:code/pay `{method}` | no | simulated payer checkout |

`npm test` runs against an in-memory Postgres emulator. Set `DATABASE_URL` to also run real-Postgres concurrency tests.

Before real-money use, implement a real payment provider, KYC and policy-based limits, refresh tokens, fraud/AML controls, reconciliation, refunds/disputes, cash-out, admin/audit tooling, migrations, security testing, and required legal/licensing work.
