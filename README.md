# ISP Billing

Multi-tenant ISP billing and network operations platform for managing customers, plans, payments, MikroTik provisioning, reminders, and paylinks from a single codebase.

## Current Architecture

- Frontend: React 19 application under `src/`
- Backend: Express + Mongoose application under `server/`
- Network automation: MikroTik integration for PPPoE, hotspot, static IP, queues, and terminal access
- Commercial flows: M-Pesa, Stripe, PayPal, SMS reminders, paylinks, invoices, tenant administration

## Key Entry Points

- Frontend app shell: `src/App.js`
- Main dashboard: `src/pages/Dashboard.jsx`
- Backend server: `server/App.js`
- API contract snapshot: `docs/openapi.yaml`

## Development Notes

- `npm start` runs the React client
- `npm test -- --watch=false` runs the current frontend test suite
- `npm run test:server` runs the finance and backend unit tests
- `npm run build` creates a production client build
- `npm run start:server` starts the Express/Socket.IO API from `server/App.js`
- `npm run env:check` validates deployment-critical environment variables without printing secrets
- `npm run api:contract:audit` checks OpenAPI path coverage against Express route mounts
- `npm run security:routes:audit` checks route access classification and sensitive route-module guards
- `npm run privacy:policy:audit` checks privacy retention controls and sensitive-data policy bounds
- `npm run privacy:retention:plan` previews privacy retention cleanup; `npm run privacy:retention` executes it
- `npm run migrate:status` shows the database migration registry state
- `npm run db:indexes:audit` checks declared Mongoose indexes against MongoDB
- `npm run backup:mongo:plan` previews a MongoDB backup command
- `npm run backup:mongo` writes a MongoDB archive backup; see `docs/runbooks/backup-restore.md`
- API responses include `X-Request-ID` for support correlation and baseline security headers for browser hardening
- `/metrics` exposes guarded process-local HTTP metrics for production monitoring
- The API handles `SIGTERM`/`SIGINT` with graceful shutdown for HTTP, MongoDB, and MikroTik connection pools
- Deployment topology and release steps are documented in `docs/runbooks/deployment.md`
- Privacy redaction, masking, and retention policy controls are documented in `docs/runbooks/privacy-compliance.md`
- Customer privacy exports and anonymization plans are available to owner/admin users under `/api/customers/:id/privacy/*`

## Billing And Finance

- Payments now settle against invoices first, then customer credit balances
- The finance core persists invoice allocations, credit notes, and ledger entries for auditability
- Recurring billing and collections are scheduled through `server/jobs/recurringBilling.js` and `server/jobs/billingCollections.js`
- Finance reporting endpoints are mounted under `/api/finance`
- The Payments modal now includes invoice, finance, and reconciliation views for operators
- Existing tenants can be backfilled into the finance core with `npm run migrate:finance:dry` and `npm run migrate:finance`

## Jobs And Scheduler

- Scheduler registration is centralized in `server/jobs/register.js`
- Job state is persisted in MongoDB, including pause/resume state and manual run metadata
- The admin Jobs console lives in `src/pages/Jobs.jsx` and surfaces live definitions, recent runs, and scheduler action history
- Owners, admins, and platform admins can manually run, pause, and resume permitted jobs through the tenant API

### Scheduler Environment Controls

- `JOB_TIMEZONE` or `APP_TIMEZONE`: default scheduler timezone
- `LEGACY_ENFORCEMENT_JOBS=true`: restore the older `expireAccess`, `expireStatic`, and `enforceInactiveCustomers` registrations instead of the unified `enforceAllExpired` job
- `JOB_RUN_RETENTION_DAYS`: retention window for persisted job runs, default `90`
- `JOB_ACTION_RETENTION_DAYS`: retention window for scheduler action logs, default `180`
- `JOB_HISTORY_RETENTION_CRON`: cron expression for the history retention job, default `15 3 * * *`
- `PRIVACY_RETENTION_CRON`: cron expression for privacy data retention, default `45 3 * * *`

## Repository Status

This repository is in active hardening and modernization. Recent stabilization work has focused on:

- auth/session consistency
- tenant-safe schema behavior
- shared MikroTik terminal command policy
- test baseline repair
- production build cleanliness

## Near-Term Priorities

- consolidate duplicated backend auth and middleware paths
- split oversized route files into service-oriented modules
- strengthen payment correctness and reconciliation flows
- add broader automated coverage for billing, tenants, and router orchestration
- improve deployment, observability, and operational runbooks

## MikroTik Debugging

The backend includes a short-lived raw capture helper for diagnosing RouterOS parser issues such as `UNKNOWNREPLY` or unexpected `!empty` responses.

Enable it temporarily before starting the backend:

```powershell
$env:MBM_RAW_CAPTURE = '1'
node server/App.js
```

Use this only in controlled environments because it increases log noise and may expose sensitive operational context.
