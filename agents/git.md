# `git`

Rules for agents using git in this repo. Load before running any git command or proposing a git step in a plan.

## When git is allowed

- Only when the user includes a git step in the approved plan, or explicitly asks for it.
- Implicit permission from a past turn doesn't carry over — each plan re-authorizes git.

## Forbidden — no exceptions

- **`git push --force` / `--force-with-lease`** — never. If a force-push seems necessary, stop and ask the user.
- **Pushing to `main`** — never. `main` only receives merges via PR (release-please depends on this to track releases).
- **Manual tags or releases** — never `git tag vX.Y.Z` / `git push --tags`. Tags and GitHub Releases are owned by release-please. See the `release-flow` skill.
- **Skipping hooks** (`--no-verify`, `--no-gpg-sign`) — never, unless the user explicitly asks for it for a specific commit.
- **Destructive resets on shared branches** (`reset --hard` to drop pushed commits, `branch -D` on a branch with unmerged work) without explicit user approval.

## Branching

- One branch per logical task. Don't pile unrelated changes onto an existing branch.
- Name: kebab-case, tied to the task and matching the commit type — `feat/<short-desc>`, `fix/<short-desc>`, `chore/<short-desc>`, `docs/<short-desc>`.
- Branch off the latest `main`: `git fetch origin && git switch -c <name> origin/main`.

## Committing

Commits must follow **Conventional Commits** — release-please derives the next version from them. The `release-flow` skill has the full decision guide; the rules below are git-mechanical.

- One line, imperative, English: `<type>(<scope>): <what>`. Scope is optional.
- Keep it short. Detail goes in the PR body, not the commit message — except for breaking changes, which need a `BREAKING CHANGE:` footer for release-please to pick them up.
- One concern per commit when practical. Don't bundle unrelated changes.
- Stage specific files (`git add <path>`), not `git add -A` / `git add .` — avoids picking up `.env`, secrets, build artifacts.
- Never commit `.env` or anything in `.gitignore`. If something sensitive landed staged, unstage it before committing.
- Don't amend a commit that has already been pushed. New issue → new commit.
- **Never** edit `package.json` `version` or `CHANGELOG.md` in a normal commit — those belong exclusively to release-please's Release PR.

## Bringing `main` into a branch

- Use a plain merge: `git fetch origin && git merge origin/main`. Resolve conflicts, commit.
- Don't rebase a branch onto `main` after it's been pushed.
- Rebase before push is fine on a strictly local branch. When in doubt, merge.

## Merge conflicts

- Read both sides before resolving. Don't blindly take "theirs" or "ours" to make the conflict disappear.
- If the conflict is in code you didn't touch, default to keeping `main`'s version and reapply your change on top.
- Generated files (`pnpm-lock.yaml`, `skills-lock.json`, `dist/**`): take `main`'s version, then re-run the generator (`pnpm install`, `pnpm skills:sync`, `pnpm run build`) and commit the regenerated output.
- `CHANGELOG.md` / `package.json` `version` conflicts on a Release PR: don't resolve by hand. Close the Release PR, push your branch first, then re-open with `release-please-action`.
- If unsure who owns the conflicting code or the resolution is non-obvious, stop and ask the user.

## Merging PRs

- Use **squash merge** by default. Keeps `main` linear and one commit per task — which is also what release-please expects.
- The squash commit's message **must** stay Conventional Commits. When squashing, edit GitHub's auto-generated message to the chosen `<type>(<scope>): <what>` line. If the body has a breaking-change footer, preserve it.
- Reserve regular merge / rebase-merge for cases where the individual commits are themselves Conventional Commits and add value (rare). Ask the user before choosing this.

## Self-review before opening a PR

- Read the full diff yourself before pushing. Tests passing is not enough — eyeball every change.
- Remove leftover exploration: `console.log`, dead code, commented-out blocks, debug `if` branches, TODOs without a tracked issue.
- Re-run `pnpm run check:fix`, `pnpm test`, and `pnpm run build` after the last edit, not just at the start.
- For each change in the diff, ask: "is this needed for the task, or did it sneak in?". If it snuck in, either keep with a clear rationale or revert.
- Confirm the commit message you'll use for the squash is correctly typed (`feat:` vs `fix:` vs `feat!:`).

## Revert / rollback

- To undo something already merged into `main`: `git revert <sha>` on a new branch, then open a PR (`revert: <original subject>`). Release-please treats reverts as patch bumps by default.
- Never `git reset --hard` to rewrite `main`. Never force-push to undo.
- Local-only mistakes (commits not pushed yet): `git reset --soft HEAD~N` to keep changes staged, or `git restore` for files. Don't reach for `--hard` unless the work is recoverable elsewhere.

## Pull requests

- Open a PR as soon as the branch has something reviewable.
- Title: same Conventional Commits format as the eventual squash commit — `<type>(<scope>): <what>`. No trailing period.
- Body must include, in this order:
  - **Summary** — bullet list of the actual changes in the PR. One line per bullet; group related edits.
  - **Verifications** — exact commands run and their result: `pnpm check ✅`, `pnpm test ✅`, `pnpm run build ✅`, manual n8n test ✅. Use `pnpm check`, not `pnpm check:fix` (the latter mutates files and doesn't prove a clean state). If something was skipped, say so and why.
  - **Breaking changes** (only if applicable) — what users must do to migrate. This text feeds the CHANGELOG via the `BREAKING CHANGE:` footer in the commit.
- Link related issues.
- Don't merge your own PRs unless the user told you to.

### PR body template

```
## Summary
- <change 1>
- <change 2>

## Verifications
- pnpm check ✅
- pnpm test ✅
- pnpm run build ✅
- <manual / n8n smoke test> ✅

## Breaking changes  (omit if none)
- <user-facing change> — migration: <steps>
```
