# Multi-market onboarding and currency-aware links

## User market identity

New users select one of the currently catalogued markets: AE, EG, SA, GB or US. OTP phone numbers are validated with libphonenumber and stored in E.164 format. Each user receives an immutable-at-the-API-level country code and default currency:

| Market | Country code | Default currency |
|---|---|---|
| United Arab Emirates | AE | AED |
| Egypt | EG | EGP |
| Saudi Arabia | SA | SAR |
| United Kingdom | GB | GBP |
| United States | US | USD |

Existing Egyptian phone numbers are migrated to E.164 and retain EG/EGP as their default market. Existing sessions are hydrated from the user record.

The mobile app now collects a market during onboarding and lets a sender choose the recipient's country for phone-based transfers. Transfers still require both users to have a wallet in the same currency; there is no implicit FX conversion.

## Wallets and payment links

The default wallet is selected from the user's market profile. Users can create additional wallets from the supported currency catalog. Top-ups remain EGP-only test flows; a non-EGP user must explicitly create an EGP wallet before using that prototype top-up flow.

Personal payment links can be created against any wallet the user owns. Public checkout uses the development mock provider and an isolated system provider account for the link's currency. The response is explicitly marked `testOnly: true` and `realMoney: false`.

Merchant payment links remain blocked until the merchant's settlement account is enabled by the separate licensed-partner and market approval process. KYB approval alone does not enable settlement.

## Safety and rollout

- Country selection is a product routing/default-currency choice, not proof of legal availability.
- Phone validation does not establish KYC identity.
- Country-specific SMS sender registration and carrier approval are external prerequisites.
- No real PSP, bank, FX rate source, cash-in/out, merchant settlement or payout is enabled.
- Wallet currency is never inferred from a phone prefix after onboarding; the user's stored market/default currency is used.
- Cross-currency transfers remain prohibited. FX requires a separate quote, consent, fee disclosure and linked accounting entries before any future execution.
