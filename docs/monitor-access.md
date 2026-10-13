# Ops monitor access

The monitor can restart services and deploy code as root. Its HTTP listener
stays on the host's Docker bridge address; port 5555 must stay closed at the
host and cloud firewall. Only the selected access path should be public.

## Temporary HTTPS access during development

On a production-mode VPS where Caddy owns ports 80/443, point a dedicated DNS
name at the VPS, pull the updated code, and run:

```bash
sudo bash scripts/monitor-access.sh public monitor.43-163-113-24.sslip.io
```

Open `https://monitor.43-163-113-24.sslip.io/`. On the first restart after
installing account management, the existing `MONITOR_USER` and
`MONITOR_PASSWORD` from `/etc/ucms-monitor.env` are migrated to a root-only
password-hash file at `/etc/ucms-monitor-users.json`. Sign in with the same
credentials once, then change the human password in **Accounts**. The env
password stays unchanged as an internal API credential for SSL issuance only;
it cannot sign in to the public monitor after the human password changes.
`install.sh` generates a random 32-byte hexadecimal initial password by
default. Caddy provides HTTPS and
forwards only this host to the monitor's private address; the monitor checks
the Host and Origin itself. The command updates the running Caddy route
without deploying the app tier, so a failed blue/green smoke test does not
force the current live color to restart. For older installations with no
`MONITOR_HOST` in `/etc/ucms-monitor.env`, this command detects Docker's
private bridge gateway and adds the missing setting before restarting the
monitor; rerunning the full production installer is unnecessary.

## Manage administrators

The **Accounts** tab lists monitor administrators, changes your password, adds
another administrator, and removes one. Every administrator can deploy code
and control the VPS. Enter your current password for each change. Passwords
must be at least 24 bytes. The new password takes effect immediately; close
and reopen the browser tab to sign in again. The monitor keeps password hashes
using scrypt with a unique salt and stores them in a root-owned mode 0600
file. Do not copy that file into the repository. Back it up with the other
root-only server secrets; the adjacent `.initialized` marker prevents a
missing user file from silently restoring the old bootstrap password.

If all administrators forget their passwords, use the VPS console:

```bash
cd ~/usim_cms
sudo bash scripts/monitor-users.sh reset admin
```

Replace `admin` with the account name. This prints a new random password
once, without putting it in shell history or command arguments. There is no
need to restart the monitor. The recovery command requires root and an
existing valid user file. If the user file is lost, restore it from a backup
along with the marker; the service deliberately fails closed.

Public mode requires this Caddy instance to terminate TLS. Plain HTTP gets a
403 response before it reaches the password prompt. If another proxy owns
80/443, use cloud mode with its identity policy, or configure a dedicated
TLS path that keeps the monitor private upstream.

## Return to SSH access

```bash
sudo bash scripts/monitor-access.sh ssh
ssh -L 5555:172.17.0.1:5555 user@server
```

Use the `MONITOR_HOST` and `MONITOR_PORT` values in `/etc/ucms-monitor.env`
in place of `172.17.0.1:5555` if they differ. Open
`http://localhost:5555/`. SSH mode removes the public Caddy route and the
monitor rejects requests to its former public domain.

## Identity-protected cloud access later

```bash
sudo bash scripts/monitor-access.sh cloud monitor.example.org
```

Cloud mode removes the direct Caddy route. Configure a managed tunnel or VPN
separately, with an identity policy and MFA at its edge, using the private
`http://MONITOR_HOST:MONITOR_PORT` address from `/etc/ucms-monitor.env` as the
origin. Forward the public domain as `Host`. The monitor continues to require
its own password. A cloud tunnel is not configured by this repository; its
provider account and access policy must be set up by the operator.

The switch writes nonsecret `monitor/access/config.json` (ignored by Git) and
updates `.env`. API containers built from this change read that file on each
Caddy sync, so the chosen mode survives later blue/green promotions. The
systemd monitor restarts to load its matching Host policy. If the live API
still uses an older image, the command applies the route immediately but a
later Caddy resync or restart can remove it until a successful app deploy;
rerun the switch if that happens. If Caddy sync fails, SSH mode still rejects
the old public host immediately. If there is no live production API
container, the setting applies at the next production deploy.
