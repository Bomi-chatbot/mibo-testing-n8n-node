---
name: n8n-node
description: Edit the Mibo Testing n8n node or its credentials following the project's conventions — INodeType class, declarative parameters, NodeOperationError, this.helpers.httpRequest, and output-mode invariants. Use when the user mentions editing the node, adding/changing a node parameter or credential field, changing the trace payload, or any work under `nodes/MiboTesting/` or `credentials/`.
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

1. **Output modes**: return one `_miboTrace` summary by default. When input passthrough is enabled, forward every input item unchanged and in order with only `_miboTrace` appended.
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

## Enumerating workflow nodes from inside a custom node

**`IExecuteFunctions` does NOT give you the list of nodes in the current workflow.** `getWorkflow()` returns only `{id, name}`; `getWorkflowDataProxy(0).$node[name]` requires you to already know the name. The whole `execute()` is invoked node-by-node — by design the runtime hides the graph from the running node.

Two sources are supported for getting the node list + connection graph; the node throws (with the docs link from `constants.DOCS_URL`) if neither is present:

1. **n8n REST API** — when credentials carry `n8nApiKey`, `utils.fetchWorkflow` hits `GET /api/v1/workflows/:id` and reads `nodes[]` + `connections{}`. Works on n8n Cloud and self-hosted.
2. **Upstream `Get Workflow` node** — when the credential is absent, the node reads `items[0].json.nodes` and `items[0].json.connections` (Get Workflow puts the workflow JSON on its output item).

Per-node capture still uses `proxy.$items(nodeName)` for each enumerated name — that's the only way to read another node's output items from inside `execute()`. Nodes that did not execute throw inside the proxy; catch the throw and mark the source as `skipped`.

Do not try to invent a third source (input introspection, environment scanning, etc.) — past attempts shipped subtly broken captures.

## Changing the trace payload

The API `POST /public/traces` is a server-side contract — treat it as a public interface. Changes here are coordinated with the server before landing.

- **One canonical builder**: `buildCanonicalTracePayload` returns `{ spans, externalMetadata, metadata, platformId? }`. `spans` is **top-level**, not nested. Each span has `{ span_id, parent_span_id, name, attributes }`.
- `span.name` is the n8n display name (what the user sees in the editor). Never substitute the technical id — Mibo `node_call` assertions match against this string.
- `parent_span_id` is wired via `utils.buildParentMap` (child → first source per output) and `builders.resolveCapturedAncestor` walks past filtered/excluded nodes so the visible tree stays connected.
- Identity is HTTP-header-only: pass `requestId` to `sendTrace`, which sets `x-request-id`. The API reads `externalId` from that header, never from the body — do not add an `externalId` field back.

All trace POSTs go as plain JSON. There is **no client-side compression** — `node:zlib` and other Node built-ins are blocked by the Verified Community Node scanner. The hard payload limit is `MAX_PAYLOAD_SIZE_BYTES` (10 MB) in `constants.ts`; the node adds a `payload_size` entry to `_miboTrace.recommendations` past 80%.

## Before finishing

- `pnpm run check:fix`
- `pnpm test` — add coverage via the `vitest-n8n` skill.
- `pnpm run build` — confirms TS + icon copy.
- Update `README.md` if anything user-facing changed.
- Do **not** edit `package.json` `version` or `CHANGELOG.md` — release-please owns both. See `release-flow` skill.
