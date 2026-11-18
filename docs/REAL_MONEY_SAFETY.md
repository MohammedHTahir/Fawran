# Real-Money Safety Boundary

Fawran remains a development and test product. Real-money operations are disabled in every market.

## What remains disabled

- Cash-in and wallet top-ups using real payment instruments.
- Cash-out, bank transfers, card payouts and mobile-wallet payouts.
- Live card acquiring, InstaPay or other domestic payment-rail connections.
- Merchant settlement and business payouts.
- FX conversion involving customer funds.
- Any reward redemption that promises or pays cash value.

## What may be tested

- Simulated provider responses in development/test environments.
- Isolated test wallets and test ledgers with clearly labeled non-cash balances.
- Internal ledger contract tests and Blnk sandbox/local integration tests.
- Rewards points as a non-cash test unit, provided they cannot be withdrawn or represented as customer funds.

## Activation is not an environment toggle

No environment variable, dashboard switch, successful CI run or Blnk deployment is sufficient to activate real-money movement. A future activation requires a reviewed code change and release after documented sign-off from legal/compliance, the licensed provider, security, finance/operations and product owners for the specific market.

Production deployments must fail closed when a live provider, signed webhook verification, provider-side idempotency, settlement reconciliation or market approval is missing.

## Current market registry

The API market registry is a planning catalog for test onboarding and currency defaults. It deliberately reports production payments disabled and its real-money policy always returns false. Adding a country to the catalog can enable test-only onboarding, but never enables live payments, cash-in/out, merchant settlement or FX execution.

## Incident rule

If a live provider is accidentally configured before approval, do not route traffic to it. Disable the credential at the provider, revoke exposed keys, preserve logs and ledger records, and follow the incident-response process.
