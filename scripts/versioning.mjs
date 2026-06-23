const IGNORED_BUMP_PATHS = new Set([
  'package.json',
  'package-lock.json',
]);

function statusPath(line) {
  const raw = line.slice(3).trim();
  const renamed = raw.split(' -> ').pop();
  return renamed.replace(/\\/g, '/');
}

export function bumpPatchVersion(version) {
  const parts = version.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    throw new Error(`Unsupported semver version: ${version}`);
  }

  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}

export function hasRelevantChanges(statusLines) {
  return statusLines.some((line) => {
    if (!line.trim()) return false;
    const path = statusPath(line);
    if (!path || IGNORED_BUMP_PATHS.has(path)) return false;
    if (path.startsWith('dist/') || path === '.codex/vite-dev.log') return false;
    return true;
  });
}

export function shouldBumpVersion({ statusLines, currentVersion, headVersion }) {
  if (!hasRelevantChanges(statusLines)) return false;
  if (headVersion && currentVersion !== headVersion) return false;
  return true;
}

export function updatePackageJsonVersion(text, version) {
  const manifest = JSON.parse(text);
  manifest.version = version;
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function updatePackageLockVersion(text, version) {
  const manifest = JSON.parse(text);
  manifest.version = version;
  if (manifest.packages?.['']) {
    manifest.packages[''].version = version;
  }
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
