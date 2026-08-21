# n8n capture, privacy, and replay direction

## Metadata

- Status: `Ready for implementation`
- Owner: `fpmirabile`
- Last updated: `2026-08-21`

## Goal

Turn recent user feedback into a clear product boundary and an implementation sequence for the n8n integration.

The integration should make n8n workflows observable enough for Mibo to evaluate them without claiming access to execution details that n8n does not expose to a community node. Sensitive content must be sanitized inside n8n before it is transmitted. Mibo owns assertions, smoke tests, trace-grounded test creation, and result history.

## Product interpretation

The feedback does not describe a different product. It describes the complete testing loop while treating the n8n node as if it were the complete product.

The useful correction is not to move assertions and replay into the node. It is to make the boundary visible and close the capture and privacy gaps that prevent Mibo from delivering the complete loop.

```text
n8n workflow
    |
    | observations available to a community node
    v
Mibo Testing node
  capture -> redact locally -> canonical spans -> POST
    |
    v
Mibo
  store -> evaluate assertions -> report pass/fail
```

### Responsibility boundary

The n8n node owns:

- collecting observations available through supported n8n node APIs;
- removing sensitive data before serialization and transmission;
- translating observations into canonical OpenTelemetry-shaped spans;
- correlating a trace with an n8n execution;
- passing workflow items through without changing them.

Mibo owns:

- trace retention and visualization;
- procedural and semantic assertion definitions;
- pass/fail evaluation;
- result, latency, token, and quality comparisons;
- alerts and regression reporting.

n8n owns the underlying execution record. Exact node inputs, attempt history, and per-node timing can only be captured if n8n exposes them through a supported interface available while the Mibo Testing node executes.

## Feedback readout

| Requested capability | Current state | Direction |
| --- | --- | --- |
| Input and output per node | The node emits node parameters and captured output. It does not emit the exact input received by each node. | Keep output capture. Investigate supported access to exact inputs. Do not reconstruct inputs from parent outputs because merges, branches, item linking, and sub-nodes make that inference unreliable. |
| System prompt, model, and parameters | The node captures generic parameters and output, and Mibo already has n8n-specific fallbacks for interpreting the trace. | Verify the existing behavior in Ticket 0. Do not add another normalization layer unless the E2E proves a concrete missing assertion or metric. |
| Tool calls | The node emits real tool-call child spans when the AI Agent exposes intermediate steps. | Keep this behavior, document the required n8n setting, and add coverage for repeated and ordered calls. |
| Retry count | Not captured. | Treat as unavailable until the feasibility spike proves a supported source. Never infer retries from duplicate outputs or tool calls. |
| Latency | The emitted spans have no start or end timestamps, so Mibo cannot derive node or workflow latency from this integration. | Investigate supported execution timing access. Do not substitute the Mibo API POST duration because it measures the collector, not the workflow. |
| Token usage | Values may be present in captured node output and Mibo already handles n8n-specific execution shapes. | Verify passive node traces in Ticket 0. Open a narrow change only if a real token assertion or metric is missing. |
| Redaction before storage | Missing. Parameters, node outputs, and tool arguments are currently copied into the outbound payload. | Highest-priority node change. Redact a cloned capture before payload sizing and before the POST. Never mutate workflow items. |
| Declared assertions and pass/fail | This is already a Mibo responsibility, not a node responsibility. Mibo supports procedural and semantic evaluation, including workflow-step, tool, schema, token, and response-time checks when the required trace signals exist. | Improve the integration story and examples. Add missing assertion primitives only in Mibo, such as a maximum call count if the existing assertion language cannot express it cleanly. |
| Pin and replay a run | Mibo already supports smoke tests, creating tests from traces, and AI-assisted authoring from a workflow definition. This is not identical to dataset replay, but it covers the immediate authoring and validation need. | Keep native n8n evaluation interoperability out of the current node release. Revisit it only when user demand proves that the existing flows are insufficient. |
| Diff the final output | Raw string equality is too unstable for non-deterministic output. | Compare declared invariants, JSON structure, required facts, tool behavior, latency, and token use. Show raw output diffs as evidence, not as the default pass/fail rule. |
| Fixtures as repository files | n8n has its own evaluation datasets and source-control behavior. Mibo has its existing test-case model. | Do not define another fixture format in this node. Native n8n evaluation interoperability is a future product opportunity, not current scope. |

## Current state

The node currently emits one span per captured workflow node with:

- n8n display name;
- n8n node type;
- success or skipped status;
- configured node parameters;
- captured node output;
- parent linkage based on the workflow graph;
- real tool calls recovered from AI Agent intermediate steps;
- workflow and request correlation metadata.

The capture is useful for workflow-step and tool-call assertions, response extraction, and passive evaluation. It is not a complete n8n execution record.

Two product statements need to be kept distinct:

- The node works inside n8n Cloud and self-hosted n8n.
- The current node sends traces to a fixed Mibo Cloud API endpoint.

The first statement does not make the complete testing system on-premise. Mibo remains a hosted product, and public copy must say that trace processing is hosted. A local Mibo endpoint is used only for development E2E testing through a temporary uncommitted patch.

## Constraints

- Preserve passthrough behavior. Redaction operates on a cloned trace representation and never on workflow items.
- Never send an unredacted payload when redaction configuration is invalid or cannot be applied.
- Do not read n8n internals, the filesystem, environment variables, or database tables from the community node.
- Use supported n8n APIs and HTTP helpers only so the package remains eligible for community-node verification.
- Keep zero runtime dependencies.
- Keep the trace consumer contract canonical and OpenTelemetry-shaped.
- Do not label inferred data as observed data.
- Do not copy credentials or credential values into traces or fixtures.
- Maintain compatibility with both n8n Cloud and self-hosted n8n unless a capability is clearly marked as deployment-specific.
- Treat prompt, response, tool argument, and customer payload content as sensitive even when it is encrypted after ingestion.
- Keep the production Mibo API endpoint fixed. The temporary local E2E route is development-only and never becomes a node parameter or credential field.
- Keep the direct n8n development runtime inside the repository's ignored `.local/` directory. Do not require a global n8n installation and do not add the full n8n application to this package's published dependency graph.
- Use the latest available n8n release for both direct and Docker development. Record the resolved version with each E2E result so the evidence remains attributable after `latest` moves.

## Chosen direction

### 1. Make the product boundary explicit

Position the node as a capture and transport integration for Mibo Testing. Show the two product modes:

- Passive evaluation: a real n8n execution produces a trace, and Mibo evaluates applicable assertions against it.
- Active authoring and validation: Mibo smoke tests, trace-grounded test creation, and AI-assisted test authoring exercise or derive tests from the configured workflow.

The node should not contain an assertion engine, fixture store, scheduler, or workflow invoker.

### 2. Redact locally before transmission

Add a capture policy that produces a sanitized copy before `buildCanonicalTracePayload` serializes values.

Automatic and manual redaction are separate n8n controls within one feature:

- **Automatic Redaction** is a boolean enabled by default. It recursively filters common secret-bearing keys, including authorization headers, cookies, passwords, API keys, access tokens, refresh tokens, and secrets.
- **Manual Redaction** is an independent boolean disabled by default. When enabled, a repeatable `fixedCollection` appears so the user can add field paths for domain-specific customer and identity data.
- When both are enabled, the node applies the union of automatic and manual rules.
- When only one is enabled, the node applies only that rule source.
- Invalid manual paths are node configuration errors, consistent with existing invalid node configuration behavior.
- A redaction summary contains counts and rule sources, never removed values.
- Redaction failure refuses transmission rather than falling back to the raw payload.

The redaction contract is deliberately small and deterministic:

- The declarative node parameters are `automaticRedaction` (boolean, default `true`), `manualRedaction` (boolean, default `false`), and `redactionFields` (a conditionally displayed `fixedCollection`). Its repeatable `fieldPaths` option contains one required string named `path` per selector.
- Replace values with the constant string `[REDACTED]` while preserving object and array shape.
- Automatic matching is case-insensitive and punctuation-insensitive, but uses an explicit normalized-key list rather than substring matching. The initial list covers `authorization`, `cookie`, `set-cookie`, `password`, `passwd`, `api-key`, `x-api-key`, `access-token`, `refresh-token`, `secret`, `client-secret`, and `private-key` variants. This avoids treating usage fields such as `totalTokens` as credentials.
- Manual selectors use dot-separated paths, with `*` for one segment. Arrays are traversed transparently, so `customers.*.email` redacts the `email` field in every customer item. A single segment such as `email` matches that key wherever it occurs; a multi-segment selector matches that path sequence wherever it occurs inside a captured value.
- Empty segments, leading or trailing dots, and unsupported wildcard syntax are invalid configuration. Duplicate selectors are de-duplicated before application.
- Apply the policy to captured node parameters and outputs, tool-call arguments recovered from those outputs, and user-provided metadata. Workflow items, correlation headers, node names, node types, workflow identifiers, and the `_miboTrace` result are outside the selector roots.
- On a successful transmission, append `_miboTrace.redaction` with `{ automaticEnabled, manualEnabled, valuesRedacted, automaticMatches, manualMatches }`. These are booleans and counts only; never include selectors, key names, paths, or removed values.

The implementation order is: capture raw observations in memory; clone the capture and metadata; redact the clones; derive tool calls from the sanitized capture; build the canonical payload; calculate its size; transmit it. No raw captured value may be serialized into the canonical payload, logged, or included in an error.

The booleans and conditional field collection follow n8n's declarative UI and `displayOptions` patterns. Prompt and output capture remain enabled; manual paths let the user filter sensitive content inside them.

Server-side ingestion redaction can be a second line of defense, but it does not replace local redaction. Once content leaves n8n, the customer's data boundary has already been crossed.

### 3. Verify existing Mibo interpretation before adding trace fields

The node already captures every workflow node generically through `n8n.node.parameters` and `n8n.node.output`, emits real tool-call spans, and Mibo contains n8n-specific fallbacks for response and trigger-input extraction. Ticket 0 verifies model, prompt, token, latency, and assertion behavior end to end.

Do not add a general GenAI enrichment ticket in advance. If the E2E proves a specific missing behavior, record the failing assertion or metric and add only the minimal producer or consumer change needed for that gap. Generic node capture remains the invariant.

### 4. Treat exact execution telemetry as a feasibility gate

Run a focused spike against the supported n8n execution interfaces for Cloud and self-hosted deployments. Determine whether the currently running node can access:

- the exact input items consumed by each node;
- per-node start and end times;
- node attempt or retry count;
- resolved parameter values rather than stored expressions;
- AI sub-node execution data.

For every signal, record support by n8n version and deployment type. A signal ships only if it can be observed without private APIs or host access. Otherwise the public limitation remains explicit and users who need complete telemetry should use native OpenTelemetry instrumentation where available.

## Options considered

### Put assertions and replay inside the n8n node

Rejected. It duplicates Mibo's core product, makes the node stateful, couples test definitions to a workflow execution, and cannot provide cross-run history or repository workflows cleanly.

### Store the complete n8n execution through internal APIs

Rejected as a default direction. Internal execution objects and database access would make the integration deployment-specific, fragile across n8n versions, and unsuitable for verified community distribution.

### Infer missing inputs, retries, or latency

Rejected. A parent output is not necessarily a child's exact input, duplicate calls are not necessarily retries, and collector latency is not workflow latency. Incorrect telemetry is worse than an explicit unknown value because assertions would produce confident false results.

### Redact only after ingestion

Rejected. It still transmits the sensitive value and may persist it in queues, request logs, error tooling, or intermediate storage before cleanup.

### Compare replay output by exact string equality

Rejected as the default. LLM output is non-deterministic. Structure, required facts, prohibited facts, tool behavior, and performance ceilings form a more stable contract. Exact equality remains valid only for explicitly deterministic fields.

### Define a Mibo-specific fixture format

Rejected. n8n already provides evaluation datasets through Data Tables or Google Sheets, evaluation execution, and source-control integration where available. A second fixture format creates synchronization and ownership problems.

## Execution

### Ticket 0: prepare local n8n and run the paired E2E

- Status: `Not started`
- Goal: leave a repository-local n8n development environment ready and use it together to observe the current node end to end before changing product behavior.
- Gate: complete before Tickets 1 and 2. Its output is technical evidence about the current capture boundary, not user-facing copy.
- Local environment:
  - install `n8n@latest` with pnpm under `.local/n8n/runtime/`, without a global package;
  - keep the persistent n8n profile under `.local/n8n/profile/`;
  - load this repository through `N8N_CUSTOM_EXTENSIONS`, matching the Docker `dist` mount;
  - update `pnpm run dev:local` to build, start the repository-local n8n binary, watch source files, rebuild, and restart n8n;
  - keep direct and Docker development on the latest n8n release and print the resolved versions before the E2E;
  - document setup, startup, missing-install recovery, and cleanup.
- Local Mibo: when requested, the user starts and configures Mibo locally, including its AI provider. Immediately before the E2E, ask for the effective local API URL and temporarily patch the node's trace and credential-test endpoints. Never commit that patch. Restore the exact hosted values afterward, rebuild, and verify that no endpoint diff remains.
- Isolation: `.local/` is already ignored. Never reuse another n8n profile or commit the local database, encryption key, credentials, logs, or execution history. The user enters secrets through the UI; they never appear in chat, shell output, fixtures, or repository files.
- Workflow: create a synthetic workflow with a trigger, ordinary transform, branch or merge, AI Agent, language model, one tool, and a controlled failure or retry case. Enable `Return Intermediate Steps`. Use synthetic customer fields and safe secret canaries.
- E2E runs:
  1. Execute the golden path and inspect n8n output, `_miboTrace`, the outbound canonical trace, and the Mibo result.
  2. Execute a branch that skips a main node.
  3. Execute one real tool call and one run without a tool call.
  4. Exercise a controlled retry or failure without an external side effect.
  5. Confirm that a source change rebuilds the node, restarts n8n, and appears in the next execution.
  6. Record whether the node can observe exact input, output, parameters, resolved prompt, model, tool calls, token usage, timing, retries, and AI sub-node data.
- Evidence: save the resolved n8n and Node versions, setup and reload notes, a redacted payload sample, and a capability matrix classifying each signal as observed, conditionally observed, or unavailable. Add a synthetic workflow fixture only after its export is proven free of credentials, local paths, secrets, and private identifiers.
- Tests: add automated coverage for local-runtime path resolution, missing-install guidance, restart after a successful build, no restart after a failed build, and process cleanup. The manual E2E does not replace the Vitest coverage required by later behavior changes.
- Docs: update the development instructions for the repository-local runtime. Public product copy is handled later in Ticket 2 after the observed capability matrix exists.
- Validation: `pnpm run check:fix`, `pnpm test`, and `pnpm run build`.
- Exit: local n8n is ready without Docker or global packages, hot reload is proven, the current workflow succeeds against local Mibo, temporary endpoints are restored, and every requested capture signal has evidence.

### Ticket 1: local redaction and capture controls

- Status: `Not started`
- Goal: ensure sensitive values are removed before the trace leaves n8n.
- Depends on: Ticket 0 observations.
- Scope: add independent `Automatic Redaction` and `Manual Redaction` booleans. Automatic is enabled by default and applies the explicit normalized-key rules above. Manual is disabled by default and reveals a repeatable n8n `fixedCollection` of selectors through `displayOptions`. When both are enabled, apply both rule sets. Follow the defined clone, redact, tool extraction, build, size, and transmit order; preserve prompt and output capture; and handle invalid selectors like existing node configuration errors.
- Tests: cover each mode independently, both modes together, both disabled, nested objects, arrays, headers, tool arguments, prompts, repeated manual paths, unchanged workflow output, and an invalid-path case that proves no raw trace is sent.
- Docs: document both controls, defaults, path examples, limitations, and the fact that encrypted-at-rest storage is not a substitute for capture-time redaction.
- Validation: `pnpm run check:fix`, `pnpm test`, and `pnpm run build`.
- Exit: captured payloads prove the selected automatic and manual fields are replaced, while each returned item's original JSON, binary data, item linking, and order remain deeply equal to the input except for the appended `_miboTrace` field.

### Ticket 2: integration positioning and in-node guidance

- Status: `Not started`
- Goal: prevent users from reading the node as an execution recorder with no pass/fail contract.
- Depends on: confirmed Ticket 0 capability wording.
- Scope:
  - add one essential n8n `notice` stating that captured workflow data is sent to hosted Mibo and that redaction controls apply before transmission;
  - add parameter `hint` text below Automatic Redaction, Manual Redaction, and Fields to Redact with short examples and no duplicated documentation;
  - add a node-level hint after execution directing users to Mibo smoke tests and trace-grounded test creation;
  - use conditional display so guidance appears only where it is actionable, including a warning before execution when both redaction modes are disabled;
  - update public README and quick start with the responsibility diagram, hosted-processing disclosure, passive assertion example, current smoke and trace-grounded authoring flows, capture matrix, and privacy controls.
- Tests: assert the declarative property and hint conditions, validate every command and example against the E2E workflow, and run the n8n linter so casing and help-text conventions remain valid.
- Docs: keep long explanations in README and quick start; in-node messages remain short and link to the detailed guide.
- Validation: `pnpm run check:fix`, `pnpm test`, and `pnpm run build` to ensure examples do not accompany a broken package state.
- Exit: a user configuring the node understands what leaves n8n, how redaction works, and what to do with a captured trace without leaving the node panel; the detailed docs explain pass/fail ownership and unavailable data.

## Priorities

1. Ticket 0: prepare local n8n, run the E2E together, and record what the current node actually observes.
2. Ticket 1: add local redaction and capture controls.
3. Ticket 2: explain the existing assertion product and hosted data path using the E2E evidence.

## Risks and mitigations

- Risk: default redaction removes values required by assertions.
  Mitigation: keep automatic and manual modes independent, show which rule source removed fields, and never reveal removed values in the summary.

- Risk: custom field rules create a false sense of complete PII detection.
  Mitigation: enable automatic secret filtering by default, test nested structures, and document that the user must identify domain-specific customer fields.

- Risk: capturing system prompts creates a new sensitive-data surface.
  Mitigation: keep prompt capture useful by default and pass it through whichever automatic and manual redaction modes the user enables.

- Risk: users interpret missing latency or token data as zero.
  Mitigation: omit unknown canonical attributes and render unavailable separately from zero in Mibo.

## Exit criteria

- Public documentation clearly distinguishes the n8n collector from the Mibo testing product.
- Public documentation clearly states that self-hosted n8n still sends traces to hosted Mibo.
- Sensitive defaults and user-selected fields are removed inside n8n before serialization and transmission.
- Existing Mibo interpretation of model, prompt, response, token, and tool data is verified end to end; any proven gap is handled as a separate narrow change.
- Exact inputs, retries, and timings are either supported with tests or explicitly reported as unavailable.
- Every implementation ticket includes golden-path and failure-path coverage and passes `pnpm run check:fix`, `pnpm test`, and `pnpm run build` before completion.

## Change log

- `2026-08-21`: Initial direction from user feedback about capture completeness, assertions, redaction, replay, repository fixtures, and on-premise expectations.
- `2026-08-21`: Added a paired local n8n E2E as a mandatory pre-implementation gate, including direct-install reload workflow, isolation, run matrix, evidence, and setup questions.
- `2026-08-21`: Decided to keep a persistent n8n runtime and profile under the repository's ignored `.local/` directory, avoid global installation, align direct and Docker n8n versions, and use a user-started local Mibo environment for the E2E.
- `2026-08-21`: Approved a temporary uncommitted endpoint patch for the local E2E, with mandatory restoration and diff verification immediately afterward.
- `2026-08-21`: Resolved the pre-implementation decisions: always use the latest n8n release, preserve generic support for every node, handle invalid redaction configuration as an existing node validation error, and keep prompt and output capture enabled by default. Removed research tasks and external Mibo decisions from Open questions.
- `2026-08-21`: Merged local setup, paired E2E, and capture-boundary discovery into Ticket 0. Clarified that its result is technical evidence; user-facing copy is Ticket 2.
- `2026-08-21`: Replaced mandatory redaction with independent automatic and manual controls, removed speculative GenAI enrichment, and replaced Mibo-owned fixture and replay work with native n8n Evaluation Trigger and Data Table interoperability.
- `2026-08-21`: Removed the configurable endpoint and on-premise ticket. Mibo remains hosted; local routing exists only as a temporary uncommitted E2E patch.
- `2026-08-21`: Deferred native n8n evaluation interoperability from this initiative. Existing smoke tests, trace-grounded test creation, and AI-assisted workflow authoring cover the immediate need; the larger integration moves to future Mibo product discovery.
- `2026-08-21`: Added concise in-node guidance using one essential notice, parameter hints, and conditional node hints for hosted processing, redaction, smoke tests, and trace-grounded test creation.
- `2026-08-21`: Marked the plan ready for implementation after defining manual selector semantics, automatic key matching, redaction scope and ordering, and precise passthrough verification.
