# Production deployment and operations runbook

This runbook prepares infrastructure for a controlled, partner-backed release. It does not authorize real-money processing. Keep every market's real-money policy disabled until the market-specific approval process is complete.

## Deployment topology

- React Native + Expo app distributed through EAS / Apple App Store / Google Play.
- NestJS API behind an HTTPS reverse proxy or managed load balancer.
- Managed PostgreSQL with private networking, encryption at rest, automated backups and point-in-time recovery.
- Separate worker/scheduler process for cleanup, ledger verification, PSP reconciliation and notifications.
- Managed secret store. Never put server secrets in the mobile bundle, source control, logs or `EXPO_PUBLIC_*` variables.

## API environment

Set these in the API runtime secret/config store, not in the repository:

| Variable | Requirement |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | Runtime-assigned listening port |
| `DATABASE_URL` | Private TLS PostgreSQL connection string |
| `JWT_SECRET` | Unique random secret, minimum 32 characters |
| `OTP_PEPPER` | Separate unique random secret, minimum 32 characters |
| `SESSION_TOKEN_PEPPER` | Separate unique random secret, minimum 32 characters |
| `CORS_ORIGINS` | Exact comma-separated HTTPS origins for trusted browser clients; leave empty if no browser client |
| `TRUST_PROXY_HOPS` | Exact number of trusted proxy hops only after confirming network topology |
| `LEDGER_PROVIDER` | `postgres` unless a Blnk deployment is explicitly configured and reconciled |
| SMS credentials | Only after approved sender registration, provider contract and delivery testing |
| PSP credentials | Only after licensed partner contract, merchant/acquirer approval and sandbox certification |

Do not copy development values from `services/api/.env.example`. Do not expose Blnk, PostgreSQL, admin endpoints or PSP secrets publicly.

## Release sequence

1. Build immutable API and mobile artifacts from a reviewed commit.
2. Provision PostgreSQL in a private network; enable TLS and least-privilege application/migration roles.
3. Run the migration job once as a release step using the migration role. Do not let every API replica run migrations.
4. Verify `GET /health/live` and `GET /health/ready`.
5. Start API replicas with graceful shutdown enabled; keep at least one prior known-good artifact for rollback.
6. Deploy workers/schedulers separately with singleton/lease protection so cleanup and reconciliation jobs do not race.
7. Run smoke tests with synthetic accounts and test provider only.
8. Verify dashboards, alerts, logs, backups and restore procedure before exposing the app to pilot users.
9. Roll out gradually. Stop rollout automatically on elevated errors, latency, database saturation, reconciliation exceptions or security alerts.

## Scheduled controls

The API package currently exposes:
- `npm run auth:cleanup` — clean expired OTP challenges, stale rate-limit rows and long-expired/revoked sessions.
- `npm run ledger:verify` — verify PostgreSQL ledger invariants and cached balances.
- `npm run ledger:reconcile` — inspect pending/unknown Blnk ledger operations when Blnk is selected.

Schedule cleanup and ledger verification at least daily. Alert on any ledger integrity mismatch. Blnk inspection is not PSP settlement reconciliation; do not treat it as such. A real PSP reconciliation worker and exception queue remain a release blocker.

## Database resilience

- Enable automated encrypted backups and point-in-time recovery.
- Define and approve RPO/RTO targets before launch.
- Perform restore drills into an isolated environment and verify migrations, account balances, double-entry invariants and session revocation.
- Test failover, connection-pool behavior, long-running migrations and rollback/forward-fix procedures.
- Never use production personal data in development or test environments.

## Observability and incident response

Before pilot launch, provide:
- Structured JSON logs with request/correlation IDs; redact phone numbers, tokens, OTPs, payment credentials and personal data.
- Metrics for API latency/errors, auth abuse, payment-intent age/status, provider webhook lag, ledger posting failures, reconciliation exceptions and database health.
- Alerts with named on-call owners and escalation paths.
- Runbooks for suspected fraud, duplicate/unknown payments, PSP outage, ledger mismatch, credential compromise, data exposure and customer complaints.
- A process to freeze affected merchant/device/market capabilities without deleting financial evidence.

## Mobile release

- Use EAS development builds for native PSP SDK integration; Expo Go is not a valid SoftPOS test environment.
- Keep provider secrets on the server. Mobile app receives only short-lived device-bound session material.
- Validate iOS and Android on the provider's certified device/OS matrix.
- Complete Arabic RTL, accessibility, offline/error, biometric/session and deep-link QA.
- Submit Tap to Pay builds only after PSP SDK certification and (for iOS) Apple's entitlement and app review approval.

## Go-live gates

The release owner must collect signed evidence for each market:
- legal and regulatory opinion;
- licensed bank/PSP contract and permitted rails;
- merchant onboarding, KYC/KYB, AML/CFT, sanctions, limits and safeguarding ownership;
- PSP certification, webhook/reconciliation/refund/dispute sign-off;
- independent security assessment and critical/high issue remediation;
- backup/restore, incident response, support and customer disclosure readiness.

A successful build, green CI, complete configuration, or admin evidence dashboard does not independently enable real-money movement. The real-money safety policy remains hard-disabled until a separate reviewed release is approved.
