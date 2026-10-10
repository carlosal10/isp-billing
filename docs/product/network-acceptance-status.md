# Network acceptance checkpoint

Checked 10 October 2026, Africa/Nairobi. Implementation under review:
`465fba4efa70993b8a47c0fbab3491df6b3007ca` on `main`.

## Verified

- Public frontend JavaScript and CSS match the local committed production build
  byte for byte, including the shared Customers / PPPoE workflow.
- Public API `/health` responds successfully.
- Public API `/ready` reports database connected, lifecycle ready, and jobs enabled.
  Jobs enabled is a configuration indicator, not proof of worker progress.
- Both API responses allow the production frontend origin.
- Previous implementation validation: 214 server tests passed, and API contract
  audit passed. These checks were not repeated on 10 October because no runtime
  code changed during this checkpoint.

## Not verified

- API responses omit the `revision` field added in `465fba4`. The running backend
  cannot be confirmed as the matching version. A healthy response alone does not
  establish that the shared service endpoints are deployed.
- The local router API at `192.168.88.1:8728` times out. No router write was
  attempted at this checkpoint.
- Cloud-to-router reachability, real subscriber authentication and traffic,
  accounting accuracy, measured FUP enforcement and live recovery remain pending.

## Next acceptance steps

1. On Render, verify that the API service uses the intended repository and `main`
   branch, then deploy the latest commit. If deployment fails, inspect its logs.
2. Run `npm run verify:deployment` once deployment completes. Both health endpoints
   must report the expected commit, and the frontend content must match the build.
   If a revision is still absent, investigate the service's source/start command;
   do not assume a database-ready result proves the new backend is running.
3. Restore this PC's route to the router LAN or supply the actual router LAN
   address. Use the existing local masked password prompt for authentication;
   never put a router password into chat or a committed file.
4. Confirm read-only authentication and reconnection before isolated live writes.
5. Test the shared customer/service lifecycle with an isolated test subscriber,
   then verify real accounting and FUP traffic as specified in the network
   readiness runbook. Verify cleanup of temporary router objects.

Reports in `artifacts/` are local evidence and are excluded from Git. No live
acceptance item should be marked passed based only on a mocked integration test.
