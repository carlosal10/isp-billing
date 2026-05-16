# Deployment Runbook

This repository is now structured for a two-service production topology:

- `isp-billing-api`: Node/Express API, Socket.IO terminal namespace, schedulers, jobs, payment callbacks, and MongoDB access.
- `isp-billing-client`: static React client built from `src/` and served from `build/`.

## Required Checks Before Deploy

Run these locally or in CI before promoting a build:

```powershell
npm ci
npm run env:check
npm run api:contract:audit
npm run security:routes:audit
npm run test:server
CI=true npm test -- --watch=false
npm run build
```

For database-affecting releases, also run:

```powershell
npm run backup:mongo:plan -- --label pre-release
npm run migrate:status
npm run db:indexes:audit
```

## Health Endpoints

- `/health`: liveness check. Use this for basic platform health checks.
- `/ready`: readiness check. This returns `503` until MongoDB is connected and while the process is draining after `SIGTERM`.
- `/api/health`: public API liveness alias.
- `/metrics`: Prometheus-style process-local HTTP metrics. In production, set `METRICS_TOKEN` and scrape with `Authorization: Bearer <token>` or `X-Metrics-Token`.

## Render Blueprint

The root `render.yaml` defines both the API and static client. Configure secrets in Render rather than committing them:

- `MONGO_URI`
- `JWT_SECRET`
- M-Pesa, Stripe, PayPal, and SMS provider secrets as needed
- `CLIENT_URL` and `CLIENT_ORIGINS`
- `REACT_APP_API_URL` for the static client build
- `METRICS_TOKEN` if external monitoring scrapes `/metrics`
- `SHUTDOWN_TIMEOUT_MS` to tune graceful drain timeout, default `10000`

Keep `SERVE_CLIENT=false` when the frontend is deployed as a separate static service.

## GitHub Actions

- `CI`: validates env contract, syntax-checks operational scripts, runs backend tests, runs frontend tests, and builds the client.
- `CodeQL Advanced`: scans JavaScript and GitHub Actions.
- `Deploy Client To GitHub Pages`: publishes the built `build/` directory only.
- `Render Deploy Hook`: runs CI-equivalent checks and triggers Render only if `RENDER_DEPLOY_HOOK_URL` is configured.

## API Contract Gate

`npm run api:contract:audit` compares mounted Express API surfaces against `docs/openapi.yaml`. A route is release-safe only when it is documented or explicitly exempted with a reason in `server/services/apiContractService.js`. This keeps new routes from slipping into production without either customer-facing documentation or an intentional internal/legacy classification.

## Route Security Gate

`npm run security:routes:audit` classifies every literal Express mount in `server/App.js` as public, tenant-authenticated, user-authenticated, platform-admin, metrics-token, provider-callback, API-key, or route-managed auth. It also checks sensitive route modules for expected role/API-key/portal guard snippets. New public or route-managed surfaces should be added deliberately to `server/services/routeSecurityAuditService.js` with a reason.

## Release Sequence

1. Run CI and confirm all checks pass.
2. Create a fresh MongoDB backup.
3. Deploy the API.
4. Confirm `/health` and `/ready`.
5. Run `npm run migrate:status` and any required migration with explicit `--write`.
6. Deploy the client.
7. Smoke-test login, tenant selection, invoices, payments, jobs, and customer portal pay flow.

## Runtime Shutdown

The API installs `SIGTERM` and `SIGINT` handlers. On shutdown it stops accepting HTTP/WebSocket traffic, closes the MikroTik connection pool, disconnects MongoDB, and then exits. This gives deployment platforms time to drain traffic cleanly instead of terminating the process mid-request.
