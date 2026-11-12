# Fawran

Egypt-first wallet and merchant payments platform. This repository combines the Flutter mobile app and NestJS API from the supplied Claude prototype, with a staged plan to evolve it safely.

> **Important:** This is a development prototype. It is not a licensed wallet, payment institution, bank, or live payment service. The included payment provider is a mock. Do not use real customer funds or personal data until the legal, regulatory, provider, security, and operational gates in `docs/PRODUCTION_READINESS.md` are complete.

## Repository layout

- `apps/mobile/` — Flutter customer app (Arabic-first, RTL, English option)
- `services/api/` — NestJS API and PostgreSQL ledger
- `docs/` — architecture, delivery roadmap, security and production gates
- `.github/workflows/` — CI checks

## Quick start

### API

```bash
cd services/api
cp .env.example .env
docker compose up -d postgres
npm ci
npm run dev
```

API defaults to `http://localhost:3000`. Development OTP is `000000`; this is deliberately not a production flow.

### Flutter

Install Flutter 3. Add platform folders if absent:

```bash
cd apps/mobile
flutter create --platforms=android,ios .
flutter pub get
flutter run --dart-define=API_URL=http://10.0.2.2:3000
```

Use `http://localhost:3000` for iOS simulator; Android emulator uses `10.0.2.2`. A physical device needs the reachable LAN API address.

## Implemented API surface

- `POST /auth/otp`, `POST /auth/verify`
- `GET /wallet`, `GET /transactions`
- `POST /wallet/topup`
- `POST /transfers`
- `POST /links`, `GET /links/:code`, `POST /links/:code/pay`

All amounts are integer piasters (100 piasters = EGP 1). Provider methods are placeholders and must not be represented as InstaPay/card/wallet production integrations.

## Delivery plan

See `docs/ROADMAP.md` for the revised phases and acceptance criteria. See `docs/PRODUCTION_READINESS.md` for hard release blockers.
