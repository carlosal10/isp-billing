# SwiftBridge Delivery Workflow

## Work intake

Every change starts as one issue with:

- A concrete user or operational problem.
- The affected tenant, role, workflow, and data classification.
- Acceptance criteria written as observable behavior.
- Risk level: low, standard, high, or release-blocking.
- Rollout and rollback notes.
- Required product, design, security, finance, or network review.

Large initiatives are split into vertical slices that can be enabled independently. A slice should include the API contract, persistence, authorization, audit behavior, interface, telemetry, tests, and recovery path needed to deliver one usable outcome.

## Definition of ready

Work may enter implementation when:

- The intended behavior and out-of-scope behavior are explicit.
- UX states and API changes are reviewed.
- Tenant and role rules are written down.
- Data migration and backward compatibility are understood.
- External-provider assumptions have fixtures or a test environment.
- The work can be demonstrated and rolled back independently.

## Branch and review model

- Protect `main`; require pull requests and passing checks.
- Use short-lived branches prefixed with `codex/`, `feature/`, `fix/`, or `security/`.
- Rebase or merge `main` daily for work lasting more than one day.
- Keep commits small enough to explain and revert.
- Require two reviewers for authentication, tenant isolation, payments, ledger, migrations, secrets, router writes, and deployment changes. One reviewer must own the affected domain.
- Require one reviewer for standard product work.
- Prohibit direct production changes that are not represented in source, configuration, or a documented emergency procedure.

## Implementation loop

1. **Contract:** update the acceptance scenario, API schema, permission rule, and telemetry expectation.
2. **Test:** add the smallest meaningful test that proves the intended behavior or regression.
3. **Implement:** change the narrowest responsible service; keep route and component layers thin.
4. **Observe:** add structured events, metrics, and audit entries at business boundaries.
5. **Verify:** run targeted tests, then the required repository gates.
6. **Review:** assess correctness, tenant isolation, recovery, usability, accessibility, and operational impact.
7. **Stage:** deploy behind a flag where risk warrants it and run the critical journey.
8. **Release:** canary, observe, expand, and record the result.

## Required pull-request evidence

Every pull request states:

- The problem and resulting behavior.
- The tenant/role authorization decision.
- Screenshots or a recording for visible UI changes at desktop and mobile widths.
- API or event examples for contract changes.
- Tests run and their results.
- Migration, observability, rollout, and rollback impact.
- Known limitations accepted for this release.

## Test strategy

### Unit tests

Use for deterministic policy and calculations: billing math, permission decisions, normalization, expiry rules, IP allocation, dunning, and redaction.

### Service tests

Use a real ephemeral MongoDB replica set for transactional finance, tenant-scoped queries, uniqueness, migration, and retry behavior.

### API contract tests

Exercise the mounted Express application with each token realm. Generate a matrix that proves allowed and denied combinations for route, method, role, tenant, and audience.

### Provider contract tests

Keep signed fixtures for Stripe and representative M-Pesa, PayPal, and SMS responses. Test duplicates, delays, reordering, malformed payloads, rejection, and retry.

### Router integration tests

Run approved RouterOS versions in a lab. Verify desired-state convergence, command redaction, timeouts, reconnects, duplicate operations, and rollback behavior.

### End-to-end tests

Automate the five critical user journeys in a production-like staging deployment. The tests must assert both visible behavior and final database/router state.

### Non-functional tests

Run accessibility, dependency, secret, static security, load, backup/restore, migration, and failure-injection checks before a release candidate is approved.

## CI pipeline

Pull requests run:

1. Formatting and lint checks.
2. Unit and service tests.
3. API/OpenAPI and route-authorization audits.
4. Client tests and production build.
5. Dependency, secret, and CodeQL scanning.
6. Accessibility smoke tests on core pages.
7. Preview deployment with seeded sanitized data.

Merges to `main` additionally run integration, provider-contract, migration dry-run, and end-to-end suites. Release candidates run performance, restore, fault-injection, and reconciliation checks.

## Environments

- **Local:** disposable database and simulated providers; never production credentials.
- **Preview:** one per pull request with seeded sanitized data.
- **Staging:** production-like topology, encrypted staging credentials, router lab, and representative data volume.
- **Production:** protected secrets, audited access, controlled migrations, canary rollout, and monitored rollback.

Configuration is validated at startup. Each environment has a documented owner, data policy, provider mode, allowed origins, callback URLs, and rotation schedule.

## Database-change workflow

1. Add backward-compatible schema support.
2. Deploy code that can read old and new data.
3. Back up and verify the backup.
4. Run the migration in dry-run mode and review counts.
5. Execute in bounded batches with resumable checkpoints.
6. Verify indexes and business invariants.
7. Switch reads/writes to the new form.
8. Remove compatibility only after the rollback window.

Never combine an irreversible migration with an unrelated feature release.

## UI delivery workflow

1. Start with the operator decision and information hierarchy.
2. Draw the happy path plus loading, empty, partial, error, forbidden, and success states.
3. Reuse design tokens and shared components before introducing page-specific CSS.
4. Review keyboard order, labels, contrast, reduced motion, truncation, and responsive behavior.
5. Validate with realistic long names, large values, offline routers, failed providers, and empty tenants.
6. Capture desktop and mobile evidence in the pull request.
7. Test the complete user journey in preview rather than approving isolated screenshots.

## Release workflow

1. Cut a release candidate from a green `main` commit.
2. Freeze schema and feature scope.
3. Produce a backup and restore it in an isolated environment.
4. Run migrations in dry-run mode and reconcile counts.
5. Run critical journeys, accessibility, performance, and failure drills.
6. Deploy the API canary and watch error, latency, job, callback, and router metrics.
7. Expand the API, then deploy the client.
8. Run production smoke tests with a dedicated test tenant.
9. Observe through the defined soak period.
10. Record the release outcome, incidents, and follow-up work.

## Incident and emergency-change workflow

- Declare severity and incident commander.
- Stabilize service with flags, queue pauses, provider failover, or rollback.
- Preserve gateway events, audit evidence, and relevant logs.
- Communicate impact and next update time.
- Apply the smallest reviewable fix with an explicit rollback.
- Reconcile money, entitlement, and router state before closing.
- Complete a blameless review with corrective actions and owners.

Emergency changes return through the normal pull-request and test path immediately after stabilization.

## Definition of done

A change is done when:

- Acceptance criteria pass in a production-like environment.
- Authorization and tenant isolation are tested.
- API documentation and design states are current.
- Audit events and operational metrics exist where needed.
- Migrations are resumable and verified.
- Accessibility and responsive checks pass for UI changes.
- Rollout and rollback are executable.
- Support and runbook impact is documented.
- No temporary flags, debugging logs, test secrets, or generated artifacts are accidentally committed.
## Local release-candidate checks

- `npm run ci:server` — environment, API contract, route security, privacy, and 171 server tests.
- `npm run test:integration` — disposable MongoDB replica-set authorization, payment, portal, encryption, and WebSocket checks.
- `npm run ci:client` — Vitest client tests and Vite production build.
- `npm run test:browser` — Playwright workflow, screenshot, viewport, and accessibility checks using local staging.
- `npm run security:dependencies` — dependency audit with high and critical severity as the blocking threshold.
