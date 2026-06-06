---
name: n8n-node
description: Edit the Mibo Testing n8n node or its credentials following the project's conventions — INodeType class, declarative parameters, NodeOperationError, this.helpers.httpRequest, passthrough invariant. Use when the user mentions editing the node, adding/changing a node parameter or credential field, changing the trace payload, or any work under `nodes/MiboTesting/` or `credentials/`.
metadata:
  version: "1.0.0"
---

# n8n node & credentials

Skill for safe edits to `nodes/MiboTesting/**` and `credentials/**`.

## Layout

```
nodes/MiboTesting/
├── MiboTesting.node.ts   # INodeType class — UI declaration + execute()
├── builders.ts           # Pure functions building trace payloads
├── mibo-client.ts        # Only place that calls this.helpers.httpRequest
├── utils.ts              # Pure helpers (UUID, URL, headers)
├── constants.ts          # Magic numbers + error codes
└── types.ts              # Shared interfaces

credentials/
└── MiboTestingApi.credentials.ts  # ICredentialType
```

## Invariants

1. **Passthrough**: every input item is forwarded unchanged with `_miboTrace` appended. Never drop, reorder, or mutate input fields.
2. **n8n HTTP only**: `this.helpers.httpRequest` is the only outbound HTTP. No `axios`, no `fetch`, no `node-fetch` — community-node verification rejects them.
3. **No runtime dependencies**: anything used at runtime must be a Node built-in or provided by n8n. Add to `devDependencies` / `peerDependencies` only.
4. **Errors via `NodeOperationError`**: `throw new NodeOperationError(this.getNode(), message, { description, itemIndex })`. Never throw raw `Error`.
5. **Respect `continueOnFail()`**: when enabled, push an item with `error` instead of throwing.

## Adding a node parameter

1. Add an entry to `description.properties` with `displayName`, `name`, `type`, `default`, `description`.
2. Use `displayOptions.show` / `hide` to scope visibility.
3. Read it in `execute()` via `this.getNodeParameter('<name>', itemIndex, defaultValue)`.
4. Thread it into `builders.ts` as a pure-function argument — never read parameters inside builders.
5. Update `README.md` if user-facing.
6. Adding a parameter is non-breaking; **removing or renaming** one is `feat!:` (breaking).

## Adding a credential field

1. Append to `properties[]` with `typeOptions: { password: true }` for secrets.
2. If the field affects auth, update `authenticate.properties.headers`.
3. Keep the `test` block hitting a cheap GET so n8n's "Test" button works.
4. Adding a required field is breaking — use `feat!:`.

## Changing the trace payload

The API `POST /public/traces` is a server-side contract — treat it as a public interface. Changes here are coordinated with the server before landing. Two shapes today:

- **Standard** (`buildTracePayload`) — manual mode.
- **Optimized** (`buildOptimizedTracePayload`) — auto-detect mode; includes node `type` and `parameters`.

Compression threshold lives in `constants.ts` as `GZIP_THRESHOLD_BYTES` (5 MB). Above the threshold the request is gzipped with `Content-Encoding: gzip` and `Content-Type: application/octet-stream`.

## Before finishing

- `pnpm run check:fix`
- `pnpm test` — add coverage via the `vitest-n8n` skill.
- `pnpm run build` — confirms TS + icon copy.
- Update `README.md` if anything user-facing changed.
- Do **not** edit `package.json` `version` or `CHANGELOG.md` — release-please owns both. See `release-flow` skill.
