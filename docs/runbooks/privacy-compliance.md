# Privacy And Compliance Runbook

This platform now has a shared privacy layer for redaction, masking, and retention-policy review. Treat it as the default place to add sensitive-data handling rules instead of duplicating ad hoc checks in route handlers or services.

## Release Gate

Run the privacy policy audit before shipping backend changes:

```powershell
npm run privacy:policy:audit
```

The audit validates that retention controls are positive integer day counts and stay inside operationally safe bounds. Missing values use defaults and are reported as warnings, not failures.

## Retention Controls

| Environment variable | Default | Minimum | Maximum | Purpose |
| --- | ---: | ---: | ---: | --- |
| `AUDIT_LOG_RETENTION_DAYS` | 365 | 30 | 2555 | Security investigations, support traceability, and regulated operational review |
| `MESSAGE_DELIVERY_RETENTION_DAYS` | 365 | 30 | 1095 | Customer notification proof, SMS troubleshooting, and campaign delivery analytics |
| `PAYMENT_GATEWAY_EVENT_RETENTION_DAYS` | 730 | 90 | 2555 | Payment disputes, reconciliation, chargeback review, and provider callback audits |
| `PLATFORM_GATEWAY_EVENT_ACTION_RETENTION_DAYS` | 730 | 90 | 2555 | Platform orphan-queue action history and operational accountability |
| `JOB_RUN_RETENTION_DAYS` | 90 | 7 | 365 | Failed-job troubleshooting and reliability analysis |
| `JOB_ACTION_RETENTION_DAYS` | 180 | 30 | 730 | Administrative scheduler-control auditability |

## Retention Execution

Preview eligible deletions before running cleanup:

```powershell
npm run privacy:retention:plan
```

Execute cleanup only after reviewing the dry-run:

```powershell
npm run privacy:retention
```

The scheduled `privacyDataRetention` job runs daily at `03:45` by default and can be moved with `PRIVACY_RETENTION_CRON`. Payment gateway cleanup only deletes final-status gateway events (`processed`, `unmatched`, `failed`, `rejected`) so active callback work is not removed mid-investigation.

## Redaction Rules

Use `server/services/privacyService.js` for new sensitive-data handling. It provides:

- `redactObject` for recursive payload redaction with depth and array limits.
- `maskPhone`, `maskEmail`, `maskAccountNumber`, and `maskTransactionId` for review-safe identifiers.
- A common sensitive-key pattern covering passwords, tokens, secrets, API keys, passkeys, PIN hashes, webhook secrets, and session credentials.

Audit-log serialization and message-delivery context redaction now both use the shared privacy service. Message delivery APIs can return masked phone numbers by passing `privacyMode=masked` or `mask=true`.

## Customer Data Lifecycle

Owner/admin users can manage customer privacy lifecycle records through tenant-scoped customer APIs:

```text
GET  /api/customers/:id/privacy/export
GET  /api/customers/:id/privacy/anonymization-plan
POST /api/customers/:id/privacy/anonymize
```

Exports default to `privacyMode=masked`; pass `privacyMode=full` only when preparing a verified customer data disclosure. Standard customer list, search, by-id, and by-account reads also support `privacyMode=masked` or `mask=true` for safer screenshots, reviews, and escalations.

Anonymization requires the confirmation phrase returned by the plan endpoint. The workflow disables portal access, clears direct customer identifiers, removes billing autopay tokens, pseudonymizes the account number, scrubs customer-linked SMS/support/work-order free text, and retains invoices, payments, allocations, ledger entries, and audit logs for commercial/legal reporting.

## Operating Guidance

Keep full values available only where operators genuinely need them to complete support work. Prefer masked outputs for exports, screenshots, escalations, and review queues. If a new module stores customer identifiers, provider callback payloads, credentials, or notification context, add tests that prove secrets are redacted and customer identifiers are masked in privacy-safe views.
