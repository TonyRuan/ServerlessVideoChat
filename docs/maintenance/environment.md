# Environment And Secrets

Local deployment and static TURN fallback configuration live in `.env.local`. The file is ignored by `.gitignore` through `*.local`. Cloudflare Pages Function secrets belong in Pages bindings, not in frontend `.env` files.

Never print, commit, paste into docs, or hardcode the actual values from `.env.local`.

## Variables

- `CLOUDFLARE_API_TOKEN`: token used by local Wrangler deploys.
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account id used by local Wrangler deploys.
- `VITE_TURN_CREDENTIALS_URL`: optional credential endpoint override; defaults to `/api/turn-credentials`.
- `VITE_TURN_URLS`: comma-separated static fallback TURN URLs.
- `VITE_TURN_USERNAME`: static fallback TURN username.
- `VITE_TURN_CREDENTIAL`: static fallback TURN credential.
- `VITE_TURN_MODE`: optional TURN mode override. Supported values are described in `docs/maintenance/webrtc.md`.

Cloudflare Pages Function bindings:

- `TURN_SHARED_SECRET`: encrypted secret shared with coturn `static-auth-secret`; never expose it as a `VITE_*` value.
- `TURN_URLS`: server-side comma-separated `turn:` and `turns:` URLs returned to the browser.
- `TURN_CREDENTIAL_TTL_SECONDS`: optional TTL in seconds; defaults to 1200 and is clamped to 300-3600.

## Local Loading Pattern

For local deploy commands, load only the values needed by Wrangler into process environment variables. Do not echo the loaded values.

```powershell
$vars = @{}
Get-Content -LiteralPath '.env.local' | ForEach-Object {
  if ($_ -match '^\s*([^#=]+)=(.*)$') { $vars[$matches[1].Trim()] = $matches[2].Trim() }
}
$env:CLOUDFLARE_API_TOKEN = $vars['CLOUDFLARE_API_TOKEN']
$env:CLOUDFLARE_ACCOUNT_ID = $vars['CLOUDFLARE_ACCOUNT_ID']
```

## Frontend Visibility

All `VITE_*` values are compiled into the frontend bundle when referenced by app code. Treat static TURN username and credential as client-visible fallback values. The preferred production flow fetches short-lived credentials from the same-origin Pages Function; only the resulting temporary username and credential reach the browser. The shared secret must remain a Pages/coturn secret.

Do not create or commit `.dev.vars`, `.env`, or `.env.*` files containing Pages bindings. These patterns are ignored, except for a future sanitized `.env.example`.

## Server Access

Verified on 2026-07-08: the project server is reachable over SSH at `39.108.122.44` with user `admin`.

On this Windows workstation, `ssh` is not on `PATH`, but Git for Windows provides a usable client:

```powershell
& 'C:\Program Files\Git\usr\bin\ssh.exe' admin@39.108.122.44
```

Observed server facts during the access check:

- SSH banner: `OpenSSH_8.4p1 Debian-5`
- Login user: `admin`
- Hostname: `iZwz959h1ms5584sbkjv5sZ`
- Kernel: `Linux 5.10.0-15-amd64 x86_64 GNU/Linux`

Do not commit private keys, SSH passwords, or cloud access keys. The SSH public key must be managed on the server side in the target user's `authorized_keys`.

## Cloudflare Pages Builds

The preferred production deploy uses the root `functions/` directory plus `dist`. Configure `TURN_SHARED_SECRET`, `TURN_URLS`, and the optional TTL as Pages Function bindings before enabling coturn shared-secret authentication. Complete `VITE_TURN_*` values may remain during migration, but remove the static username and credential from production only after forced-relay verification succeeds with dynamic credentials.

GitHub Pages cannot run the credential Function. Its build therefore needs complete static fallback `VITE_TURN_*` values or an explicitly configured external credential service with equivalent origin and abuse controls.

## Current TURN Host State

Verified read-only on 2026-07-13:

- coturn is active on UDP/TCP 3478.
- TLS and DTLS are disabled, and TURN is not listening on 443.
- The configured relay UDP range is currently 49160-49200, which is narrow for concurrent sessions.
- The planned dedicated TURN hostname is not ready for production use yet.

Do not switch coturn from static users to `use-auth-secret`, remove frontend fallback credentials, or advertise `turns:` until DNS, certificate, host firewall, and Alibaba Cloud security-group changes have all been verified.

## Current Production Credential State

Verified after the 2026-07-14 `v0.0.8` deployment:

- Cloudflare Pages serves the new recovery client and the `/api/turn-credentials` Function route.
- Pages shared-secret bindings are not configured yet, so the Function returns `503` JSON with `Cache-Control: no-store`.
- The browser therefore uses the complete static `VITE_TURN_*` fallback currently embedded in the production build.
- coturn authentication, listeners, and relay range remain unchanged.

This is an intentional migration state. Configure matching Pages/coturn shared secrets and verify forced relay before removing the static fallback.
