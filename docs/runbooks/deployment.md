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
npm run privacy:policy:audit
npm run test:server
CI=true npm test -- --watch=false
npm run build
```

For database-affecting releases, also run:

```powershell
npm run backup:mongo:plan -- --label pre-release
npm run privacy:retention:plan
npm run migrate:status
npm run db:indexes:audit
npm run secrets:encrypt:plan
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
- `DATA_ENCRYPTION_KEY`: a base64-encoded 32-byte AES key used to protect router, payment-provider, and SMS credentials at rest.
- `DATA_ENCRYPTION_ACTIVE_KEY_ID`: key identifier written into new ciphertext; defaults to `primary`.
- `JWT_ISSUER` if the default `swiftbridge-api` issuer is not suitable. Keep it stable across API instances.
- `PLATFORM_BOOTSTRAP_TOKEN` during first-time platform setup. Use at least 32 random characters and remove it after creating the first platform administrator.
- M-Pesa, Stripe, PayPal, and SMS provider secrets as needed
- `CLIENT_URL` and `CLIENT_ORIGINS`
- `REACT_APP_API_URL` for the static client build
- `METRICS_TOKEN` if external monitoring scrapes `/metrics`
- `SHUTDOWN_TIMEOUT_MS` to tune graceful drain timeout, default `10000`

Keep `SERVE_CLIENT=false` when the frontend is deployed as a separate static service.

Tenant, platform-admin, and customer-portal access tokens use distinct JWT audiences. Deploying the strict-realm release invalidates older access tokens that did not carry an audience and issuer; active staff can recover through refresh, while platform and portal users must sign in again.

Tenant refresh tokens are single-use. New tokens are stored as one-way SHA-256 digests, and each successful refresh atomically revokes the presented token before issuing its replacement. Clients must persist the rotated `refreshToken` returned by `/api/auth/refresh`. A replayed, expired, logged-out, or already rotated token receives `401 Invalid refresh`. Legacy plaintext refresh-token records remain readable only until their first rotation, logout, or expiry.

When a customer portal PIN exists, the PIN is mandatory. Email or phone matching remains available only for legacy portal profiles that do not yet have a PIN, allowing those customers to sign in and establish one without permitting contact details to bypass a configured PIN.

The first platform administrator can be created only while no platform administrator exists and must send `X-Platform-Bootstrap-Token` matching `PLATFORM_BOOTSTRAP_TOKEN`. The first account is always a super administrator. After bootstrap, only an authenticated super administrator can create another platform administrator.

For key rotation, set `DATA_ENCRYPTION_KEYS` to a JSON object that contains both the old and new base64 keys, set `DATA_ENCRYPTION_ACTIVE_KEY_ID` to the new key ID, deploy, and run the credential-encryption migration with `--rotate`. Keep the old key available until the migration and a full credential verification pass have completed.

After first configuring `DATA_ENCRYPTION_KEY`, run `npm run secrets:encrypt:plan`, create a database backup, and run `npm run secrets:encrypt`. The migration encrypts existing payment-provider, SMS-provider, and MikroTik passwords in place. It is idempotent: already encrypted values are skipped unless the rotation command is used.

## GitHub Actions

Platform administrator authorization now reads the current account on every request. Set `isActive: false` or `revokedAt` to disable access; increment `sessionVersion` to invalidate existing tokens while retaining the account. Newly issued tokens carry that version. Super-administrator demotion takes effect immediately.

Integration clients must send `x-api-key`; query-string API keys are no longer accepted. Paylink status polling must include the original valid paylink token along with `paymentId`. The bundled client does so automatically.

Uncorrelated M-Pesa STK callbacks remain unmatched until an operator resolves them within the correct tenant. C2B accounts must belong to the configured shortcode tenant. Verify existing shortcode mappings and STK correlation persistence in staging before deployment.

- `CI`: validates env, API, route-security, and privacy-policy contracts; syntax-checks operational scripts; runs backend tests; runs frontend tests; and builds the client.
- `CodeQL Advanced`: scans JavaScript and GitHub Actions.
- `Deploy Client To GitHub Pages`: publishes the built `build/` directory only.
- `Render Deploy Hook`: runs CI-equivalent checks and triggers Render only if `RENDER_DEPLOY_HOOK_URL` is configured.

## API Contract Gate

`npm run api:contract:audit` compares mounted Express API surfaces against `docs/openapi.yaml`. A route is release-safe only when it is documented or explicitly exempted with a reason in `server/services/apiContractService.js`. This keeps new routes from slipping into production without either customer-facing documentation or an intentional internal/legacy classification.

## Route Security Gate

`npm run security:routes:audit` classifies every literal Express mount in `server/App.js` as public, tenant-authenticated, user-authenticated, platform-admin, metrics-token, provider-callback, API-key, or route-managed auth. It also checks sensitive route modules for expected role/API-key/portal guard snippets. New public or route-managed surfaces should be added deliberately to `server/services/routeSecurityAuditService.js` with a reason.

## Privacy Policy Gate

`npm run privacy:policy:audit` validates retention controls for audit logs, message deliveries, gateway events, platform gateway-event actions, and scheduler history. Missing values use safe defaults and emit warnings; invalid or out-of-bounds values fail the release gate. `npm run privacy:retention:plan` previews cleanup eligibility before any write-mode retention run.

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
