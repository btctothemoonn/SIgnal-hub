# VPS Security Maintenance

## 2026-10-23 Baseline

The security repair keeps the existing application, MiniMax settings, Web Push,
collector assignments and private runtime data unchanged.

| Component | Patched version |
| --- | --- |
| Node.js | 24.22.1 (NodeSource 24.x) |
| Next.js / eslint-config-next | 16.4.1 |
| React / React DOM / react-test-renderer | 19.2.9 |
| sharp override | 0.35.5 |
| undici 7.x override | 7.30.1 |
| ip-address override | 10.7.4 |
| source-map-js override | 1.2.2 |
| Ubuntu ca-certificates | 20260816ubuntu0.24.04.1 |
| Ubuntu OpenSSL / libssl3t64 / libssl-dev | 3.0.13-0ubuntu3.16 |
| Ubuntu NSS | 2:3.98-1ubuntu0.3 |
| Owned-reader Python certifi | 2026.10.19 |

No PHP runtime is installed or used by Signal Hub. Caddy terminates HTTPS and
proxies to the loopback Next.js listener. Do not add PHP to resolve an unrelated
security advisory. The existing public certificate is valid; its renewal stays
under Caddy's certificate management.

## 2026-10-30 Audit

`pnpm audit --prod` on 2026-10-30 reported eight undici advisories, all patched in
7.30.1. The only production path was `cheerio -> undici`. The `undici@7` override
moved from 7.29.1 to 7.30.1. Other overrides, Next, React, and X readiness checks
were left unchanged.

The site certificate previously expired at about 2026-12-09 00:03 Asia/Shanghai
(2026-12-08 16:03:49 UTC). This audit did not read the live certificate chain.
Before that date, confirm Caddy/Let's Encrypt renewal still schedules a
replacement. Do not treat a successful HTTPS response months earlier as proof
the current certificate is still inside that window.

## Security Update Policy

The existing unattended-upgrades configuration allowed only the base Ubuntu
origin, so enabling its timer alone did not install security updates. Install the
tracked policy drop-in without editing the distribution-managed file:

```bash
sudo install -m 0644 ops/apt/99-signal-hub-security /etc/apt/apt.conf.d/99-signal-hub-security
apt-config dump | grep -E 'Unattended-Upgrade::(Allowed-Origins|Origins-Pattern)'
sudo unattended-upgrade --dry-run --debug
```

The policy clears earlier origin rules and enables the base, security and
available ESM security origins, not proposed or backports. It does not enable
automatic reboots. It does not replace application dependency releases or a
separate NodeSource runtime update check. Installing a runtime or TLS package
does not patch processes already running: restart the affected services and
check their actual executable versions afterward.

## Python Trust Store

The owned reader uses an external venv; website deployment intentionally does
not reinstall it. Keep its certifi pin aligned with
`scripts/requirements-x-owned-reader.txt`. If the venv has no pip, the host pip
can target it explicitly:

```bash
python3 -m pip --python /home/ubuntu/signal-hub-owned-reader-pilot/venv/bin/python install --no-deps --only-binary=:all: --index-url https://pypi.org/simple certifi==2026.10.19
python3 -m pip --python /home/ubuntu/signal-hub-owned-reader-pilot/venv/bin/python check
sudo systemctl restart signal-hub-x-owned-reader
```

Preserve the existing session database, cooldown files and collector account
assignments. Never disable certificate validation to work around a trust error.

## Verification and Recovery

- Run all test files, ESLint, the production build and the production dependency
  audit before release. A failed audit fetch is not a clean audit.
- Deploy through the existing atomic release script and authenticated readiness
  checks. Verify the live `.release-commit`, not merely the main checkout's HEAD.
- Verify HTTPS, the authenticated feed and the Web Push heartbeat after service
  restarts. Check actual Node PIDs use the patched runtime.
- Inspect Node's default and system CA stores, plus the Python certifi store,
  for the revoked `emSign ECC Root CA - G3` root.
- A private, mode-0700 backup of the old Node binary, package versions, Python
  certifi package and apt policy is retained at
  `/home/ubuntu/signal-hub-security-backup-20261023-63C9VApJ`.
- The previous app release remains available through the normal deployment
  rollback path. Do not restore vulnerable runtimes or trust stores merely to
  roll back application code. Removing only the new apt drop-in restores the
  old update policy, which would again omit Ubuntu security updates.
