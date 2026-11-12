# Fawran app (Flutter prototype)

Arabic-first (RTL) with English toggle. Talks to `fawran-backend`. Uses fake money (mock provider).

## Run
```bash
flutter create --platforms=android,ios .     # generates android/ and ios/ folders (once)
flutter pub get
flutter analyze && flutter test
flutter run --dart-define=API_URL=http://10.0.2.2:3000     # Android emulator -> your machine
# iOS simulator: --dart-define=API_URL=http://localhost:3000
```
Android debug builds need cleartext HTTP to reach a local server: in `android/app/src/debug/AndroidManifest.xml`
add `android:usesCleartextTraffic="true"` to `<application>`. Never ship that in release builds; use HTTPS.

Start the backend first (`docker compose up -d db && npm run dev` in `fawran-backend`). Sign in with any Egyptian
mobile number; the dev code is `000000`. Create two accounts to test sending money between them.

## Screens built
Sign-in (phone + code), Home (balance, top-up sheet, quick actions, recent), Send money (with confirm and receipt),
Payment link (create + copy), Activity, Account (language, log out).

## Not built yet
Request money, Split bill, QR, KYC onboarding, cash-in/out map, business dashboard, the public payer web page,
push notifications, biometric lock, refresh tokens (session ends after 1 hour), app icon/branding assets, a bundled Arabic font.
