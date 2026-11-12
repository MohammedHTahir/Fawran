# GitHub repository

Repository: https://github.com/MohammedHTahir/Fawran
Default branch: `main`

The current mobile client is React Native + Expo under `apps/mobile/`; the NestJS API remains under `services/api/`. Never commit `.env` files, signing keys, service-account credentials, EAS tokens, or production secrets. Use GitHub Actions secrets and EAS environment variables. `EXPO_PUBLIC_API_URL` is public client configuration, not a secret.
