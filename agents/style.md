# Code style

Load when writing or editing any TypeScript file (`nodes/**`, `credentials/**`, `tests/**`, `scripts/**`).

## Formatting

Biome owns formatting and most lint. Run `pnpm run check` to verify, `pnpm run check:fix` to apply.

`pnpm run check` also runs `eslint-plugin-n8n-nodes-base` (config in `.eslintrc.js`) — it's the *only* ESLint use in the repo and exists because Biome can't express n8n's community-node rules (display names, parameter descriptions, credential URLs, etc.). When in doubt about whether a rule is Biome or the n8n plugin, check the error prefix: `lint/*` is Biome, `n8n-nodes-base/*` is the plugin.

In the node class description (`INodeTypeDescription`), use **string literals** for `inputs` / `outputs` (e.g. `['main']`), not the `NodeConnectionTypes` enum — the n8n linter enforces this to match the canonical form in n8n-nodes-base.

- Single quotes for strings.
- Trailing commas.
- Semicolons.
- 2-space indent.
- 100-char line width.
- Sorted imports (Biome reorders them — don't fight it).

Never hand-format. If Biome disagrees with you, Biome wins.

## TypeScript

- Strict mode. ES2022 target. **CommonJS modules** (n8n requirement — don't switch to ESM).
- **No escape hatches**: no `any`, no `as any`, no `@ts-ignore`, no `@ts-expect-error`. Use `as unknown as T` only if there's truly no other path, and add a one-line comment explaining why.
- Prefer existing n8n types over inventing new ones: `IDataObject`, `INodeExecutionData`, `IExecuteFunctions`, `INodeType`, `INodeProperties`, `ICredentialType`, `IAuthenticateGeneric`.
- Tuple member types via `(typeof CONST_ARRAY)[number]` instead of repeating string literals.
- Prefer `.find()` / `.findLast()` over `findIndex` + index access.
- `||` for default-on-falsy, `??` only when you specifically need to preserve `0` / `''` / `false`.
- No raw `new Date()` arithmetic — use date-fns helpers if you need any.

## Errors

- Throw `NodeOperationError(this.getNode(), message, { description, itemIndex })`. Never throw raw `Error` or string.
- `message` is one line, user-facing. `description` is the remediation hint ("Set Target Nodes or enable Auto-detect").
- Respect `this.continueOnFail()` — when enabled, push an item with `error: message` instead of throwing.
- Error code strings live in `nodes/MiboTesting/constants.ts`. Don't duplicate them inline.

## Naming

- Files: `PascalCase.node.ts` / `PascalCase.credentials.ts` for n8n classes. `camelCase.ts` for utilities and builders.
- Functions: `camelCase`, verb-first (`buildTracePayload`, `sendTrace`, `parseHeaderValue`).
- Constants: `SCREAMING_SNAKE_CASE` (`GZIP_THRESHOLD_BYTES`, `MAX_PAYLOAD_SIZE_MB`).
- Types and interfaces: `PascalCase` (`TracePayload`, `MiboSuccessResponse`). Don't prefix interfaces with `I` except for the n8n types that already use that convention.
- Test files mirror the source: `foo.ts` → `tests/foo.test.ts`.

## Function discipline

- **Pure** by default. `builders.ts` and `utils.ts` are 100% pure: no I/O, no mutation of inputs, no global reads.
- Side effects live in `MiboTesting.node.ts` (`execute()`) and `mibo-client.ts` (HTTP). Anywhere else, a side effect is a bug.
- One concern per function. If you find yourself naming it `doFooAndBar`, split it.
- If a one-liner works, don't write a method. No pre-abstraction for hypothetical needs.

## Comments

- Default to none. The code should read.
- Add one short line only when the _why_ is non-obvious: a workaround, a hidden constraint, a counterintuitive choice. Never the _what_ — names already convey that.
- No multi-paragraph docstrings. No labels on named constants. No "explaining the decision" — that belongs in the PR description.

## Historical residue

- Clean removals. No `// removed`, no `_unused` renames, no `// TODO: was using X, now Y`, no "(no longer X)" notes.
- Git history is the changelog.
- If a name no longer fits after a change, rename it in the same commit.
