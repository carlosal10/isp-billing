# Network lifecycle readiness

## Implemented scope

Customers, PPPoE and Subscribers now share one assignment workflow. See
[customer and network workflow](customer-network-workflow.md) for onboarding,
existing PPPoE account linking, billing/manual access precedence and archival.

The Network > Subscribers screen supports local PPPoE and hotspot accounts and
managed static IPv4 queues. Owners and admins can provision, suspend, resume and
release these assignments. Existing PPP/hotspot profiles, address delivery and
subscriber routing must already be configured on the router. Static queue creation
does not select a plan speed; configure the base queue rate separately.

Assignment changes and their durable operations commit together in a MongoDB
transaction (replica set required). Requested state is separate from confirmed
router state. Failed requests retain the username/IP reservation until verified
release. Workers share assignment leases with FUP enforcement and check for state
changes before subsequent commands. Router deletion is prevented while assignments
remain unreleased, including concurrent creation.

Local passwords are encrypted and excluded from API responses. Profile and account
ownership checks prevent takeover of unrelated accounts. Static billing suspension
uses dedicated firewall rules and clears matching tracked connections. Resume leaves
FUP restrictions intact. Release removes only assignment-owned resources; it does not
delete the customer or change subscriber address delivery.

The screen provides named customers and routers, loaded-list search, pagination,
confirmation dialogs and separate requested/confirmed FUP status. Session totals
describe the loaded accounting records, not a complete billing-period usage total.
Stopped sessions remain stopped even when their last update is old.

## Deployment requirements and limits

- Deploy matching frontend and server versions; preserve the field encryption key.
- Run the existing background operation and FUP workers with a replica-set database.
- Give the backend a verified route to the router API. A PC joining the router LAN
  does not provide this route to the hosted Render backend. Cloud-to-LAN routing
  still requires a configured VPN gateway or another supported reachable endpoint.
- RADIUS accounting ingestion is separate from RADIUS subscriber authorization.
  Automatic creation/suspension/release through an external RADIUS authorization
  backend is not implemented. New lifecycle requests accept local authentication;
  existing RADIUS assignments return an explicit unsupported-adapter error for
  lifecycle mutations rather than reporting false success.
- Static queue/FUP behavior depends on router forwarding, FastTrack and hardware
  offload configuration. Test actual subscriber traffic before production rollout.

## Acceptance evidence and remaining live checks

Run `npm run verify:deployment` after Render finishes deploying. It compares the
public frontend asset bytes with the local production build, checks `/health` and
`/ready` against the current Git commit, and verifies that the API permits the
frontend origin. Render supplies `RENDER_GIT_COMMIT`; other hosts can set
`DEPLOYMENT_REVISION` to the full deployed commit. Unknown revisions fail this
verification rather than being treated as a version match. Reports are saved to
`artifacts/deployment-verification.json` without credentials. Optional overrides:
`DEPLOY_CLIENT_URL`, `DEPLOY_API_URL`, and `EXPECTED_DEPLOYMENT_REVISION`.
This verifies deployment consistency, not router reachability or subscriber traffic.

Automated checks cover local account/queue lifecycle, ownership, encrypted credential
handling, transaction rollback, tenant isolation, duplicate requests, worker fencing
and router deletion races. Browser checks exercise subscriber controls on mobile
and desktop with simulated router/API records; they do not prove live connectivity.

On 10 October 2026, LAN read-only authentication/reconnection and an isolated local
PPPoE profile/account lifecycle passed on an RB951Ui-2HnD running RouterOS 7.24.1.
The test verified disabled creation, duplicate retry, enable/suspend, repeated
release and cleanup. It exposed and verified a fix for premature channel closure
on RouterOS `!empty` replies. This was a direct service-level test from the PC;
it did not exercise the deployed API/outbox, subscriber authentication or traffic.
Cloud routing and end-to-end subscriber validation remain outstanding. Before
claiming production acceptance:

1. Verify the router from the deployed backend and confirm reconnect after interruption.
2. Provision isolated PPPoE, hotspot and static test subscribers; authenticate/send traffic.
3. Confirm accounting start/interim/stop and byte totals against actual router counters.
4. Cross the FUP threshold and verify measured speed/blocking; verify billing suspension
   and FUP do not undo one another, then test the policy reset.
5. Suspend, resume and release the isolated subscribers; verify router state and cleanup.
6. Exercise a temporary API outage and confirm retry without duplicate resources.

Use test subscribers and record results without passwords or shared secrets. Do not
mark these live steps complete based on mocked tests or a queued operation alone.
