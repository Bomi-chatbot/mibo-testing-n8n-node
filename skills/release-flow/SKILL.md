---
name: release-flow
description: Cut a release of @mibo-ai/n8n-nodes-mibo-testing via release-please + npm provenance. Use when the user mentions releasing, publishing, bumping the version (including major bumps and pre-1.0 → 1.0), writing a commit message, changing a workflow under `.github/workflows/`, configuring `NPM_TOKEN`, or asks how to push a new version to npm.
metadata:
  version: "1.0.0"
---

# Release flow

Releases are fully automated. Humans write **Conventional Commits**; release-please cuts the version and the changelog; CI publishes to npm with provenance. Nobody edits `package.json` `version` or `CHANGELOG.md` by hand.

## Mental model

```
commit(feat:|fix:|feat!:) → push to main
        │
        ▼
release-please-action  ─────►  open/update a "Release PR"
                                (bumps version + writes CHANGELOG)
        │
   merge Release PR
        ▼
   tag vX.Y.Z + GitHub Release
        │
        ▼
   release.yml (on release: published)
        │
        ▼
   npm publish --provenance --access public
```

## How release-please decides the next version

Release-please reads every conventional commit since the last release tag and picks the **highest** bump implied:

| Commit example | Bump |
|---|---|
| `feat: add filter preset for n8n triggers` | **minor** (0.2.1 → 0.3.0) |
| `fix: handle 413 from Mibo API as oversized payload` | **patch** (0.2.1 → 0.2.2) |
| `perf: stream gzip instead of buffering` | **patch** |
| `feat!: remove deprecated targetNodes string format` | **major** (0.2.1 → 1.0.0) |
| Body containing `BREAKING CHANGE: removed credential field n8nApiKey` | **major** |
| `chore: bump formatter to the next minor` | **none** (no Release PR update) |
| `docs: clarify auto-detect setup` | **none** |
| `test: cover gzip boundary` | **none** |
| `ci: pin pnpm to 10.16.1` | **none** |
| `refactor: extract header builder` | **none** |

### Pre-1.0 nuance

While the package is `0.x`, breaking commits still bump the **minor** by default in some tools — but our config (`release-type: node`) bumps **major** on `!` / `BREAKING CHANGE` exactly as listed above. To stay safe, when intentionally going to 1.0:

- Land all required `feat:` / `fix:` first.
- Add a final commit on `main` with footer:
  ```
  Release-As: 1.0.0
  ```
- Release-please will retarget the open Release PR to `v1.0.0`.

## Decision guide — when to use which prefix

Ask: **does this change a public surface?** Public surfaces are:

- Node parameter names, defaults, types, or visibility logic.
- Credential field names or required-ness.
- Output shape (`_miboTrace` keys).
- Trace payload shape sent to `/public/traces`.
- Minimum supported n8n version / Node version.

| Change | Prefix |
|---|---|
| Adding a new optional node parameter | `feat:` |
| Renaming an existing node parameter | `feat!:` (breaking) |
| Removing a parameter | `feat!:` |
| Making an optional parameter required | `feat!:` |
| Tightening a parameter type (e.g. string → enum) | `feat!:` if rejects previously-valid inputs |
| Fixing a crash on oversized payload | `fix:` |
| Reducing memory usage of gzip path | `perf:` |
| Refactoring `builders.ts` with identical outputs | `refactor:` |
| Adding tests | `test:` |
| Editing README / SKILL.md | `docs:` |
| Tweaking CI workflow | `ci:` |
| Updating `package.json` scripts (no behavior change) | `chore:` |

When unsure between `feat!:` and `feat:`: if existing users of the node could see different behavior or get an error without changing their config, it's breaking.

## Body conventions

- One line `<type>(<scope>): <imperative summary>`. Scope optional and free-form (e.g. `credentials`, `builders`, `ci`).
- For breaking changes, include a `BREAKING CHANGE:` paragraph in the commit body explaining the migration path — release-please copies it into the changelog under "⚠ BREAKING CHANGES".

Example:

```
feat!: remove n8nApiKey from credentials in favor of OAuth

BREAKING CHANGE: the `n8nApiKey` credential field is gone.
Users must reconnect their n8n instance using the new OAuth flow.
```

## After a Release PR is open

- CI must be green on the Release PR (`ci.yml`). If red, fix the underlying problem on `main` — release-please will refresh the PR automatically.
- Don't push more commits to the Release PR branch itself. Push to `main`; the bot rewrites the PR.
- Merging the Release PR triggers tag creation, the GitHub Release, and the npm publish.

## Forcing a specific version

Add a commit on `main` (any prefix) with a footer line:

```
Release-As: 1.2.0
```

The next Release PR will target exactly `1.2.0` regardless of what the commit log implies. Useful for:

- First major (`Release-As: 1.0.0`).
- Coordinated multi-package releases.
- Skipping a version that was accidentally consumed.

## Empty / docs-only release

If all you have is `chore:` / `docs:` commits but you need a publish (e.g. you re-published with provenance):

```
chore(release): trigger release

Release-As: 0.3.1
```

## After publish — n8n community verification

1. `npx @n8n/scan-community-package @mibo-ai/n8n-nodes-mibo-testing` — provenance check must pass.
2. Refresh / submit the verification form at https://internal.users.n8n.cloud/form/community-node-verification.

## Authentication

- Publishing is done by `release.yml` using the repo secret `NPM_TOKEN`. **Never** publish from a laptop — provenance requires GitHub OIDC, and the token is scoped to CI.
- Setup of the secret is a maintainer task and is documented separately (not in this repo, since the procedure is operational). Contributors don't need it to land code changes.

## Don't do

- Don't edit `package.json` `version` by hand.
- Don't edit `CHANGELOG.md` by hand.
- Don't push tags manually (`git tag` / `git push --tags`). The Release PR creates them.
- Don't publish from a laptop. Provenance requires GitHub OIDC.
- Don't remove `permissions.id-token: write` from `release.yml`.
- Don't add a Classic npm token with full-account scope when a granular package-scoped one suffices.
