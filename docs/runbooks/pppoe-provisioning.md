# Local PPPoE provisioning

The Subscribers form creates a local PPPoE secret through the durable worker.
Select an existing PPPoE customer and saved router, then enter a unique username,
a password of 8–128 characters, and the exact RouterOS PPP profile name.
The profile must already exist on that router. The backend must be able to reach it.

POST `/api/network/assignments` requires `customerId`, `routerId`, `accessType:
"pppoe"`, `username`, `password`, and `pppProfile` for local authentication.
The password is encrypted with the configured field encryption key and omitted
from API responses and operation payloads. It is retained encrypted for retry
and account recovery; preserve the encryption key with your database backups.

The worker checks profile existence before creation and marks the secret with
the assignment ID. Retries reuse only accounts owned by that assignment;
unrelated usernames fail without modification. Existing managed FUP profiles
are preserved during reconciliation. Release verifies ownership before removal.
Creation, verification, and access-state changes must succeed before the
assignment reports an observed state of `present` or `suspended`.

Check the Operations tab for failures. Identity/profile changes on these
assignments are rejected until a dedicated change workflow is available.
RADIUS authentication remains a separate integration.

## Live test boundary

Read-only checks passed against the LAN router using `billing-test`.
Creation, subscriber authentication, suspension, release and FUP have not yet
been tested on live hardware. Use a designated test subscriber and narrowly
scoped write access before running those checks. Cloud-to-LAN routing remains
necessary for a cloud worker to reach the private router address.
