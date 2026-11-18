# Fawran

Multi-market wallet, rewards and merchant-payments prototype. The repository contains a React Native + Expo mobile app and a NestJS API backed by PostgreSQL.

> **Important:** This is a development prototype, not a licensed wallet, payment institution, bank, or live payment service. Payment processing is mocked and production SMS delivery is intentionally unconfigured. Do not use real customer funds or production personal data until the legal, regulatory, licensed-partner, security, and operational gates in `docs/PRODUCTION_READINESS.md` are complete.

## Repository layout

- `apps/mobile/` — React Native + Expo customer app (Arabic-first RTL, English option)
- `services/api/` — NestJS API and PostgreSQL ledger
- `infra/blnk/` — optional pinned Blnk Core development stack
- `docs/` — architecture, roadmap, integration notes, and production gates
- `.github/workflows/` — API, mobile, and live Blnk integration CI

## API quick start

```bash
cd services/api
cp .env.example .env
docker compose up -d db
npm ci
npm run db:migrate
npm run dev
```

The API listens on `http://localhost:3000`. Development OTP is `000000`; test onboarding supports AE, EG, SA, GB and US. Production OTP requires separately managed `JWT_SECRET`, `OTP_PEPPER`, and `SESSION_TOKEN_PEPPER` values plus an approved SMS provider configuration. An optional Twilio adapter is implemented, but it remains disabled until credentials, country-specific sender registration and carrier approvals are configured. The API loads `.env` automatically when started from this directory. Schema migrations are an explicit deployment step and are not run automatically at API startup.

## Mobile quick start

Install Node.js 22.13+ and npm:

```bash
cd apps/mobile
npm install
copy .env.example .env
npx expo start
```

Set `EXPO_PUBLIC_API_URL` to a reachable API. Use `http://10.0.2.2:3000` for Android emulators, `http://localhost:3000` for iOS simulators, and a LAN or HTTPS URL for physical devices. Cloud previews require a publicly reachable HTTPS staging API. Never put secrets in `EXPO_PUBLIC_*` variables.

## Cloud builds

```bash
cd apps/mobile
npx eas-cli@latest login
npx eas-cli@latest build:configure
npx eas-cli@latest build --platform android --profile preview
```

The preview Android profile creates an APK; production creates an AAB for Google Play. Verify current EAS quotas before release planning.

All monetary amounts are integer minor units and each account/transaction carries an explicit currency. EGP top-ups remain a test-only flow; personal payment-link checkout uses simulated providers; merchant settlement, payouts, live FX and real-money movement remain disabled. Test FX quotes are previews only and cannot be executed. Provider methods must not be represented as real InstaPay/card/mobile-wallet integrations. See `docs/REAL_MONEY_SAFETY.md`, `docs/MULTI_MARKET_PRODUCT_PLAN.md` and `docs/MULTI_MARKET_OPERATIONS.md`.
