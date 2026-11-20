# Reconciliation exception operations

The reconciliation exception queue is an operator workflow for reviewing rows created by settlement-batch imports. The current import path is explicitly test-only; this queue does not connect to a live PSP, change ledger balances, or authorize a payment, refund, or payout.

## Finance-admin API

All endpoints require an authenticated administrator with the `finance_admin` or `super_admin` role.

- `GET /admin/reconciliation/exceptions` — list the latest 200 exceptions, with open items first.
- `GET /admin/reconciliation/exceptions?status=open` — filter by `open`, `resolved`, or `ignored`.
- `POST /admin/reconciliation/exceptions/:id/decision` — record a decision. Body: `{ "status": "resolved" | "ignored", "note": "..." }`.

A decision requires a 3–1000 character note. The API locks the exception row, accepts decisions only while the exception is open, and commits the status change and append-only admin audit event in one database transaction. Concurrent or repeated decisions fail with a conflict rather than overwriting the first decision. The decision note and actor/time metadata are retained in the exception details JSON.

## Operator guidance

- Resolve only after matching the provider statement to the corresponding internal payment/refund/payout record and checking amount, currency, and reference.
- Use ignored only for a documented non-actionable line; include the reason.
- Do not treat resolving an exception as a ledger adjustment. Corrections require a separately authorized, idempotent financial operation and its own audit trail.
- Escalate unknown provider references, amount/currency mismatches, duplicates, and any suspected missing/duplicate movement to Finance and Compliance.
- This queue is not yet a production PSP reconciliation system. Live provider ingestion, signed settlement files, automated completeness checks, alerts, maker-checker controls for financial adjustments, and production runbooks remain release blockers.
