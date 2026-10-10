# Network acceptance checkpoint

Checked 10 October 2026, Africa/Nairobi. Deployed RouterOS fix verified at
`f97fd963813343a0029098a5c022d45efade3dab`. Dedicated lab tooling was subsequently
pushed as `4c08cf1705ac0658fca34f4f3fdd17a726bc9360` on `main`.

## Verified

- Public frontend JavaScript and CSS match the local committed production build
  byte for byte, including the shared Customers / PPPoE workflow.
- Public API `/health` responds successfully.
- Public API `/ready` reports database connected, lifecycle ready, and jobs enabled.
  Jobs enabled is a configuration indicator, not proof of worker progress.
- Both API responses allow the production frontend origin.
- After redeployment, `/health` and `/ready` both identified the expected commit
  `f97fd963813343a0029098a5c022d45efade3dab`; deployment verification passed,
  including the RouterOS compatibility fix.
- LAN read-only authentication, PPP profiles, simple queues, hotspot profiles,
  PPP session reads and API reconnection passed through the application connection
  manager on an RB951Ui-2HnD running RouterOS 7.24.1.
- An isolated PPPoE write test passed after correcting the local RouterOS adapter:
  temporary profile/rate creation, disabled account creation, idempotent retry,
  enable/suspend, repeated release and verified cleanup. Test identifier:
  `billing-test-7bfc1660a5ab8a05`. No real subscriber was used.
- Validation after the RouterOS adapter fix: all 215 server tests passed,
  including a receiver/channel regression test for consecutive empty replies.
  The PowerShell prompt passed syntax validation and was used for the successful
  live write check. The previous API contract audit remains unchanged by this fix.

## Dedicated subscriber lab setup

The user connected a dedicated Tenda N300 (LAN management `192.168.0.1`) WAN port
to the service MikroTik's `ether3`. On 10 October, read-only inspection confirmed
ether3 is active on the existing PPPoE service bridge. The subscriber lab provisioned:

- PPPoE account `billing-lab-tenda`, dedicated profile and addresses
  `10.254.250.1` / `10.254.250.2`, with a 2 Mbps bidirectional test rate.
- Static service `10.254.251.2/30`, gateway `10.254.251.1` on the bridge, and the
  owned queue `billing-lab-tenda-static` with verified 2 Mbps bidirectional limits.
  No active FastTrack rules were observed.

PPPoE subscriber authentication was subsequently verified: the MikroTik reported
an active `billing-lab-tenda` session with address `10.254.250.2`, and the user
confirmed browsing through the Tenda. Suspension passed on the router, removed
the test session, and the user confirmed internet access stopped. Resume was
accepted by the router. A subsequent observation confirmed the subscriber had
reauthenticated at `10.254.250.2` with an active route and enabled account. A
three-packet upstream probe from the PPP gateway address had no packet loss.
The user initially reported connected status without internet after resume, then
confirmed the connection was restored during follow-up checks. Subscriber
browsing restoration is accepted on that confirmation. No additional router
configuration was changed to obtain that restoration; its transient cause is
not established. PPPoE authentication, browsing, suspension and restoration have
passed in this local lab. Measured throughput and accounting remain separate gates.

At static provisioning, counters were zero. Static subscriber traffic, shaping,
and suspension/restoration remain pending.
The lab resources intentionally remain for the user's Tenda tests. The runbook
`docs/runbooks/tenda-subscriber-lab.md` records settings, controls and cleanup.

## Remaining verification

- The live write test called the service directly from this PC. The complete
  deployed customer/assignment/outbox path has not been exercised against the router.
- Cloud-to-router reachability, static subscriber traffic, accounting accuracy,
  measured shaping/FUP enforcement and full recovery remain pending.

## Next acceptance steps

1. Keep the Render API on the intended `main` revision. The RouterOS compatibility
   fix has passed deployment verification; later lab-only tooling is not required
   to run inside Render.
2. Run `npm run verify:deployment` once deployment completes. Both health endpoints
   must report the expected commit, and the frontend content must match the build.
   If a revision is still absent, investigate the service's source/start command;
   do not assume a database-ready result proves the new backend is running.
3. Keep the PC connected to the router LAN for remaining local acceptance. Its
   Ethernet address at the successful check was `192.168.88.185`, with router
   `192.168.88.1`. Use the local masked password prompt for authentication;
   never put a router password into chat or a committed file.
4. Establish and verify cloud-to-router routing before claiming the Render backend
   can control the router. A successful local PC test does not establish that route.
5. Test the shared customer/service lifecycle with an isolated test subscriber,
   then verify real accounting and FUP traffic as specified in the network
   readiness runbook. Verify cleanup of temporary router objects.

Reports in `artifacts/` are local evidence and are excluded from Git. No live
acceptance item should be marked passed based only on a mocked integration test.
