# Fawran Mobile UI Design System

Status: living design specification  
Applies to: `apps/mobile` (Expo / React Native)  
Product direction: global business and personal finance workspace

## Product experience principles

1. **Clarity before decoration.** Amounts, currency, recipient, fees, dates, and transaction states must be immediately legible.
2. **Trust through honest status.** Never present a simulated, pending, or unverified payment as completed or live.
3. **Progressive disclosure.** Keep the home screen focused; place filters, account controls, and secondary details on their own screens.
4. **Predictable actions.** Primary actions are visually distinct; destructive and irreversible actions require a clear confirmation.
5. **Privacy by default.** Balance visibility can be toggled. Avoid exposing sensitive account details in decorative surfaces.
6. **International by design.** Arabic RTL and English LTR are supported as first-class layouts, not afterthoughts.

## Visual tokens

| Token | Value | Use |
|---|---|---|
| Primary teal | `#08665D` | Brand, navigation selection, important actions |
| Deep teal | `#064B45` | High-emphasis balance surface |
| Lime | `#DDF477` | Primary CTA accent |
| Ink | `#152824` | Main text |
| Muted | `#71817B` | Secondary text |
| Background | `#F5F8F6` | App canvas |
| Surface | `#FFFFFF` | Cards, sheets, fields |
| Border | `#E6EDE9` | Dividers and outlines |
| Pale teal | `#EDF6F2` | Soft surfaces and selected states |
| Error | `#B93838` | Errors and destructive actions |

### Shape and spacing

- Use an 8-point spacing rhythm; prefer 8, 12, 16, 20, 24 and 32 point gaps.
- Cards: 18–24 point corner radius, restrained borders, very subtle elevation.
- Inputs and primary controls: minimum 48 point height; target 52–56 points for primary controls.
- Use a consistent type hierarchy: screen title, section title, body, supporting metadata.
- Avoid excessive shadows, gradients, glass effects, and competing accent colours.

## Screen patterns

### Home
- Balance is the strongest visual anchor and includes a hide/show control.
- Quick actions are limited to the most common tasks.
- Financial summaries must state their period and currency.
- Recent activity previews a small number of entries and links to the full activity screen.
- Summary values are calculated only from the transaction data currently loaded; do not imply a full-account statement unless the API guarantees it.

### Activity
- Provide clear all / incoming / outgoing filters.
- Search only fields actually available in the transaction model.
- Each row should distinguish direction, amount, description, and date.
- Transaction detail should show authoritative status and identifiers when the API exposes them.

### Money movement
- Review recipient and amount before submitting.
- Show fees explicitly; do not imply that a fee is zero unless confirmed by the backend.
- Preserve idempotency keys and server-side validation.
- Distinguish created, pending, succeeded, failed, reversed, and under-review states in any future provider-backed flow.

### Account and security
- Keep language, sessions, sign-out, and privacy controls easy to find.
- Confirm session revocation and sign-out-all actions.
- Never display secrets or authentication tokens.

## Accessibility

- Aim for WCAG 2.2 AA contrast: 4.5:1 for normal text and 3:1 for large text and meaningful UI graphics.
- Give every icon-only or glyph-only control an accessible label.
- Expose selected state for tabs and filters.
- Maintain large touch targets and visible selected/focus states.
- Do not communicate transaction direction or status by colour alone; pair it with text or a sign/icon.
- Respect system font scaling and test long Arabic and English labels on narrow devices.

## RTL and localisation

- Use logical layout direction and mirror row-based layouts where appropriate.
- Keep phone numbers, account identifiers, and numeric amounts legible and consistently formatted.
- Do not manually reverse text strings.
- Verify icons with directional meaning (back, forward, send) in both directions.
- Test mixed Arabic/Latin strings, currency placement, long translations, and keyboard navigation.

## Imagery and charts

- Use original, lightweight illustrations for brand moments such as onboarding; avoid generic stock photos on money-management screens.
- Illustrations must not resemble payment-card credentials or imply a real issued card.
- Charts should answer a real question, label the period, and be based on traceable data. Always provide a text equivalent for key figures.
- Do not use chart colours as the only means of distinguishing series.
- Avoid remote imagery on critical financial screens where network loading could leave blank or misleading content.

## Release checklist

- [ ] TypeScript typecheck passes.
- [ ] Expo Android export passes.
- [ ] API and Blnk integration CI remain green.
- [ ] Test Android and iOS device sizes, safe areas, keyboard, and scrolling.
- [ ] Test Arabic RTL and English LTR on all updated screens.
- [ ] Test screen reader labels and large text.
- [ ] Test empty, loading, error, offline, and long-list states.
- [ ] Verify every amount, status, and disclosure against backend semantics.
- [ ] Keep prototype and simulated-payment disclosures visible until live integrations are approved.

## Implemented interaction patterns

- Transaction rows are actionable and open a dedicated detail view.
- Transaction detail displays only fields provided by the API model: type, amount, timestamp, memo, and transaction identifier. It does not invent settlement status or provider references.
- Transaction details can be copied or shared using the native OS share sheet.
- Transfer confirmation receipts can be copied or shared; they show the recipient, amount, fee presentation, and local confirmation time available to the client.
- Account settings separate profile identity, language selection, and active-session security controls.
- The current session cannot be revoked from its own row; sign-out and sign-out-all remain explicit confirmation actions.
- Detail layouts adapt their reading alignment for Arabic RTL and English LTR.

## Manual mobile acceptance walkthrough

Run this checklist on a physical Android device and an iPhone/simulator using a non-production test environment.

### Sign-in
1. Launch with no stored session and verify the branded illustration, phone field and language switch.
2. Switch Arabic / English and confirm direction, alignment and labels update without restarting.
3. Request an OTP, enter an invalid code, then a valid development/test code. Verify clear error and loading feedback.
4. Background and reopen the app; confirm secure session restoration behaves correctly.

### Home and balance
1. Verify the balance is formatted in the correct currency and can be hidden.
2. Toggle balance visibility and navigate away/back; ensure it remains masked or visible as intended.
3. Check current-month totals against the transactions returned by the API.
4. Pull to refresh and test offline / server error handling.
5. Confirm prototype disclosures remain visible wherever simulated top-up is offered.

### Transfers and payment links
1. Try invalid phone and amount values; confirm no request is sent.
2. Enter a valid test recipient and amount; verify the confirmation includes the intended recipient and amount.
3. Cancel confirmation and verify no transfer was submitted.
4. Confirm a test transfer and verify the receipt values match the server response and local confirmation time.
5. Create a test payment link and verify copy/share actions. Confirm the UI still explains that public checkout is not live.

### Activity and transaction detail
1. Test all / incoming / outgoing filters.
2. Search by transaction kind and memo; clear the query and verify all results return.
3. Open a transaction and compare amount, type, timestamp, memo and ID with the API response.
4. Copy and share details; verify no token or private authentication data is included.

### Account and security
1. Change language and navigate between tabs; confirm preference persists after restart.
2. Confirm the current session is labelled and cannot be revoked from its own row.
3. Revoke a different test session and confirm the list refreshes.
4. Test sign-out and sign-out-all confirmation flows.

### Accessibility and device layout
1. Test VoiceOver / TalkBack on navigation, balance visibility, filters, row actions and modal controls.
2. Increase system text size and verify content remains readable and scrollable.
3. Test small and large screens, safe areas, keyboard open/close, and landscape if supported.
4. Verify Arabic RTL order and mixed Arabic / Latin / numeric strings.
5. Confirm touch targets are comfortably usable and that errors are not communicated by colour alone.
