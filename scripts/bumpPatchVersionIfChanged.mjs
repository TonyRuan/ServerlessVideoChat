import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  bumpPatchVersion,
  shouldBumpVersion,
  updatePackageJsonVersion,
  updatePackageLockVersion,
} from './versioning.mjs';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trimEnd();
}

function readHeadPackageVersion() {
  try {
    return JSON.parse(git(['show', 'HEAD:package.json'])).version;
  } catch {
    return null;
  }
}

const packageJsonText = readFileSync('package.json', 'utf8');
const currentVersion = JSON.parse(packageJsonText).version;
const headVersion = readHeadPackageVersion();
const statusLines = git(['status', '--porcelain', '--untracked-files=all']).split(/\r?\n/).filter(Boolean);

if (!shouldBumpVersion({ statusLines, currentVersion, headVersion })) {
  console.log(`version unchanged: ${currentVersion}`);
  process.exit(0);
}

const nextVersion = bumpPatchVersion(currentVersion);
writeFileSync('package.json', updatePackageJsonVersion(packageJsonText, nextVersion));

try {
  const packageLockText = readFileSync('package-lock.json', 'utf8');
  writeFileSync('package-lock.json', updatePackageLockVersion(packageLockText, nextVersion));
} catch {
  // package-lock.json is optional for this script.
}

console.log(`version bumped: ${currentVersion} -> ${nextVersion}`);
