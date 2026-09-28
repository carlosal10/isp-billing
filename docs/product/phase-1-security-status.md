# Phase 1 Security Implementation Status

## Current slice

This slice establishes the security primitives required before financial and router-orchestration work can be treated as market-ready.

Implemented:

- Tenant-staff, platform-admin, and customer-portal access tokens have distinct audiences, a fixed issuer, an explicit access-token use, and HS256 verification.
- Tenant API middleware accepts tenant-staff tokens only.
- Tenant context comes from the signed claim. An optional `x-isp-id` header must match the claim exactly.
- Every tenant request verifies current membership and exposes the membership role to downstream guards.
- Terminal Socket.IO sessions use the same token realm, tenant binding, and membership checks, including a fresh membership check before each command.
- Platform registration requires a bootstrap token for the first administrator and a current super administrator afterward.
- Authentication, registration, refresh, and payment-start endpoints have risk-based rate limits.
- Tenant refresh tokens are stored as SHA-256 digests, consumed atomically, rotated once, and revoked on logout. Pre-digest tokens remain compatible until rotation or expiry.
- A configured customer-portal PIN cannot fall back to email or phone authentication.
- Payment-provider, SMS-provider, and MikroTik credentials use authenticated AES-256-GCM encryption at rest with a keyring and rotation path.
- Configuration APIs accept allowlisted fields, preserve credentials on blank replacement input, and return configuration status instead of secret values.
- Payment, SMS, router-connect, and router-inventory credential mutations require owner or admin membership.
- Stripe webhook parsing occurs before the global JSON parser so signature verification receives the original bytes.
- M-Pesa C2B validation and confirmation match accounts only within the shortcode's tenant. Uncorrelated public STK callbacks remain unmatched instead of searching globally by phone and amount.
- Terminal access requires owner/admin membership, uses exact command matching, blocks PPP secret printing, and redacts returned credentials for HTTP and Socket.IO.
- Platform sessions check the current administrator record, active/revoked state, session version, and super-administrator flag on every request.
- Integration API keys are accepted only in headers. Public payment-status polling requires a valid paylink token and scopes the lookup to its tenant and customer.
- Router selection is stored per tenant; stale requests from another tenant are ignored.
- Request logs no longer include tenant identifiers, cookie state, callback identifiers, or provider response bodies from the changed paths.

## Evidence

- `npm run ci:server` passes environment, API-contract, route-security, privacy-policy, and backend test gates.
- The backend suite contains 171 passing tests; the client suite contains four passing tests across two suites.
- Focused regressions cover cross-tenant callback lookup, platform session revocation, header-only API keys, paylink status authorization, and terminal restrictions.
- `npm run ci:client` passes the client tests and optimized production build.
- Route-security policy checks cover strict token realms, tenant binding, websocket authorization, refresh rotation, portal PIN precedence, credential redaction, and owner/admin credential mutations.

## Required deployment sequence

1. Generate a random 32-byte base64 data-encryption key and store it in the deployment secret manager as `DATA_ENCRYPTION_KEY`.
2. Set a stable `JWT_ISSUER` when the default `swiftbridge-api` value is not appropriate.
3. Create a database backup.
4. Run `npm run secrets:encrypt:plan` and review collection counts.
5. Deploy the application with the encryption key present.
6. Run `npm run secrets:encrypt` once against the target database.
7. Verify one MikroTik connection, one M-Pesa initiation, and one SMS through each configured provider.
8. Remove `PLATFORM_BOOTSTRAP_TOKEN` after the first platform super administrator exists.
9. Require platform and portal users to sign in again; tenant users with valid refresh sessions will receive strict-realm access tokens at their next refresh.

## Remaining Phase 1 exit work

- Exercise every mounted route and websocket event through a database-backed authorization matrix for all supported roles and token realms.
- Decide whether browser authentication will remain bearer-only. If cookies are retained as an authentication transport, add CSRF tokens and strict cookie attributes before enabling that transport.
- Replace legacy contact-value portal bootstrap with a one-time verification challenge and require every customer to establish a PIN.
- Add support and read-only membership roles only after their route-level permission matrix is complete.
- Use a shared rate-limit store before horizontally scaling the API; the current in-memory counters are per process.
- Add dependency, secret-scanning, and static-analysis gates to required CI checks.
- Rehearse encryption-key rotation in staging while both old and new keys are present, then verify that the old key can be removed.
- Add customer-portal session revocation if its access-token lifetime is lengthened or refresh sessions are introduced.

These checks use unit tests and mocked database boundaries. Live provider callbacks, real MongoDB authorization matrices, browser visual/accessibility review, and production deployment verification remain required before launch.

## Verification completed in the market-readiness batch

- A disposable MongoDB replica-set harness seeds two tenants, three staff roles, plans, customers, invoices, and payments for repeatable integration checks.
- The mounted tenant API surface is exercised across 195 operations. Missing tokens, platform/portal tokens, wrong-tenant headers, and cross-tenant object IDs are rejected.
- Portal login now requires a PIN. A one-time, five-attempt, ten-minute SMS verification challenge establishes or resets a PIN. Portal session versions revoke existing sessions when a PIN or access state changes, and logout revokes the session.
- Finance settlement runs in MongoDB transactions with deterministic fingerprints, unique allocation/ledger safeguards, and replay-safe gateway processing. Stripe callbacks retain raw signature bytes and reject amount, currency, method, or reference mismatches.
- Router/customer access changes are recorded in a durable, leased outbox with retry backoff and an owner/admin recovery endpoint. Payment settlement remains complete when router work is unavailable.
- Encryption rotation is exercised with old and new key material present, then the old key is removed and the rotated secret is decrypted successfully.
- Browser checks cover portal enrollment, customer/plans/payments/reconciliation/settings at 360, 768, 1024, 1440, and 1920 pixels. They include WCAG automated checks, overflow checks, screenshots, and a real plan-creation flow.
- Client CI uses Vite and Vitest. Dependency scanning reports zero high or critical vulnerabilities; four moderate advisories remain in the selected React Router/Vitest major versions and require a later compatibility upgrade.

Phase 1 local exit verification is complete. Live provider credentials, production-like backup/restore rehearsal, MikroTik lab validation, and deployment-environment verification remain required before launch.
