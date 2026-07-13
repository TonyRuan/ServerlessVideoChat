import { rmSync } from 'node:fs';

// A top-level 404.html disables Cloudflare Pages' automatic SPA fallback.
// GitHub Pages still receives this file through the separate build:github flow.
rmSync('dist/404.html', { force: true });
