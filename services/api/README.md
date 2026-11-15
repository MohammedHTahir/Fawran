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

The API loads `.env` automatically when run from this service directory. Run `npm run db:migrate` after configuring the database and before the first API start or after deploying a new migration. API startup only verifies the schema version; it does not create or alter tables. Development OTP is `000000` (SMS is a console stub). OTP challenges and send limits are stored in PostgreSQL; codes are HMAC-SHA256 digests using `OTP_PEPPER` (production requires a separate random secret of at least 32 characters). Production OTP can use the optional Twilio Programmable Messaging adapter when `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and either `TWILIO_MESSAGING_SERVICE_SID` or `TWILIO_FROM` are configured; otherwise it fails closed. For Egypt, obtain an approved/pre-registered sender ID and confirm delivery with the target networks before enabling it. Configure secrets through managed secret storage, not source control. Migration 2 creates OTP challenge/send-limit tables; migration 3 adds verification-IP throttling; migration 4 creates rotating auth sessions. Access tokens last 15 minutes; refresh tokens last 30 days and are rotated on use. Reuse of a previously rotated refresh token revokes all of that user's sessions. The `SESSION_TOKEN_PEPPER` must be a separate random secret of at least 32 characters in production. An optional Twilio Programmable Messaging adapter is available for production once account credentials and a registered Egypt sender are configured.

## API

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | /auth/otp `{phone}` | no | Egyptian mobile numbers only |
| POST | /auth/verify `{phone,code}` | no | returns 15-minute access token and 30-day refresh token |\n| POST | /auth/refresh `{refreshToken}` | no | rotates refresh token and returns a new access token |\n| POST | /auth/logout | yes | revokes current session immediately |\n| POST | /auth/logout-all | yes | revokes all sessions for the user |\n| GET | /auth/sessions | yes | lists active sessions |\n| DELETE | /auth/sessions/:id | yes | revokes a session |
| GET | /wallet, /transactions | yes | |
| POST | /wallet/topup `{amount,method}` | yes | requires `Idempotency-Key`; provider is mocked |
| POST | /transfers `{toPhone,amount,note?}` | yes | requires `Idempotency-Key` |
| POST | /links `{amount,description?}` | yes | creates payment code |
| GET | /links/:code | no | payer-facing metadata |
| POST | /links/:code/pay `{method}` | no | simulated payer checkout |

`npm test` runs against an in-memory Postgres emulator. Set `DATABASE_URL` to also run real-Postgres concurrency tests.

Before real-money use, implement a real payment provider, KYC and policy-based limits, refresh tokens, fraud/AML controls, reconciliation, refunds/disputes, cash-out, admin/audit tooling, migrations, security testing, and required legal/licensing work.
