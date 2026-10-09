# Customer and PPPoE service workflow

## Responsibilities

Customers owns contact information, account numbers, billing plans and preferences.
Creating or editing a customer does not create, rename, change the profile of, or
delete a router account. It works while the router is offline. New records have
`networkWorkflowVersion: 2`. Hotspot is also a supported customer connection type.

The customer detail screen, PPPoE page and router Subscribers tab share the same
network assignment panel and backend. The PPPoE page filters those records to PPPoE;
it is no longer an independent router-account editor. Customer account numbers remain
billing references and can differ from the linked router username.

## New subscriber

1. Add a customer and select a billing plan. Save the customer record.
2. In the linked service panel, choose Add subscriber. Select the intended router,
   service type, username, password and existing router profile.
3. Queue provisioning and wait for the confirmed state. Active billing entitlement
   is required for access. A customer marked active without a future expiry does
   not qualify; new customers start inactive and the account can be provisioned
   disabled until payment activation.
4. Manage suspension, resume, password changes and release through that service.

The billing plan does not automatically select or change a RouterOS profile or
base static queue rate. Configure the appropriate existing profile separately.
Password updates are encrypted, versioned and queued under the same assignment
lease as provisioning and FUP. Existing sessions retain their current connection
until reconnect. A successful router secret re-read does not prove authentication
with the new password; live subscriber authentication remains an acceptance check.

## Link existing PPPoE subscribers

Existing customers are not automatically re-provisioned or adopted. Review them
before relying on assignment-based control:

1. Select the customer and choose Add subscriber > Link existing router account.
2. Select the exact router. Discovery lists unreserved PPPoE/any local accounts,
   excluding accounts with another billing assignment ownership marker. Discovery
   never returns passwords.
3. Review the username, profile and disabled state. Exact account-number/alias
   matches are suggested; multiple matches require an operator decision. A match
   is not permission to adopt an account automatically.
4. Confirm that the account belongs to that customer and queue the link. The worker
   checks the saved router object ID and original comment before changing ownership.
   Changes since preview or another assignment's marker cause a conflict.
5. Confirm the linked service state. Linking preserves password and profile; billing
   restrictions or an existing disabled state can keep the service suspended.

Linked accounts are not recreated if someone removes them outside the system. Their
password is unknown until an operator queues a credential change. Release verifies
ownership and removal. Do not recreate the same customer to migrate their service.
Existing static installations require a separate migration of their queue/IP ownership;
the automatic existing-account link flow in this release is for PPPoE only.

Legacy customers without assignments retain their existing billing access fallback
while migration is performed. That fallback refuses PPP secrets already marked as
assignment-owned. Once any assignment exists for a customer, including a released
assignment, billing does not fall back to account-number-based router writes.

## Access precedence and expiry

Each managed assignment stores manual state and billing state. Its requested access
is suspended if either requires suspension; release is final. FUP adds a further
restriction. Payment activation can clear the billing restriction but cannot clear
manual suspension or FUP. Manual resume cannot bypass a billing restriction.

Customer expiry uses the access outbox used by payment activation. The former
`LEGACY_ENFORCEMENT_JOBS` switch no longer registers parallel customer writers.
Voucher expiry refuses assignment-owned accounts. Assignment/FUP workers fence
access revisions before commands and before confirmation.

## Archival and deployment

Customer removal now archives the record, preserving financial history. All services
must first be released and router removal confirmed. Legacy customer records that
still describe an unlinked service must be linked and released before archival.
Archived customers cannot receive new services or be reactivated by payment sync.
Archival and service creation serialize through the customer record.

Deploy the frontend and backend together. Older clients using direct POST `/api/pppoe`,
PUT `/api/pppoe/update/:username`, DELETE `/api/pppoe/remove/:username` or the old
PPP enable/disable endpoints receive HTTP 409 with instructions to use linked services.
Customer network-setting edits also receive a conflict directing the operator to the
service. New schema fields have defaults and tolerate existing assignment documents
without revision fields; no bulk router mutation or automatic adoption is performed.

See [network readiness](network-readiness.md) for cloud routing and live hardware
acceptance requirements. Automated transport fixtures do not establish a live router test.
