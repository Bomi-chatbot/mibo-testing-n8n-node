# Security & correctness invariants

Load when touching anything that handles workflow data, credentials, outbound HTTP, dependencies, logs, or the published payload.

## Passthrough invariant

The node observes a workflow; it does **not** participate in it.

- Every input item flows to output unchanged. Never drop, reorder, or mutate input fields.
- The only addition to each output item is the `_miboTrace` metadata key.
- If the trace POST fails, the input still passes through. The user's workflow must not break because Mibo is unreachable. `continueOnFail()` controls whether the error becomes a visible item or is silently logged into `_miboTrace.error`.

## n8n HTTP helpers only

- Outbound HTTP **must** go through `this.helpers.httpRequest`. No `axios`, no `node-fetch`, no `fetch`, no `http.request`.
- Reason: n8n's verification pipeline rejects nodes that bring their own HTTP stack (proxy/SSL/retry policy bypass, supply-chain risk).
- Timeouts: declare `timeout` on every `httpRequest` call. A call without an explicit timeout is a bug.
- Headers carrying credentials are set per-request, never logged.

## Supply chain

- **Zero runtime dependencies**. Anything used at runtime must be a Node built-in (`node:zlib`, `node:crypto`, ...) or provided by the n8n runtime.
- Production deps go in `peerDependencies` (`n8n-workflow`) — n8n provides them.
- Build/test tooling goes in `devDependencies`.
- Before adding **any** dep, check whether existing ones already cover the need. The bar for a new dep is high in a community node — it ships compiled into `dist/` for thousands of users.
- Don't bypass n8n's verification scanner. If `@n8n/scan-community-package` flags something, fix the cause, not the symptom.

## Secret & PII hygiene

- API keys, tokens, JWTs, full credential objects, raw user payloads, full webhook bodies → **never** in logs, error messages, thrown error text, or `_miboTrace`.
- When something fails, log identifiers (request ID, trace ID, platform ID) and sizes. Look up the record elsewhere.
- Credentials marked `typeOptions: { password: true }` are obfuscated in the n8n UI; respect that downstream — don't `JSON.stringify(credentials)` anywhere.
- `.env` files are off-limits. Only `.env.example` is readable; only `.env.example` is committed.

## Trace payload as a public surface

`POST /public/traces` is a server-side contract.

- Adding a field is non-breaking from the node's perspective but may be ignored by older API versions — coordinate before relying on it client-side.
- Renaming or removing a field is **breaking** for the server. Use `feat!:` and a `BREAKING CHANGE:` footer; see the `release-flow` skill.
- One canonical shape: `buildCanonicalTracePayload` emits `{ spans, externalMetadata, metadata, platformId? }` — `spans` is **top-level**, not nested under `data`. The legacy `data.input` / `data.nodes` shape has been deleted; do not reintroduce it.
- **Identity is HTTP-header-only.** `externalId` is read by the API from the `x-request-id` request header — never from the body. Don't add `externalId` (or any identity field) back into the payload; clients that disagree about identity create silent duplicate / overwrite bugs.
- `span.name` is the **user-facing display label** (n8n node display name), never the technical id. Mibo `node_call` assertions match against this string verbatim.

## Payload size

- The API hard limit is 10 MB (`MAX_PAYLOAD_SIZE_BYTES` in `constants.ts`). The node emits a warning in `_miboTrace` when the payload passes 80% of that.
- All requests go as plain JSON — **no gzip / Content-Encoding / Content-Type negotiation**. Don't reintroduce client-side compression: importing `node:zlib` (or any other Node built-in beyond what's already in use) is blocked by `@n8n/community-nodes/no-restricted-imports` and disqualifies the package from Verified status. See `agents/n8n-guidelines.md`.

## Error surface

- Errors raised by this node must be actionable: include what failed and how to fix it.
- Don't echo the upstream error verbatim if it leaks internals — wrap with a clean `NodeOperationError`.
- Don't swallow errors silently. Either throw, or surface them via `_miboTrace.error` when `continueOnFail()` is on.
