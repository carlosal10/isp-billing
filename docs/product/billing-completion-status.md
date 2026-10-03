# Billing completion checkpoint

## Delivered

- Plan/customer references are reloaded under the tenant scope, including Mongoose ObjectIds and populated documents. Demo invoices use the real creation path without fixture repairs.
- Invoice input dates and amounts are validated. Payment allocations and credits stay within the invoice customer, tenant and currency. Automatic plan invoicing uses KES and rejects implicit currency conversion.
- Partial payments, overpayments, carried credit and full ledger refunds/reversals/chargebacks are exercised against a replica set. Reversal queries exclude prior reversal entries, preventing an overpayment refund from reinstating refunded cash.
- Settlement fingerprints include the linked invoice and are calculated after invoice selection. Unchanged replays do not repost the ledger. Reversed payments cannot transition to another reversal type; pending payments cannot be refunded.
- Fault tests cover allocation insertion, ledger insertion, payment save and outbox enqueue. Retry tests check both invoice balances and individual ledger account balances.
- Stripe signed raw-body callback tests, correlated M-Pesa STK fixtures, and C2B failure/replay fixtures exercise settlement. STK amount mismatches are quarantined; late failures cannot downgrade settled payments. Existing C2B receipts can recover a missing financial application.
- Both M-Pesa settings APIs now use encrypted PaymentConfig. Legacy settings are promoted on first read without overwriting an existing canonical record. Ambiguous shortcode ownership is rejected. Legacy records are retained for rollback.
- Owner/admin provider-statement imports compare gross receipts against recorded payment amounts by reference and currency. Reports identify duplicates, missing records and mismatches. Investigations are reasoned and audited; acknowledging a discrepancy does not alter money, erase the discrepancy, or claim its totals balance.
- `/payments` and `/payment-settings` no longer enter the public `/pay` route. Billing controls have visible labels, consistent sizing and keyboard-accessible scrolling. Refund/reversal prompts use a focus-trapped dialog with stable focus and explicit provider-action instructions.
- CI uses Node 22, runs database and browser checks with color contrast enabled, checks high-confidence credential patterns, and performs a real backup/restore drill. Separately hosted builds require an explicit public HTTPS API endpoint. Same-origin builds default to `/api`.

## Verification

Local evidence is produced by:

| Check | Command / evidence |
| --- | --- |
| Server contracts, roles and unit tests | `npm run ci:server` (175 unit tests) |
| Database billing and authorization | `npm run test:integration` (11 billing tests plus 7 readiness tests; authorization checks exercise 199 mounted operations) |
| Client tests and production build | `npm run ci:client` (4 tests) |
| Browser workflows | `npm run test:browser` (9 tests; 360, 768, 1024, 1440 and 1920px; invoice, finance and gateway tabs included) |
| Backup, restore and migration rollback snapshot | `npm run test:restore` (15 collections and indexes; restored KES debits/credits 5000/5000) |
| Clean dependency install | `npm ci` in a separate directory; 352 packages installed and zero audit findings at verification time |
| Credential patterns | `node scripts/check-secrets.js` |

Windows verification uses installed Edge via `PLAYWRIGHT_CHANNEL=msedge`. CI installs Chromium. Database tools are MongoDB Database Tools 100.19.0; the disposable replica set uses MongoDB 8.2.6. Windows artifacts and tool caches are stored under `D:\isp-billing-tests` to avoid exhausting C:. The browser screenshots live under the ignored `artifacts/ui` directory. These are automated accessibility checks and workflow coverage, not a certification of the entire site's WCAG conformance.

On October 3, the first Linux CI run passed the client build and browser checks and exposed a capitalization mismatch in the router model path used by the route audit. The policy now uses the exact Git-tracked filename, and all 32 policy paths were checked against Git. Moment was updated to 2.31.0 for [GHSA-4p3w-j4w9-5jqw](https://github.com/advisories/GHSA-4p3w-j4w9-5jqw); the updated dependency audit reports zero findings.

## Operating boundary

- Statement imports accept normalized gross successful receipts before fees, at most 2,000 rows and a maximum 93-day period. End timestamps are exclusive. Internal comparisons fail rather than silently truncate beyond 10,000 payments. List views retain the latest 50 imports; reports persist in MongoDB.
- For Stripe, use PaymentIntent IDs, which are the internal transaction references. For M-Pesa, use receipt IDs. For manually recorded PayPal receipts, use their recorded transaction reference. Do not import fees, net payouts or refund rows as gross successful receipts.
- No provider API is called by importing or acknowledging statements. Correct missing/mismatched records through the payment/event recovery workflow, then recompare; acknowledge only a investigated exception with an explanation.
- Refund actions record a **full financial reversal** of a settled payment. The operator must complete and verify any actual provider refund separately. Partial provider refunds and automated provider refund execution are not implemented.
- Active callback integrations are M-Pesa and Stripe. PayPal has legacy helper/configuration code but no connected checkout/capture/webhook journey; statement fixtures do not constitute PayPal checkout verification.
- No production database, payment-provider account or router was used in local tests. Network failure recovery tests use a substitute router operation; real RouterOS outcomes belong to the next batch.
- Acknowledging an exception is not settlement proof. A launch gate requires a reconciled period, reviewed exceptions and verified provider statements from the intended deployment.

## Next batch: network orchestration

1. Durable router operations with desired state, attempt history and verifiable outcome.
2. Bounded command execution, lease renewal/recovery, retry classification and dead-letter handling.
3. Desired-versus-observed PPPoE/hotspot/static-IP state and drift detection.
4. Permissioned bulk previews and auditable operator recovery.
5. RouterOS/TLS lab checks and tests for restart, duplicate work and partial failures.

Production launch remains gated by live provider acceptance, deployment restore testing, operator runbooks/ownership, remaining full-site UI coverage and a controlled ISP pilot.
