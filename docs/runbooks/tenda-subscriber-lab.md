# Tenda subscriber acceptance lab

Service router: MikroTik RB951Ui-2HnD at `192.168.88.1`, RouterOS 7.24.1.
Dedicated subscriber router: Tenda N300 at `192.168.0.1`.
Cable: MikroTik `ether3` to Tenda WAN. The existing service bridge includes ether3.

Keep the PC connected to the MikroTik for API checks. Configure the Tenda from
another device on its Wi-Fi. Do not enable remote Tenda management to work around
its management page being unreachable from the MikroTik side.

## Credentials and scope

Use `scripts/router-readonly-prompt.ps1` for the masked MikroTik `billing-test`
password. Credentials pass through stdin, never command arguments or reports.
The PPPoE provision action also asks the operator to choose a subscriber password;
enter the same password in the Tenda. Re-provision does not rotate that password.

These runners exercise the application's provisioning services directly from
the LAN PC. They do not create billing customers or database assignments and do
not prove the hosted API/outbox path. Do not try to adopt their router resources
into the production workspace; release them through the lab runner after testing.

## PPPoE

Launch the prompt with `-LabAction provision`, then configure the Tenda:

- Internet connection: PPPoE.
- Username: `billing-lab-tenda`.
- Password: chosen in the masked provisioning prompt.
- Address and DNS: automatic.
- Optional service name: leave empty initially; existing server is `KT0001`.

Dedicated profile: `billing-lab-tenda-profile`, gateway `10.254.250.1`,
subscriber `10.254.250.2`, rate `2M/2M`. Provisioning checks subnet conflicts first.
No existing PPP profile or address pool is edited.

Use `-LabAction observe` to verify a matching active PPPoE session. Authentication
passes only when that session exists with the expected address. Separately browse
from a device connected through the Tenda, with mobile data/other uplinks disabled.
Use `suspend`, then `resume`, and observe actual loss/restoration of access.
Use `release` after acceptance to disconnect/remove only the owned account/profile.

## Static IP

Launch the prompt with `-LabAction provision -StaticLab`. It checks subnet conflicts,
adds the isolated gateway address on the existing bridge, invokes the static
provisioning service, and sets the owned test queue to `2M/2M`.

After completing PPPoE checks, switch the Tenda Internet connection to Static IP:

- WAN address: `10.254.251.2`.
- Subnet mask: `255.255.255.252`.
- Gateway: `10.254.251.1`.
- DNS: `1.1.1.1`, alternative `8.8.8.8`.
- Keep Tenda LAN at `192.168.0.1`.

Static IP has no username/password authentication. Confirm WAN connectivity and
browsing, observe managed queue counters, then test `suspend`/`resume` with
`-StaticLab`. Release removes the lab queue/access rules and its owned gateway.
The runner reports active FastTrack rules; it never disables global firewall
features. Queue shaping requires an actual traffic test and may be bypassed by
FastTrack/offload. Do not mark shaping passed from configured queue limits alone.

## Reports and recovery

Local reports (excluded from Git): `artifacts/router-topology-result.json`,
`artifacts/router-subscriber-lab-result.json`, `artifacts/router-static-lab-result.json`.
Reports contain only selected network state and no passwords.

Partial provisioning is retained for inspection rather than silently deleted.
PPPoE ownership marker: `billing-assignment:lab-tenda-pppoe`.
Static gateway comment: `billing-lab-static-gateway`.
Static queue: `billing-lab-tenda-static`.
Never delete similarly named resources unless their ownership and target match.

The initial inspection found overlapping DHCP and PPP pools on the existing
`192.168.88.0/24` network. The lab uses separate subnets; correcting the existing
pool design requires a separate migration and must not be attempted during this test.
