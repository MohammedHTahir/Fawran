# Fawran Mobile — React Native + Expo

Arabic-first RTL with an English toggle. The Expo app uses SecureStore for session tokens and connects to the existing NestJS API. It is a prototype: OTP is development-only and payment provider methods are mocked.

## Run

```bash
npm install
cp .env.example .env
npx expo start
```

Set `EXPO_PUBLIC_API_URL` to a reachable API. Use `http://10.0.2.2:3000` for an Android emulator, `http://localhost:3000` for an iOS simulator, and a reachable LAN or HTTPS URL for a physical device. Cloud previews and hosted test devices require a public HTTPS staging API; localhost will not work there.

## Cloud builds

```bash
npx eas-cli@latest login
npx eas-cli@latest build:configure
npx eas-cli@latest build --platform android --profile preview
npx eas-cli@latest build --platform ios --profile preview
```

The preview Android profile creates an APK; production creates an Android App Bundle. Set `EXPO_PUBLIC_API_URL` in the EAS build environment. EAS Free has monthly build quotas and low-priority queues; check current pricing before planning releases.

Implemented: phone/OTP login, wallet, recent activity, mock top-up, P2P transfers with confirmation and idempotency keys, receipt, payment-code creation/sharing, language switch and logout.

Not implemented: public payer checkout, request money, split bill, QR, KYC, cash-in/out locator, merchant dashboard, push notifications, biometric app lock, and real payment/SMS integrations. Do not enter real customer data or represent this as a live wallet.
