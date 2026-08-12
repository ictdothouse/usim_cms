# Installer hardening + dev installer — design

**Date:** 2026-08-12
**Status:** Approved

## Problem

`install.sh` (the one-shot VPS installer) shipped superadmin auto-creation this
session, but exposed two real installer-class bugs during first live use on a
real Ubuntu VPS:

1. `apps/api/src/index.ts` called `app.listen({ port })` with no `host` —
   Fastify defaults to `127.0.0.1`. Inside a Docker container that's the
   container's *own* loopback, unreachable from the host's `docker-proxy`/NAT
   even though the container's own `HEALTHCHECK` (which curls `127.0.0.1`
   from inside the same network namespace) reported healthy the whole time.
   (Already fixed in `apps/api/src/index.ts`, commit `6516d52`.)
2. Docker's own iptables chains (`DOCKER-FORWARD`, `DOCKER-BRIDGE`, etc.) can
   end up in a state where the published port accepts a TCP connection
   (`docker-proxy` is listening) but resets it before any response —
   `sudo systemctl restart docker` (which regenerates those chains) is a
   known, if blunt, self-heal.

Both bugs were invisible to `install.sh`'s own health check, because that
check only ever asked the container "are you healthy from inside yourself?"
— never "can the outside world actually reach you?". Diagnosing them took a
long manual back-and-forth (`docker compose ps`, `curl -v`, `ss -ltnp`,
`iptables -L FORWARD`, `dmesg`, `systemd-detect-virt`) that the installer
should have front-run.

Separately, the user wants a second installer for people who want to run the
whole stack on their own laptop (Mac/Windows/Linux) for local development,
distinct from the VPS production installer.

## Goals

- `install.sh` verifies the stack is reachable **the same way a real browser
  would reach it** (published host port from outside the container) before
  declaring success — never prints a success banner over a broken deploy.
- When that verification fails, `install.sh` auto-diagnoses (dumps the
  specific state that explains *why*) and attempts one bounded self-heal
  before giving up with an actionable report — not a wall of raw tool output.
- A standalone `--diagnose` mode reruns just that diagnostic against an
  already-running stack, so a future "admin UI can't reach the API" report
  doesn't need another hour of manual `curl`/`iptables`/`ss` archaeology.
- `install.sh` supports Debian-family (`apt`, Ubuntu/Debian) and RHEL-family
  (`dnf`, AlmaLinux/Rocky/RHEL/CentOS Stream) VPS hosts through one shared
  script, not a fork.
- A new `install-dev.mjs` lets someone with Node already installed (a
  precondition of this repo regardless) bring up the stack locally on
  Mac, Windows, or Linux with one command.

## Non-goals

- Windows as a **VPS/production** target — not a realistic deployment
  target for this stack, no work spent on it.
- Native (non-Docker) mode for `install-dev.mjs` — Docker Desktop is assumed;
  replicating `install.sh`'s bare-metal path (systemd-equivalent on 3
  different OSes) is real work for a use case (`pnpm dev:*` already covers
  active development) this doesn't need to serve.
- Distros outside the two families above (Arch, Alpine, SUSE, …) — add
  when someone actually needs one, not speculatively.
- Cloud-provider firewalls / security groups — `install.sh` can open `ufw`/
  `firewalld` on the box itself, but has no API into AWS/GCP/Azure/whatever
  security groups; the diagnostic report says so explicitly when the
  in-box checks all pass but the port still isn't reachable from outside.

## Design

### 1. OS/package-manager abstraction (`install.sh`)

A `detect_os_family()` run once near the top of the script reads
`/etc/os-release`'s `ID`/`ID_LIKE` and sets `PKG_MGR` (`apt` | `dnf`) and
`FIREWALL_TOOL` (`ufw` | `firewalld`) — unrecognized `ID`/`ID_LIKE` is a hard
error with a clear message (never a silent `apt` guess on an unknown distro).
Every place the script currently calls `apt-get install -y <pkg>` directly
goes through a new `pkg_install <pkg...>` that branches once on `$PKG_MGR`
(`dnf install -y` on RHEL-family, plus `postgresql-setup --initdb` +
`systemctl enable --now postgresql` immediately after — Debian-family's
`postgresql` package auto-initializes on install, RHEL-family's doesn't).
`open_ufw_ports` becomes `open_firewall_ports`, branching on `$FIREWALL_TOOL`
(`ufw allow <port>/tcp` vs `firewall-cmd --permanent --add-port=<port>/tcp`
+ one `--reload` after the loop). `get.docker.com`'s own install script
already detects the distro itself, so `install_docker_mode`'s Docker
install step is untouched.

### 2. External-reachability verification (`install.sh`, both modes)

Replaces the current "poll `/health` up to 30 times, assume done" with a
two-stage wait, run right after `docker compose up`/systemd unit start in
both `install_docker_mode` and `install_baremetal_mode`:

- **Stage 1 (unchanged):** poll `http://localhost:<api_port>/health` — this
  proves the process started and is answering *something* locally.
- **Stage 2 (new):** `verify_external_reachability api_port admin_port
  frontend_port` — the actual new check. For docker mode this curls the
  published host port from the host (exactly reproducing what
  `docker-proxy`/iptables must get right); for bare-metal mode this is
  largely redundant with stage 1 (no container network boundary exists)
  but stays as the same function for one shared code path and because it
  also re-checks the admin/frontend ports, which stage 1 never touched.

If stage 2 fails, `diagnose_reachability api_port` runs automatically:
prints container/unit status, `ss -ltnp` for the port, and (docker mode
only) the `iptables -L FORWARD`/`DOCKER-FORWARD` chain counters — then tries
exactly one self-heal (`systemctl restart docker` in docker mode; a service
restart in bare-metal mode) and re-runs stage 2 once. If it still fails, the
script prints the diagnostic report plus a fixed checklist ("check your
cloud provider's security group/firewall for this port — this box's own
firewall and Docker's own NAT both look fine") and **exits non-zero without
printing the "Done" success banner** — today's script prints that banner
unconditionally once the 30-poll loop exits, success or not.

### 3. `--diagnose` mode

A new top-level flag: `sudo ./install.sh --diagnose [--mode=docker|bare-metal]`
skips install entirely (same early-exit shape as `--admin-only`) and just
runs `verify_external_reachability` + `diagnose_reachability` against
whatever's already running, using the same port-lookup-from-existing-env
logic `--admin-only` already added. This turns today's manual multi-command
debugging session into one command.

### 4. `install-dev.mjs`

A single Node ESM script (`node install-dev.mjs`, no new dependency — only
Node builtins: `child_process`, `net`, `readline`, `fs`) mirroring
`install.sh`'s docker-mode flow, minus everything VPS-specific:

- Detects Docker present (`docker --version`) and the daemon actually
  reachable (`docker info`) — distinct error messages for "not installed"
  vs "Docker Desktop isn't running", since the fix differs.
- Picks free ports the same way (`net.createServer().listen()` probe per
  candidate port, same increment-until-free approach as `find_free_port`).
- Writes `.env` with `VITE_API_URL`/`VITE_FRONTEND_URL` pointed at
  `localhost:<port>` (no public-IP detection needed — local-only).
- Prompts for superadmin email/password (Node's `readline`, with the
  password prompt using the same terminal-raw-mode masking trick most CLI
  installers use) and, once healthy, POSTs to `/api/setup` — same flow,
  same route, as `install.sh`'s `create_superadmin`.
- Runs the *same-shaped* external-reachability check against
  `localhost:<port>` before declaring success — the Fastify bind-address
  bug class would have been caught by this on any OS; the iptables/
  docker-proxy bug class is Linux-native-Docker-specific and doesn't apply
  under Docker Desktop's own networking, so no iptables diagnostics here.
- No systemd/monitor/ufw/proxy/cert work at all — those are exclusively
  VPS concerns this script never touches.

## Error-handling philosophy (applies to both scripts)

- Never print a success banner unless the thing it claims succeeded was
  actually verified, not just "the polling loop exited".
- Every failure path names the specific next command to run (re-run with
  `--diagnose`, check the cloud firewall, etc.) — never a bare stack trace
  or raw tool dump with no interpretation.
- Auto-heal is attempted at most once per check and is always followed by
  a re-verify — never assumed to have worked.
