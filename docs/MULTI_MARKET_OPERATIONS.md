# Multi-market operations controls

## Admin access

The operations API uses explicit active admin roles:

- `super_admin`: all operational scopes.
- `compliance_admin`: risk cases and market readiness gates.
- `support_admin`: support queue and customer case status.
- `finance_admin`: operations overview, audit and market readiness gates.

Admin actions are written to the append-only `admin_audit_events` table.

## Risk cases

Compliance administrators can create, list and resolve risk cases linked to a user, merchant or payment intent. Cases have a market, category, severity and lifecycle status. This is a case-management foundation, not an AML/sanctions screening provider or a legal determination.

## Customer support

Customers can create and view their own support cases. Support administrators can view the queue and update case status. Customer access is scoped to the authenticated user's records.

## Market readiness

Each catalog market has eight independent evidence gates:

- Legal opinion
- Regulatory permission
- Licensed partner
- KYC/AML controls
- Security assessment
- Settlement reconciliation
- Support readiness
- Customer disclosures

Evidence submission and approval are separate actions. A different administrator must approve a submitted gate (maker-checker). A verified gate is not a launch approval.

The market registry remains code-hard-disabled for real-money operations. There is deliberately no endpoint or environment variable that activates a market. All countries remain `realMoneyEnabled: false`, even when every evidence gate is verified. A separate reviewed release is required after legal, regulator, partner, security, finance and operations sign-off.
