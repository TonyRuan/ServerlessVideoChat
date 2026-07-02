# Deployment

Cloudflare Pages is the preferred deployment target.

## Cloudflare Pages

- Project name: `serverlessvideochat`
- Build output: `dist`
- Pages domain: `serverlessvideochat.pages.dev`
- Custom domain: `chat.uavserver.cn`
- Production base path: `/`

Build before deploying:

```powershell
npm run build
```

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

## SPA Fallbacks

- Cloudflare Pages uses `public/_redirects`.
- GitHub Pages uses `public/404.html`.

Do not break root-path behavior for Cloudflare Pages when changing `vite.config.ts` or router setup.

## GitHub Pages Fallback

GitHub Pages is supported but is not preferred. It requires repository subpath base:

```powershell
npm run build:github
npm run deploy
```

`npm run build:github` builds with `/ServerlessVideoChat/` as the base path.

## Deployment Checklist

Before deploy:

- `npm test`
- `npm run lint`
- `npm run build`
- Confirm `.env.local` exists locally when TURN-backed build output is required.

After deploy:

- Verify returned Pages URL status `200`.
- Verify custom domain if this is meant to update production.
- Check that asset URLs use root paths on Cloudflare Pages, not `/ServerlessVideoChat/`.
- For file-transfer changes, verify the returned Pages URL and `https://chat.uavserver.cn` are HTTPS, then smoke-test the browser capability split: Chrome/Edge can use direct disk save for files over 10MiB, while browsers without `showSaveFilePicker` reject files over the 10MiB memory fallback with a clear message.
- Do not publish Cloudflare token or TURN credential values in logs, screenshots, commit messages, or chat output.
