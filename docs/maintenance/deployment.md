# Deployment

Cloudflare Pages is the preferred deployment target.

## Cloudflare Pages

- Project name: `serverlessvideochat`
- Build output: `dist`
- Pages domain: `serverlessvideochat.pages.dev`
- Custom domain: `chat.uavserver.cn`
- Production base path: `/`
- Pages Function: `GET /api/turn-credentials` from the repository root `functions/` directory

Build before deploying:

```powershell
npm run build
```

The regular build runs `scripts/prepareCloudflarePages.mjs` after Vite and removes the GitHub Pages-specific `dist/404.html`. Cloudflare Pages only enables its automatic SPA fallback when no top-level `404.html` is present. `npm run build:github` does not run this cleanup and therefore keeps the GitHub redirect page.

`public/_routes.json` is copied into `dist` and limits Function routing to `/api/*`. Wrangler direct upload discovers the repository-root `functions/` directory when the deploy command runs from the project root; do not deploy only from inside `dist`.

Before the first dynamic TURN deployment, configure these Pages bindings without printing their values:

- encrypted secret `TURN_SHARED_SECRET`, matching coturn `static-auth-secret`
- text variable `TURN_URLS`, containing comma-separated production `turn:`/`turns:` URLs
- optional text variable `TURN_CREDENTIAL_TTL_SECONDS` (default 1200, accepted range 300-3600)

`TURN_SHARED_SECRET` can be entered interactively with:

```powershell
npx --yes wrangler@latest pages secret put TURN_SHARED_SECRET --project-name serverlessvideochat
```

Configure non-secret variables in the Cloudflare Pages production environment. Do not place `TURN_SHARED_SECRET` in `.env.local`, a `VITE_*` variable, `wrangler.toml`, shell history, or committed documentation.

Deploy the current local `dist` to Cloudflare Pages:

```powershell
$vars = @{}
Get-Content -LiteralPath '.env.local' | ForEach-Object {
  if ($_ -match '^\s*([^#=]+)=(.*)$') { $vars[$matches[1].Trim()] = $matches[2].Trim() }
}
$env:CLOUDFLARE_API_TOKEN = $vars['CLOUDFLARE_API_TOKEN']
$env:CLOUDFLARE_ACCOUNT_ID = $vars['CLOUDFLARE_ACCOUNT_ID']
npx --yes wrangler@latest pages deploy .\dist --project-name serverlessvideochat --branch main
```

Verify the returned URL:

```powershell
$response = Invoke-WebRequest -Uri '<returned-pages-url>' -UseBasicParsing -TimeoutSec 30
$response.StatusCode
```

Expected status is `200`. For full app confidence, open the returned URL and `https://chat.uavserver.cn` after the custom domain has updated.

Verify the credential endpoint without writing credential values to the console:

```powershell
$credentialResponse = Invoke-WebRequest -Uri '<returned-pages-url>/api/turn-credentials' -UseBasicParsing -TimeoutSec 30
$credentialResponse.StatusCode
($credentialResponse.Content | ConvertFrom-Json).PSObject.Properties.Name
```

Expected fields are `urls`, `username`, `credential`, and `expiresAt`. A `503` means required Pages bindings are missing or invalid. Do not display or persist the field values.

## SPA Fallbacks

- Cloudflare Pages uses `public/_redirects`.
- GitHub Pages uses `public/404.html`.
- The Cloudflare postbuild step removes `dist/404.html`; do not remove that cleanup unless direct `/call/...` requests are verified to return the SPA with status `200`.

Do not break root-path behavior for Cloudflare Pages when changing `vite.config.ts` or router setup.

## GitHub Pages Fallback

GitHub Pages is supported but is not preferred. It requires repository subpath base:

```powershell
npm run build:github
npm run deploy
```

`npm run build:github` builds with `/ServerlessVideoChat/` as the base path.

GitHub Pages does not execute `functions/`. Its deployment therefore requires complete static fallback `VITE_TURN_*` values or a separately secured credential service configured through `VITE_TURN_CREDENTIALS_URL`.

## Deployment Checklist

Before deploy:

- `npm test`
- `npm run check`
- `npm run lint`
- `npm run build`
- Confirm Pages Function bindings exist before relying on dynamic TURN credentials.
- Keep complete static fallback credentials during the coordinated coturn migration; do not remove them before forced-relay verification.

After deploy:

- Verify returned Pages URL status `200`.
- Verify custom domain if this is meant to update production.
- Verify `/api/turn-credentials` returns `200`, expected field names, `Cache-Control: no-store`, and an expiration in the future without logging credential values.
- Check that asset URLs use root paths on Cloudflare Pages, not `/ServerlessVideoChat/`.
- Verify expanded diagnostics reports the credential source and separate media/chat/file transport states.
- During coturn migration, verify both UDP 3478 and TLS 443 forced-relay calls before removing static fallback credentials.
- For file-transfer changes, verify the returned Pages URL and `https://chat.uavserver.cn` are HTTPS, then smoke-test the browser capability split: Chrome/Edge can use direct disk save for files over 10MiB, while browsers without `showSaveFilePicker` reject files over the 10MiB memory fallback with a clear message.
- Do not publish Cloudflare token or TURN credential values in logs, screenshots, commit messages, or chat output.
