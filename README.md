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
- `npm run build` creates a production client build
- Backend startup currently uses `server/App.js`

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
