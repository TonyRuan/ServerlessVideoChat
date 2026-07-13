# Environment And Secrets

Local deployment and TURN configuration live in `.env.local`. The file is ignored by `.gitignore` through `*.local`.

Never print, commit, paste into docs, or hardcode the actual values from `.env.local`.

## Variables

- `CLOUDFLARE_API_TOKEN`: token used by local Wrangler deploys.
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account id used by local Wrangler deploys.
- `VITE_TURN_URLS`: comma-separated TURN URLs.
- `VITE_TURN_USERNAME`: TURN username.
- `VITE_TURN_CREDENTIAL`: TURN credential.
- `VITE_TURN_MODE`: optional TURN mode override. Supported values are described in `docs/maintenance/webrtc.md`.

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

All `VITE_*` values are compiled into the frontend bundle when referenced by app code. Treat TURN username and credential as client-visible credentials. If abuse or public-traffic scale becomes a concern, replace static frontend TURN credentials with short-lived credentials issued by a server-side component.

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

The preferred local deploy path builds with `.env.local` present and deploys the generated `dist`. If Cloudflare Pages automatic builds are used later, configure equivalent TURN variables in the Cloudflare Pages environment, or the hosted build will not contain TURN configuration.
