import { describe, expect, it } from 'vitest';
import {
  bumpPatchVersion,
  hasRelevantChanges,
  shouldBumpVersion,
  updatePackageJsonVersion,
  updatePackageLockVersion,
} from './versioning.mjs';

describe('versioning', () => {
  it('bumps only the patch segment', () => {
    expect(bumpPatchVersion('0.0.0')).toBe('0.0.1');
    expect(bumpPatchVersion('1.2.9')).toBe('1.2.10');
  });

  it('detects relevant source and doc changes', () => {
    expect(hasRelevantChanges([' M src/pages/CallPage.tsx', ' M README.md'])).toBe(true);
    expect(hasRelevantChanges([' M package.json', ' M package-lock.json'])).toBe(false);
  });

  it('skips repeated bumps when package version already differs from HEAD', () => {
    expect(shouldBumpVersion({
      statusLines: [' M src/pages/CallPage.tsx', ' M package.json'],
      currentVersion: '0.0.1',
      headVersion: '0.0.0',
    })).toBe(false);
  });

  it('bumps when relevant changes exist and package version still matches HEAD', () => {
    expect(shouldBumpVersion({
      statusLines: [' M src/pages/CallPage.tsx'],
      currentVersion: '0.0.0',
      headVersion: '0.0.0',
    })).toBe(true);
  });

  it('updates package manifests without changing other fields', () => {
    const packageJson = '{\n  "name": "trae-project",\n  "version": "0.0.0"\n}\n';
    const packageLock = '{\n  "name": "trae-project",\n  "version": "0.0.0",\n  "packages": {\n    "": {\n      "name": "trae-project",\n      "version": "0.0.0"\n    }\n  }\n}\n';

    expect(updatePackageJsonVersion(packageJson, '0.0.1')).toContain('"version": "0.0.1"');
    const updatedLock = updatePackageLockVersion(packageLock, '0.0.1');
    expect(updatedLock).toContain('"version": "0.0.1"');
    expect(updatedLock).toContain('"name": "trae-project"');
  });
});
