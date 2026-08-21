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

- **The trace shape is defined by what the consumer parses, not by what looks tidy here.** Spans and attributes follow the canonical-span schema layered on the OpenTelemetry GenAI semantic conventions, the `gen_ai.*` attributes. Before changing what the node emits, or dropping a node from the payload, confirm against the consumer's span contract. "This node looks redundant, let's exclude it" is a trap — the consumer may rely on it, as the AI sub-node case shows. The authoritative contract is maintained in a separate private repo; never paste its paths or internals into this public repo, describe the contract generically instead.
- Adding a field is non-breaking from the node's perspective but may be ignored by older API versions — coordinate before relying on it client-side.
- Renaming or removing a field is **breaking** for the server. Use `feat!:` and a `BREAKING CHANGE:` footer; see the `release-flow` skill.
- One canonical shape: `buildCanonicalTracePayload` emits `{ spans, externalMetadata, metadata, platformId? }` — `spans` is **top-level**, not nested under `data`. The legacy `data.input` / `data.nodes` shape has been deleted; do not reintroduce it.
- **Identity is HTTP-header-only.** `externalId` is read by the API from the `x-request-id` request header — never from the body. Don't add `externalId` (or any identity field) back into the payload; clients that disagree about identity create silent duplicate / overwrite bugs.
- `span.name` is the **user-facing display label** (n8n node display name), never the technical id. Mibo `node_call` assertions match against this string verbatim.
- **Capture scope = what the data proxy can reach, but every node still becomes a span.** Node output is read via `proxy.$items(nodeName)`, which only resolves nodes on the current `main` branch. Two things follow:
  - The Mibo Testing node **itself** is excluded entirely. It's matched by `this.getNode().name`, robust to renames, and is never a span.
  - **AI sub-nodes** run *inside* their parent's call, so `$items` never exposes their output even though the n8n UI shows it. `buildSubNodeNames` detects them as sources of a non-`main` connection. The **language model and memory** are emitted as output-less `success` spans (they always run with the agent) so `node_call` can match them by `name`. **Tools** (`ai_tool`, via `buildToolNodeNames`) are **excluded** from node spans — a tool is not a node; it appears only as a real tool-call (see next bullet).
  - The missing-output warning in `_miboTrace` is for the n8n user only and is not part of the trace payload. It means the data proxy exposed no output for a `main`-graph node; this is commonly an untaken IF/Switch/Filter branch or a node that received or returned no items. The runtime does not expose a reliable cause here, so the warning must not claim one. Self and sub-nodes are kept out of it.
- **Tool calls come from the agent's `intermediateSteps`, never from wiring.** Verifying *which* tools an agent invoked is the point of agent testing, so a tool span must reflect a real invocation, not a wired connection. `extractToolCalls` reads each captured agent's `intermediateSteps` output and emits one child span per call: `gen_ai.tool.name` = `action.tool`, `gen_ai.tool.call.arguments` = the args, `parent_span_id` = the agent span. The consumer evaluates these via `expected_tool_calls`. Args follow a fallback chain for n8n issue #23501 where `toolInput` can be empty: `toolInput` → `messageLog[].tool_calls[].args` → omitted. This needs **"Return Intermediate Steps" enabled on the AI Agent node**. `agentsMissingIntermediateSteps` checks each tool-wired agent's `options.returnIntermediateSteps` param and, when off, sets `_miboTrace.toolCallsWarning` naming those agents. Key distinction: an agent that simply called no tool this run is **not** a warning — only one whose flag is off, since that's the config gap that blinds every tool assertion. Never infer "off" from an empty `intermediateSteps`. And never mark a node as a tool from its `ai_tool` wiring — that always-passes `MUST_CALL` and always-fails `MUST_NOT_CALL`.
- **Parentage nests sub-nodes under their consumer.** `buildParentMap` resolves `main` edges as source→target, so the target's parent is the source. It **inverts AI sub-node edges**: the sub-node records the node it feeds as its parent, so the model/memory spans nest under their agent via `parent_span_id`. This never overwrites the agent's own `main`-chain parent. (Tool-call spans are parented separately in `buildCanonicalTracePayload`.)
- **HTTP status is inferred only from an executed static response path.** When the Mibo node is downstream of `Respond to Webhook` and its ancestor webhook uses `responseMode: responseNode`, emit the configured numeric response code on the root span as `http.response.status_code`. Missing configuration means n8n's default 200. Dynamic expressions and response nodes outside the Mibo node's ancestor path are not observable and must not be guessed.

## Payload size

- The API hard limit is 10 MB (`MAX_PAYLOAD_SIZE_BYTES` in `constants.ts`). The node emits a warning in `_miboTrace` when the payload passes 80% of that.
- All requests go as plain JSON — **no gzip / Content-Encoding / Content-Type negotiation**. Don't reintroduce client-side compression: importing `node:zlib` (or any other Node built-in beyond what's already in use) is blocked by `@n8n/community-nodes/no-restricted-imports` and disqualifies the package from Verified status. See `agents/n8n-guidelines.md`.

## Error surface

- Errors raised by this node must be actionable: include what failed and how to fix it.
- **HTTP failures wrap in `NodeApiError`** (preserves status code + response body for the user); the node's own validation/config errors use `NodeOperationError`. See `agents/n8n-guidelines.md` → "Errors".
- Don't echo the upstream error verbatim if it leaks internals — set a clean `message`/`description`. Note `NodeApiError` may override your `message` with generic copy for recognised connection codes (ECONNREFUSED, ETIMEDOUT…); only `description` is reliably preserved, so keep the actionable guidance there. `NodeApiError` keeps the original error as context for the UI, so don't put secrets in the request that produced it (we don't — headers are per-request).
- Don't swallow errors silently. Either throw, or surface them via `_miboTrace.error` when `continueOnFail()` is on.
