# SwiftBridge Market-Readiness Roadmap

## Current implementation checkpoint

The billing completion batch fixes invoice pricing, overpayment reversal accounting, tenant/currency validation, and the staff billing route. It adds provider receipt comparison, canonical M-Pesa configuration, fault-injection coverage, and enforced browser/restore checks. Evidence and the exact billing support boundary are recorded in `docs/product/billing-completion-status.md`.

Phase 3 now includes durable local PPPoE/hotspot/static service operations, billing
and manual suspension coordination, FUP worker fencing, and one shared Customers /
PPPoE service workflow. These are implemented engineering changes; live network
acceptance is still pending. See `docs/runbooks/network-readiness.md` for support
limits and `docs/product/network-acceptance-status.md` for the latest deployment
and router evidence. External RADIUS subscriber authorization and cloud-to-LAN
routing are not complete.

This is a local engineering checkpoint, not production launch approval. Live provider acceptance, a deployment-specific restore rehearsal, MikroTik lab validation, operational ownership, the remaining site-wide UI workflows, and the controlled pilot remain release gates. PayPal currently supports manually recorded receipts and statement comparison; its unused checkout helpers are not a verified online payment integration.

## Product goal

Ship SwiftBridge as a dependable multi-tenant ISP operations platform that an ISP can trust with customer identity, billing, collections, network access, and daily support work.

“Market ready” means more than a successful build. A release qualifies only when tenant isolation is proven, money movements are recoverable and auditable, network operations fail safely, the core workflows are understandable without training, and the team can deploy, observe, and roll back the product predictably.

## Product principles

1. Protect tenant boundaries before adding breadth.
2. Treat payments and entitlements as one auditable state machine.
3. Make network changes observable, reversible, and idempotent.
4. Design around operator decisions rather than database entities.
5. Release in thin vertical slices with explicit evidence at every gate.
6. Prefer one clear implementation over parallel legacy and replacement paths.

## Priority definitions

- **P0 — release blocker:** tenant escape, credential exposure, lost or duplicated money, destructive router behavior, unrecoverable deployment, or unavailable critical flow.
- **P1 — market blocker:** broken primary workflow, missing audit trail, inaccessible core screen, poor recovery behavior, or a support burden that prevents a controlled pilot.
- **P2 — adoption:** workflow speed, usability, reporting depth, integration breadth, and product polish.
- **P3 — expansion:** differentiators that are valuable after the core service is dependable.

## Phase 0 — Baseline and product contract

**Target:** one week.

Create a shared baseline before changing behavior:

- Freeze the public API surface and record known legacy exemptions.
- Define supported payment providers, router versions, browsers, currencies, time zones, and deployment topology.
- Create a sanitized staging tenant with representative PPPoE, hotspot, static-IP, invoice, payment, and support data.
- Record the five critical user journeys as executable acceptance scenarios.
- Add architecture decision records for tenant identity, payment settlement, secrets, and router-command orchestration.
- Establish service-level indicators for API availability, payment callback latency, job success, router command success, and notification delivery.

**Exit gate:** staging exists, critical journeys are documented, and every known P0/P1 item has an owner and acceptance criteria.

## Phase 1 — Security and tenant isolation

**Target:** two weeks. This phase blocks all market deployment.

- Give staff, platform-admin, customer-portal, API-key, and paylink tokens distinct audiences and middleware.
- Derive the tenant from trusted claims. If `x-isp-id` is retained for tenant switching, require an exact claim/membership match.
- Require tenant membership on every staff route; add an explicit permission matrix for owner, admin, operator, support, and read-only roles.
- Apply the same tenant and audience rules to Socket.IO.
- Encrypt router and provider credentials at rest with key rotation support.
- Never return stored secrets. Return redacted configuration status such as `configured`, `lastRotatedAt`, and `lastVerifiedAt`.
- Rate-limit authentication, paylink, portal login, payment initiation, callback retry, terminal, and integration endpoints according to risk.
- Add CSRF protection if cookies remain an authentication transport.
- Remove sensitive callback bodies, phone numbers, tokens, and transaction identifiers from ordinary logs.
- Add dependency, secret, static-analysis, and authorization tests to the required CI checks.

**Exit gate:** automated tests prove that every token realm is rejected outside its intended API and that a user cannot read or mutate another tenant by changing headers, parameters, or websocket metadata.

## Phase 2 — Financial correctness and payment recovery

**Target:** three weeks.

- Define canonical payment and invoice state machines, including allowed transitions and terminal states.
- Put payment settlement, invoice allocation, credits, ledger entries, and payment state changes in MongoDB transactions.
- Add unique idempotency constraints for gateway events, ledger batches, allocations, refunds, reversals, and chargebacks.
- Mount the Stripe raw-body webhook before JSON parsing and add signed webhook fixtures.
- Validate M-Pesa callbacks against stored STK/C2B correlations and explicitly quarantine unmatched events.
- Consolidate `PaymentConfig` and `MpesaSettings` into one encrypted provider configuration model.
- Implement reconciliation reports: provider total, internal total, unmatched events, unapplied credit, and ledger imbalance.
- Make entitlement changes consume settled financial events through an outbox/worker so router failures cannot roll back money and payment retries cannot duplicate access.
- Exercise backup and restore against staging data, including migration rollback procedures.

**Exit gate:** replaying any gateway event is harmless; forced failures at every settlement step leave a recoverable state; provider-to-ledger reconciliation balances for the test period.

## Phase 3 — Network orchestration reliability

**Target:** two to three weeks.

- Model router commands as durable operations with idempotency keys, desired state, attempt history, and final outcome.
- Separate desired subscriber state in MongoDB from observed router state.
- Add retry classes, circuit breakers, bounded concurrency, and dead-letter review for router operations.
- Implement safe dry-run previews for bulk enforcement and static-IP changes.
- Validate supported RouterOS versions and TLS behavior on a test router or containerized lab.
- Add drift detection between customers, IP assignments, queues, PPPoE secrets, hotspot users, and router state.
- Require elevated permissions and a reason for terminal and bulk enforcement actions.
- Provide an operator-visible recovery action instead of silently swallowing router errors.

**Exit gate:** network loss, duplicate jobs, API restarts, and partial router failures converge toward the correct desired state without duplicating or deleting unrelated configuration.

## Phase 4 — Core workflow and UI completion

**Target:** three weeks, overlapping with Phases 2 and 3 after their contracts stabilize.

Migrate screens in this order:

1. Application shell, navigation, design tokens, alerts, tables, empty states, and form controls.
2. Authentication, onboarding, tenant setup, and router connection.
3. Dashboard and customer search.
4. Customer creation, plan assignment, and service provisioning.
5. Invoices, payments, reconciliation, refunds, and credits.
6. Communications, jobs, support, NOC, and service operations.
7. Customer portal and public paylink.
8. Platform administration.

For each workflow:

- Define the primary decision, essential information, loading state, empty state, validation state, error recovery, success confirmation, and audit link.
- Replace large modal-based tools with routed workspaces or focused drawers where context must remain visible.
- Use consistent page headers, action hierarchy, filters, saved views, pagination, status chips, and destructive-action confirmations.
- Meet WCAG 2.2 AA for keyboard access, focus order, contrast, form labels, reduced motion, and screen-reader semantics.
- Validate layouts at 360, 768, 1024, 1440, and 1920 pixels.

**Exit gate:** the five critical journeys pass moderated usability tests without facilitator rescue, and there are no critical accessibility violations.

## Phase 5 — Observability, performance, and support readiness

**Target:** two weeks.

- Add structured logs with request, tenant, job-run, gateway-event, and router-operation correlation IDs.
- Export metrics to a durable monitoring system and create alerts for error rate, latency, callback backlog, failed jobs, router-command failures, and database saturation.
- Add distributed tracing around payment, SMS, scheduler, and router boundaries.
- Establish performance budgets for initial client load, dashboard API fan-out, list queries, and background jobs.
- Add cursor pagination and database indexes for all unbounded operational lists.
- Write operator runbooks for payment backlog, failed entitlement, router outage, callback outage, database degradation, credential rotation, tenant export, and restore.
- Add an in-product support diagnostics bundle that redacts secrets and PII.

**Exit gate:** an on-call operator can detect, diagnose, mitigate, and communicate each rehearsed failure using documented tools.

## Phase 6 — Controlled market launch

**Target:** two to four weeks.

- Run an internal dogfood tenant, then a design-partner pilot with one small ISP.
- Import a copy of pilot data into staging and rehearse migration, reconciliation, and rollback.
- Launch with feature flags and tenant allowlists for payments, automated enforcement, and bulk messaging.
- Use canary API deployment followed by client deployment; monitor one complete billing and collections cycle.
- Hold twice-weekly pilot reviews using support volume, failed operations, task completion, and reconciliation metrics.
- Freeze new features during pilot stabilization.
- Expand from one ISP to three only after two consecutive clean reconciliation periods and no unresolved P0/P1 issues.

**General-availability gate:** signed security review, restore drill, balanced finance report, successful router-failure drill, accessibility review, support readiness, privacy/legal review, and an approved rollback plan.

## Critical user journeys

1. Create an ISP workspace, invite staff, configure secure payment and SMS integrations, and connect a router.
2. Create a customer, select a plan, allocate network resources, and verify service activation.
3. Collect a payment, allocate it to an invoice, issue a receipt, and extend access exactly once.
4. Detect an overdue account, notify the customer, apply grace rules, suspend service, receive payment, and restore service.
5. Receive a support request, inspect customer/network/payment context, create work, resolve it, and retain an audit trail.

## Market-readiness scorecard

The release candidate must meet all of these conditions:

- Zero known P0 issues and zero unaccepted P1 issues.
- 100% authorization coverage for mounted routes and websocket events.
- 100% payment-event idempotency tests passing.
- Finance reconciliation difference of zero for the release test window.
- Successful backup/restore and migration rehearsal on production-sized staging data.
- At least 99.9% successful completion in fault-injected critical-journey tests, excluding deliberate provider rejection.
- No critical or serious WCAG violations in core journeys.
- P95 API latency and client performance budgets agreed and met on representative data.
- Rollback practiced and completed within the recovery-time objective.
- Every alert has an owner and linked runbook.

## Items intentionally deferred until after general availability

- Native mobile applications.
- Broad accounting-suite integrations beyond stable export/API contracts.
- AI-generated support responses or autonomous network actions.
- Multi-region active-active deployment.
- Custom workflow builders.

These can differentiate the product later, but none should delay correctness, operability, or a focused first market release.
