# Fawran

Egypt-first wallet and merchant payments prototype. The repository contains a React Native + Expo mobile app and a NestJS API backed by PostgreSQL.

> **Important:** This is a development prototype, not a licensed wallet, payment institution, bank, or live payment service. The payment provider is mocked and the OTP flow is development-only. Do not use real customer funds or personal data until the legal, regulatory, provider, security, and operational gates in `docs/PRODUCTION_READINESS.md` are complete.

## Repository layout

- `apps/mobile/` — React Native + Expo customer app (Arabic-first RTL, English option)
- `services/api/` — NestJS API and PostgreSQL ledger
- `docs/` — architecture, roadmap and production gates
- `.github/workflows/` — API and Expo CI

## API quick start

```bash
cd services/api
cp .env.example .env
docker compose up -d db
npm ci
npm run dev
```

The API listens on `http://localhost:3000`. Development OTP is `000000`. The API loads `.env` automatically when started from this directory.

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

The preview Android profile creates an APK; production creates an AAB for Google Play. EAS Free has limited monthly builds and low-priority queues; verify current quotas before release planning.

All amounts are integer piasters (100 piasters = EGP 1). Provider methods are placeholders and must not be represented as real InstaPay/card/mobile-wallet integrations. See `docs/ROADMAP.md` and `docs/PRODUCTION_READINESS.md`.
