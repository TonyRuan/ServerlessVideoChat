# Git Workflow

Default branch is `main`.

Remote:

```text
https://github.com/TonyRuan/ServerlessVideoChat.git
```

## Inspect Before Staging

```powershell
git status --short --branch
git diff --stat
```

Review file-level diffs before staging:

```powershell
git diff -- <path>
```

## Do Not Stage

- `.env.local`
- `dist`
- `.wrangler`
- `node_modules`
- local logs
- screenshots or temporary browser artifacts

## Safe Directory Workaround

If Git reports dubious ownership in this checkout, use a per-command override:

```powershell
git -c safe.directory=E:/TR/misc/SVC/ServerlessVideoChat status --short --branch
```

Prefer per-command overrides over changing unrelated global Git state.

## Commit And Push

Stage only the intended files:

```powershell
git add <paths>
git status --short --branch
git commit -m "<message>"
git push origin main
```

If `npm run build` bumped the package patch version, include both `package.json` and `package-lock.json` in the same commit as the behavior change that caused the bump.

Before pushing, ensure tests required by `docs/maintenance/testing.md` were run or clearly report why they were not run.
