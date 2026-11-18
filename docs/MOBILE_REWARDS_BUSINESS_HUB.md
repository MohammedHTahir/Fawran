# Mobile rewards and business hub

The mobile customer app exposes the existing rewards and merchant APIs through two additional surfaces.

## Rewards

- Displays POINTS balance, lifetime earned points, tier and points history.
- Displays and shares the user's referral code.
- Allows a user to claim another user's referral code.
- Points remain a separate non-cash unit. No cash redemption or wallet credit is exposed in the app.

## Business account

- Lists businesses owned by the authenticated user and allows a new business to be registered.
- Displays the merchant's KYB, lifecycle and settlement status.
- Submits KYB registration metadata and the required document-type checklist.
- Allows creation of additional currency accounts.
- After KYB approval, exposes merchant payment-link, offer and points-campaign creation.

## Explicit limitations

- The KYB screen submits document metadata; it does not upload or verify the underlying documents.
- Merchant checkout remains blocked while settlement is blocked.
- The app copies the returned checkout path; it does not render a QR image.
- Offers remain drafts and points campaigns remain pending funding until the backend funding/publishing workflows are implemented.
- There is no cash-out, live merchant settlement or real-money rewards redemption.
