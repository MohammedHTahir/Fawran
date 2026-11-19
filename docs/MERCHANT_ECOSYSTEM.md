# Fawran merchant ecosystem

Status: merchant onboarding and KYB workflow foundation implemented. Merchant settlement and live checkout remain disabled.

## Merchant lifecycle

1. An authenticated user registers a merchant with legal name, display name, country and settlement currency.
2. The country/currency pair must match the reviewed market catalog.
3. Fawran creates a separate zero-balance business ledger account and an owner membership.
4. Merchant status starts as `pending`; KYB starts as `not_started`.
5. The owner/admin submits a registration number and required document-type metadata. Actual document uploads and secure evidence storage are not included in this slice.
6. A compliance administrator reviews the case and records an approved, rejected or needs-information decision. Every decision creates an admin audit event.

## Endpoints

- `POST /merchants` — register a business.
- `GET /merchants/me` — list the user's merchant memberships.
- `GET /merchants/:id/members` — list members and their merchant-scoped roles.
- `POST /merchants/:id/stores` — create a draft store in a supported market.
- `GET /merchants/:id/stores` — list merchant stores.
- `PATCH /merchants/:id/stores/:storeId` — update store details; only owners/admins can activate or suspend a store.
- `POST /merchants/:id/invitations` — invite an existing Fawran user by E.164 phone number.
- `GET /merchants/:id/invitations` — list merchant invitations (owner/admin).
- `DELETE /merchants/:id/invitations/:invitationId` — revoke a pending invitation.
- `GET /merchant-invitations/me` — list invitations for the authenticated user.
- `POST /merchant-invitations/:id/accept` — accept an invitation addressed to the authenticated user.
- `PATCH /merchants/:id/members/:userId/role` — update a member's role.
- `DELETE /merchants/:id/members/:userId` — remove a member.
- `GET /merchants/:id` — merchant profile and business account balances.
- `GET /merchants/:id/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD` — payment-link activity and paid volume grouped by currency (owner/admin/manager/viewer).
- `POST /merchants/:id/accounts` — create another currency account.
- `POST /merchants/:id/kyb/submit` — submit KYB metadata.
- `GET /admin/merchants/kyb` — list open KYB cases.
- `POST /admin/merchants/:id/kyb/decision` — compliance decision.
- `POST /merchants/:id/payment-links` — create a merchant payment link and QR payload.
- `POST /merchants/:id/offers` / `GET /merchants/:id/offers` — create/list draft offers.
- `POST /merchants/:id/campaigns` / `GET /merchants/:id/campaigns` — create/list merchant-funded reward campaign drafts.

## Admin provisioning

There is intentionally no endpoint to grant administrator privileges. Provision an administrator through a controlled database operation in the deployment environment:

```sql
insert into admin_roles(user_id, role)
values ('<approved-user-id>', 'compliance_admin');
```

Available roles: `super_admin`, `compliance_admin`, `support_admin`, `finance_admin`. Review access regularly and audit all decisions.

## Settlement and campaign gates

- Merchant ledger accounts are separate from customer wallets.
- `merchant_accounts.settlement_status` is always `blocked` in this implementation.
- KYB approval enables merchant profile/commerce configuration, not live payment acceptance or payouts.
- Merchant payment links may be created in a supported currency, but checkout is currently enabled only for the EGP test-provider path. Non-EGP checkout fails closed until payment orchestration supports it.
- Merchant reward campaigns are created as `pending_funding`; no merchant funds are collected or reserved, and points issuance remains disabled.
- Offers remain `draft`; publishing/fulfilment is a later step.

## Remaining work

- Secure KYB document upload, verification and retention controls.
- Merchant team invitations are not implemented; members must already have Fawran accounts. Merchant-scoped role management is implemented: owners can assign admin/manager/viewer; admins can manage manager/viewer only. The owner cannot be demoted or removed, and users cannot change or remove their own membership.
- Store QR presentation and richer merchant analytics (store-level attribution and payment timestamps once those are captured).
- Partner-funded balance reservation, payment capture, refunds, settlement and payouts.
- Campaign approval, budget reservation, spend caps, reversals and rewards fulfilment.
- Risk scoring, merchant monitoring and ongoing KYB refresh.

This is an operational foundation, not a license, KYB decision, settlement account or payment-provider approval.


## Merchant analytics

The initial analytics endpoint reports payment-link cohorts by link creation date. It returns link counts, paid/open/inactive counts, paid conversion basis points and paid volume per currency. Monetary amounts are minor units; currencies are never added together. Paid volume reflects the current `paid` status of links created during the selected period, not a payment-event timestamp. This avoids presenting link creation time as the actual collection date. Date ranges are inclusive and default to the latest 30 calendar days.
