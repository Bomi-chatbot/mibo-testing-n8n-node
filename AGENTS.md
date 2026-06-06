# n8n-nodes-mibo-testing

Single-package n8n community node. Captures workflow traces and POSTs them to the Mibo Testing API. Passthrough design — never mutates workflow data, only appends `_miboTrace`.

Setup and commands live in [README.md](./README.md). This file is _rules_ and the entry point into the per-topic rule files in `agents/` and the procedural skills in `skills/`.

## Topic rules — load when relevant

- Git operations (branch, commit, PR, conflicts, revert) → [agents/git.md](./agents/git.md)
- Code style (Biome, TypeScript conventions, naming, comments) → [agents/style.md](./agents/style.md)
- Security & correctness invariants (passthrough, HTTP helpers, supply chain, secret hygiene, payload contract) → [agents/security.md](./agents/security.md)

Touching multiple topics? Load every relevant file. The per-topic files contain only what's specific to that topic; the rules below apply everywhere.

## Toolchain

- Node ≥ 20, pnpm ≥ 10 (enforced by `engines` and a `preinstall` guard). Never use npm or yarn.
- Lint/format: Biome — see [agents/style.md](./agents/style.md).
- Tests: Vitest — see the `vitest-n8n` skill.

## Global rules

1. **English only**: code, comments, commit messages, PR descriptions.
2. **Conventional Commits**: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`. Breaking changes use `!` or a `BREAKING CHANGE:` footer. Release-please derives the next version from these — see the `release-flow` skill.
3. **NEVER read `.env`**. Only `.env.example`.
4. **Release-please owns versioning**: never edit `package.json` `version` or `CHANGELOG.md` by hand. Never push tags manually. CI is the only publisher.
5. **Capture learnings back into the docs**: when a rule, pattern, or constraint emerges during work, fold it into the right file in the same change — agent behavior into `AGENTS.md` or `agents/*.md`, procedural how-to into a `skills/<name>/SKILL.md`. Mention the doc edit in the commit so it's intentional.

## Workflow

### Before starting non-trivial work

- Multi-file or behavior changes → propose a plan first.
- Load the relevant `agents/*.md` files for the topics you'll touch.
- Ask before: deleting files, renaming public surfaces (node parameter names, credential field names, payload keys), restructuring folders, or modifying CI.
- Reusable procedural knowledge → write a skill under `./skills/<name>/SKILL.md`, then run `pnpm skills:sync` to refresh `skills-lock.json`. Commit both in the same change.

### Every plan must include

- **Tests**: add or update Vitest coverage for the changed behavior (golden path + at least one failure case). If something can't be tested, say so and explain why.
- **Docs**: if you change a public surface, update `README.md`. If you change agent behavior, update the right `agents/*.md` or skill.
- **Validation pass**: `pnpm run check:fix` + `pnpm test` + `pnpm run build` must all pass clean before declaring done.

## Skills

Live under `./skills/`. Auto-activate when the user's request matches the skill `description`. Add or edit a skill, then run `pnpm skills:sync` to update `skills-lock.json`.

- `n8n-node` — edit `nodes/MiboTesting/**` or `credentials/**`.
- `vitest-n8n` — author or extend tests under `tests/`.
- `release-flow` — Conventional Commits, release-please, npm provenance.

## Where to look (on-demand)

- Public usage docs: [README.md](./README.md)
- Node implementation: `nodes/MiboTesting/`
- Credentials: `credentials/MiboTestingApi.credentials.ts`
- Tests: `tests/`
- Dev scripts: `scripts/`
