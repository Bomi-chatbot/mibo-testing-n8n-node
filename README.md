# n8n-nodes-mibo-testing

n8n community node for **Mibo Testing** - a platform for semantic and procedural testing of AI workflows.

[![npm](https://img.shields.io/npm/v/@mibo-ai/n8n-nodes-mibo-testing)](https://www.npmjs.com/package/@mibo-ai/n8n-nodes-mibo-testing)

- **Canonical OTEL-shaped trace**: emits one span per executed workflow node in the Mibo Custom API shape (`{spans: [...]}`), the same shape the dashboard renders. Works on **n8n Cloud and self-hosted** — no OTel SDK, no exporter, no host-level config.
- **Automatic workflow capture**: discovers every executed node via the n8n API (when credentials carry an n8n API key) or via an upstream `Get Workflow` node. Auto-utility nodes (`stickyNote`, `noOp`, `wait`, …) are excluded.
- **Parent linking**: `parent_span_id` follows the n8n connection graph so traces render as the workflow structure.
- **HTTP status capture**: when the Mibo node runs downstream of a single `Respond to Webhook` path, its static response code is emitted on the root span. The n8n default is captured as 200; dynamic expressions are omitted because their runtime value is not exposed to downstream nodes.
- **Request-id correlation**: automatically finds `x-request-id` in incoming webhook headers, falling back to the n8n execution ID. An optional manual override remains available.
- **Focused output**: returns one structured `_miboTrace` summary by default. Input passthrough is available as an option.

> New here? Start with the [Quick Start Guide](./docs/quick-start.md) — 30-second setup plus troubleshooting for the most common errors (payload too large, wrong node names, API key issues).

## Product boundary

The n8n node is a capture and transport integration. It collects observations available through supported n8n APIs, protects configured sensitive values inside n8n, translates them into canonical OTLP-shaped spans, and sends them to **hosted Mibo Testing**. Self-hosted n8n still sends trace data to the hosted Mibo service.

Mibo owns trace storage, assertions, pass/fail evaluation, smoke tests, trace-grounded test creation, and result history. The node does not invoke workflows, store fixtures, schedule tests, or implement an assertion engine.

```text
n8n workflow → Mibo Testing node → hosted Mibo
               capture + protect    store + evaluate
```

### Capture capability matrix

| Signal | Availability | Notes |
|--------|--------------|-------|
| Node display name, type, configured parameters, and captured output | Observed | Parameters and output are represented in each canonical span. |
| Prompt, response, model, and token usage | Conditionally observed | Available when the executed n8n node exposes them in its parameters or output. |
| Tool calls and arguments | Conditionally observed | AI Agent must have **Return Intermediate Steps** enabled. |
| AI model and memory sub-nodes | Conditionally observed | Emitted as output-less spans when their parent exposes the connection. |
| Exact input consumed by every node | Unavailable | A community node cannot reliably reconstruct inputs across branches, merges, item linking, and sub-nodes. |
| Per-node timing and workflow latency | Unavailable | Collector POST time is not workflow execution time. |
| Retry or attempt count | Unavailable | Duplicate outputs and tool calls are not reliable retry evidence. |

Unavailable signals are omitted or reported as unavailable; they are never inferred as zero or reconstructed from neighboring outputs.

## Installation

### Community Nodes (Recommended)

1. Go to **Settings > Community Nodes** in your n8n instance
2. Search for `@mibo-ai/n8n-nodes-mibo-testing`
3. Click **Install**

### Manual Installation

```bash
npm install @mibo-ai/n8n-nodes-mibo-testing
```

Then restart your n8n instance.

## Configuration

### Credentials

Create a new credential of type **Mibo Testing API** with the following fields:

| Field | Required | Description |
|-------|----------|-------------|
| **API Key** | Yes | Your Mibo Testing API key. Find it in your Mibo Testing dashboard under **Settings > API Keys**. |
| **n8n API Key** | No | Your n8n instance API key. Enables automatic workflow node detection without needing a separate "Get Workflow" node. To create one: open n8n, go to **Settings > API**, and click **Create an API Key**. The key only needs the **workflow:read** scope. |
| **n8n API URL** | No | The URL of your n8n instance's REST API. Defaults to `http://localhost:5678/api/v1`, which works for most setups since the node runs inside n8n itself. Change only for n8n Cloud or custom deployments. |

### Node Setup

Add the **Mibo Testing** node at the end of your workflow (or wherever you want to capture the trace). It always captures every executed node in the workflow — there are no filters or manual node lists to maintain.

The node needs to know which nodes the workflow contains. It supports two sources, tried in this order:

1. **n8n REST API (recommended)** — set **n8n API Key** in the credentials. Works out of the box on both n8n Cloud and self-hosted.
2. **Upstream `Get Workflow` node** — connect an n8n `Get Workflow` node before the Mibo Testing node; its `nodes` and `connections` output are used as the fallback source.

```
With n8n API credentials:
[Trigger] --> [Your Nodes] --> [Mibo Testing]

Without n8n API credentials:
[Trigger] --> [Your Nodes] --> [Get Workflow] --> [Mibo Testing]
```

If neither source is available, the node errors with a link to <https://docs.mibo-ai.com/n8n-node/setup/>.

### Node Parameters

| Parameter | Description |
|-----------|-------------|
| **Agent ID** | Your agent UUID in Mibo Testing. Leave empty if the API key is already scoped to a single agent. |
| **Request ID Override** | Optional override for the `x-request-id` used to correlate this trace. Leave empty to detect it from incoming webhook headers, falling back to the n8n execution ID. |
| **Include Metadata** | Add environment, version, and custom fields to the trace metadata. |
| **Automatic Sensitive Data Protection** | Enabled by default. Replaces common secret-bearing keys and safe name patterns such as `databasePassword`, `myApiKey`, `aiKey`, `openAiKey`, authorization headers, cookies, access tokens, refresh tokens, and private keys with `[REDACTED]` before transmission. Token-usage metrics such as `promptTokens` and `totalTokens` are preserved. |
| **Custom Sensitive Data Protection** | Disabled by default. Enables custom field paths for customer or identity data. |
| **Fields to Protect** | Repeatable dot-separated paths shown when Custom Sensitive Data Protection is enabled, such as `customer.email` or `customers.*.email`. Arrays are traversed transparently. |

Sensitive data protection is applied locally to cloned node parameters, outputs, tool arguments, and user-provided metadata before the canonical trace is serialized or sent. Node names, workflow identifiers, correlation headers, and the returned `_miboTrace` summary are not protected or mutated. When input passthrough is enabled, original input items are returned unchanged and are not covered by output redaction. Automatic and custom rules are independent; enabling both applies their union. Invalid paths stop the transmission instead of falling back to an unprotected payload.

Custom paths use a deep search within each captured value; they are not a pick for one field. A path such as `customer.email` protects every occurrence of that sequence at any depth, including `metadata.customer.email`. To protect only a specific branch, include it in the path, such as `metadata.customer.email`. A single field name such as `email` matches every `email` field at any depth, while `customers.*.email` matches `email` inside every element of `customers`.

Capture-time protection is still required even when Mibo or n8n storage uses encryption at rest: encryption after transmission does not prevent sensitive values from passing through request logs, queues, or error tooling before storage.

### What to do with a trace

For passive evaluation, run the real n8n workflow and let Mibo evaluate assertions against the resulting trace. For active authoring and validation, use Mibo smoke tests or trace-grounded test creation to exercise or derive tests from the configured workflow. Assertions, pass/fail results, and history remain in Mibo rather than in the n8n node.

### Advanced Options

| Option | Default | Description |
|--------|---------|-------------|
| Include Input Data in Output | Off | Include every original input item alongside the trace summary. |
| Timeout (Seconds) | 30 | Maximum time to wait for the Mibo Testing server to respond. |

## Output

The node returns one structured summary by default, without repeating the input data:

```json
{
  "_miboTrace": {
    "sent": true,
    "traceId": "abc-123",
    "platformId": "550e8400-...",
    "requestId": "req-456",
    "requestIdSource": "x-request-id",
    "timestamp": "2026-03-08T10:30:00.000Z",
    "trace": {
      "spansSent": 3,
      "toolCallsSent": 0,
      "payloadSize": "12.5 KB",
      "nodes": [
        { "name": "Webhook", "status": "success", "itemsCaptured": 1 },
        { "name": "AI Agent", "status": "success", "itemsCaptured": 1 }
      ]
    },
    "redaction": {
      "automaticEnabled": true,
      "manualEnabled": false,
      "valuesRedacted": 1
    },
    "recommendations": [],
    "miboUrl": "https://app.mibo-ai.com"
  }
}
```

Turn on **Include Input Data in Output** to append the same `_miboTrace` summary to every original input item.

## Trace shape

The node POSTs to `POST /public/traces` using the Mibo **Custom API** shape:

```json
{
  "spans": [
    {
      "span_id": "<uuid>",
      "parent_span_id": null,
      "name": "Webhook",
      "attributes": {
        "n8n.node.type": "n8n-nodes-base.webhook",
        "n8n.node.status": "success",
        "n8n.node.output": "{\"body\":\"hi\"}",
        "http.response.status_code": 200
      }
    },
    {
      "span_id": "<uuid>",
      "parent_span_id": "<webhook-span-id>",
      "name": "AI Agent",
      "attributes": {
        "n8n.node.type": "@n8n/n8n-nodes-langchain.agent",
        "n8n.node.status": "success",
        "n8n.node.output": "{\"output\":\"reply\"}"
      }
    }
  ],
  "externalMetadata": { "workflowId": "..." },
  "metadata": { "workflowId": "...", "workflowName": "...", "timestamp": "..." },
  "platformId": "<optional>"
}
```

`span.name` is the **n8n display name** of the node — the same string you see in the n8n editor and the same string Mibo `node_call` assertions match against. Identity (the `externalId` Mibo uses for create-or-replace correlation) is sent via the `x-request-id` HTTP header, not in the body. See <https://docs.mibo-ai.com/n8n-node/setup/> for the full reference.

---

## Development

### Prerequisites

- Node.js 22.22.0 (managed by mise for local n8n development)
- pnpm >= 10
- Docker (for the default dev flow)

### Setup

```bash
git clone https://github.com/mibo-ai/mibo-testing-n8n-node.git
cd mibo-testing-n8n-node
pnpm install
```

This repository pins Node.js 22.22.0 and pnpm 10.28.2 in `mise.toml`, matching the
local n8n runtime. Install mise, then run `mise install` and open a new shell (or activate
mise in the current shell) before running the commands below.

### Development

The default dev flow runs n8n in Docker — no global installs needed.

```bash
pnpm run dev
```

Builds the node, starts n8n in Docker, and watches for source changes. Open http://localhost:5678 — reload the workflow in n8n to pick up rebuilt code.

For a direct local runtime without a global n8n installation, install the latest n8n release
inside the ignored `.local/n8n/runtime/` directory:

```bash
pnpm run dev:local:install
pnpm run dev:local
```

The local profile is isolated in `.local/n8n/profile/` and contains only local n8n state.
The development script prints the resolved n8n version, loads this package through
`N8N_CUSTOM_EXTENSIONS`, rebuilds the node on source changes, and restarts n8n after
successful builds. Failed builds leave the current n8n process running. If installation is
missing, rerun `pnpm run dev:local:install`; the installer configures the required local
native build automatically. Stop the process with `Ctrl+C`.

---

## License

[MIT](LICENSE)
