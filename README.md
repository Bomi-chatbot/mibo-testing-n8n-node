# n8n-nodes-mibo-testing

n8n community node for **Mibo Testing** - a platform for semantic and procedural testing of AI workflows.

[![npm](https://img.shields.io/npm/v/@mibo-ai/n8n-nodes-mibo-testing)](https://www.npmjs.com/package/@mibo-ai/n8n-nodes-mibo-testing)

- **Canonical OTEL-shaped trace**: emits one span per executed workflow node in the Mibo Custom API shape (`{spans: [...]}`), the same shape the dashboard renders. Works on **n8n Cloud and self-hosted** — no OTel SDK, no exporter, no host-level config.
- **Automatic workflow capture**: discovers every executed node via the n8n API (when credentials carry an n8n API key) or via an upstream `Get Workflow` node. Auto-utility nodes (`stickyNote`, `noOp`, `wait`, …) are excluded.
- **Parent linking**: `parent_span_id` follows the n8n connection graph so traces render as the workflow structure.
- **Request-id correlation**: sets `x-request-id` from the manual override, then from incoming webhook headers, falling back to the n8n execution id.
- **Passthrough**: input items pass through unchanged; only a `_miboTrace` summary is appended.

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
| **n8n Base URL** | No | The URL where your n8n instance is running. Defaults to `http://localhost:5678` which works for most setups since the node runs inside n8n itself. Change only for n8n Cloud or custom deployments. |

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
| **Request ID** | Override the `x-request-id` used to correlate this trace. Defaults to the incoming webhook header, falling back to the n8n execution id. |
| **Include Metadata** | Add environment, version, and custom fields to the trace metadata. |

### Advanced Options

| Option | Default | Description |
|--------|---------|-------------|
| Timeout (Seconds) | 30 | Maximum time to wait for the Mibo Testing server to respond. |

## Output

The node passes through all input data unchanged, adding a `_miboTrace` object to each item:

```json
{
  "original_field": "preserved",
  "_miboTrace": {
    "sent": true,
    "traceId": "abc-123",
    "platformId": "550e8400-...",
    "requestId": "req-456",
    "timestamp": "2026-03-08T10:30:00.000Z",
    "spansSent": 3,
    "payloadSize": "12.5 KB"
  }
}
```

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
        "n8n.node.output": "{\"body\":\"hi\"}"
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

- Node.js >= 20
- pnpm >= 10
- Docker (for the default dev flow)

### Setup

```bash
git clone https://github.com/mibo-ai/mibo-testing-n8n-node.git
cd mibo-testing-n8n-node
pnpm install
```

### Development

The default dev flow runs n8n in Docker — no global installs needed.

```bash
pnpm run dev
```

Builds the node, starts n8n in Docker, and watches for source changes. Open http://localhost:5678 — reload the workflow in n8n to pick up rebuilt code.

If you prefer running n8n directly on your machine (requires `n8n` installed globally):

```bash
pnpm run dev:local
```

---

## License

[MIT](LICENSE)
