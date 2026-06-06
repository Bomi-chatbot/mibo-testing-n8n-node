# Mibo Testing Node Documentation

The Mibo Testing node captures every executed node in your n8n workflow and POSTs them as a canonical OTEL-shaped trace to the Mibo Testing API. Input items pass through unchanged; only a `_miboTrace` summary is appended.

## Quick start

1. Create credentials of type **Mibo Testing API** (see [Credentials](#credentials))
2. Add the **Mibo Testing** node at the point in your workflow where you want the trace sent (usually at the end)
3. (Optional) Fill **Agent ID**, **Request ID**, **Include Metadata**

That's it. The node always auto-captures every executed workflow node — no filters, no toggles, no manual node lists to maintain.

```
[Trigger] → [Your Nodes] → [Mibo Testing]
```

If the credentials don't carry an **n8n API Key**, add an upstream `Get Workflow` node as a fallback source:

```
[Trigger] → [Your Nodes] → [Get Workflow] → [Mibo Testing]
```

If neither source is available the node throws with a link to <https://docs.mibo-ai.com/n8n-node/setup/>.

---

## Credentials

Credential type: **Mibo Testing API**.

| Field | Required | Description |
|-------|----------|-------------|
| **API Key** | Yes | Your Mibo Testing API key. Find it in the Mibo dashboard under **Settings → API Keys**. |
| **n8n API Key** | No | n8n API key with the `workflow:read` scope. Enables automatic node discovery via the n8n REST API — works on both n8n Cloud and self-hosted. Create one in n8n: **Settings → API → Create an API Key**. |
| **n8n API URL** | No | URL of your n8n instance's REST API. Defaults to `http://localhost:5678/api/v1`, which works for most setups since the node runs inside n8n itself. Change only for n8n Cloud or custom deployments. |

API keys are stored as password fields and never logged.

---

## Node parameters

| Parameter | Description |
|-----------|-------------|
| **Agent ID** | UUID of your agent in Mibo Testing. Leave empty if the API key is already scoped to a single agent. |
| **Request ID** | Override the `x-request-ID` used to correlate this trace. Defaults to the incoming webhook header, falling back to the n8n execution ID. |
| **Include Metadata** | When on, exposes a Metadata collection with **Environment**, **Version**, and **Additional Fields** (JSON). |

### Advanced options

| Option | Default | Description |
|--------|---------|-------------|
| **Timeout (Seconds)** | 30 | Maximum time to wait for the Mibo Testing server to respond. |

---

## Trace payload

The node POSTs to `POST /public/traces` in the canonical Custom API shape:

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
        "n8n.node.parameters": "{\"text\":\"=...\"}",
        "n8n.node.output": "{\"output\":\"reply\"}"
      }
    }
  ],
  "externalMetadata": { "workflowId": "abc123" },
  "metadata": { "workflowId": "abc123", "workflowName": "My Workflow", "timestamp": "..." },
  "platformId": "<optional>"
}
```

### Root-level fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `spans` | Yes | array | One span per executed workflow node (after auto-exclusion) |
| `externalMetadata` | Yes | object | `{ workflowId }` — used by Mibo to correlate the trace with the source workflow |
| `metadata` | Yes | object | Workflow metadata (workflow ID, name, timestamp) plus any optional fields |
| `platformId` | No | string | Agent UUID. Omitted if not provided; resolved via API-key restrictions in that case |

### Span fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `span_id` | Yes | string | UUID — stable within a single trace |
| `parent_span_id` | Yes | string\|null | Span ID of the nearest captured ancestor in the n8n connection graph, or null for roots |
| `name` | Yes | string | The n8n **display name** of the node — same string you see in the editor; this is what Mibo `node_call` assertions match against |
| `attributes` | Yes | object | OTEL-style attribute map (see below) |

### Span attributes

| Attribute | Required | Description |
|-----------|----------|-------------|
| `n8n.node.type` | Yes | Full n8n node type identifier, e.g. `@n8n/n8n-nodes-langchain.agent` |
| `n8n.node.status` | Yes | `"success"` or `"skipped"` |
| `n8n.node.parameters` | No | JSON-stringified node parameters (omitted when empty) |
| `n8n.node.output` | No | JSON-stringified output. Single-item outputs are unwrapped; multi-item outputs are sent as an array. Omitted for skipped nodes. |

### Identity vs. body

The `externalId` Mibo uses for create-or-replace correlation is sent via the `x-request-id` HTTP header, **not** in the payload body. See [Request ID correlation](#request-id-correlation).

---

## Auto-excluded node types

These node types are always filtered out of the spans array:

| Node type | Reason |
|-----------|--------|
| `n8n-nodes-base.stickyNote` | UI-only |
| `n8n-nodes-base.n8n` | The `Get Workflow` helper itself |
| `n8n-nodes-base.respondToWebhook` | No execution data of interest |
| `n8n-nodes-base.noOp` | Produces no meaningful data |
| `n8n-nodes-base.wait` | No output |
| `n8n-nodes-base.start` | Legacy start node |
| `n8n-nodes-base.manualTrigger` | No execution data |
| `CUSTOM.miboTesting` | The Mibo Testing node itself (prevents loops) |

---

## Request ID correlation

The node sets the `x-request-id` header on the POST so Mibo can match this trace to the test runner that triggered the execution.

Resolution order:

1. The **Request ID** parameter, if set
2. `x-request-id` extracted from input data (recursive search through webhook headers and item JSON)
3. The n8n execution ID, as final fallback

To set it manually from a webhook:

```text
={{ $("Webhook").item.json.headers["x-request-ID"] }}
```

API matching: `POST /public/traces` returns `201` for a brand-new trace or `200` when an existing trace was matched by the header and replaced.

---

## Output

The node passes every input item through unchanged and appends a `_miboTrace` summary:

```json
{
  "original_field": "preserved",
  "_miboTrace": {
    "sent": true,
    "traceId": "abc-123",
    "platformId": "550e8400-...",
    "requestId": "req-456",
    "timestamp": "2026-06-06T10:30:00.000Z",
    "spansSent": 3,
    "payloadSize": "12.5 KB"
  }
}
```

If the trace POST failed but the workflow shouldn't error, `_miboTrace.sent` is `false` and `_miboTrace.error` holds the message.

---

## Payload size

The maximum payload size accepted by the API is 10 MB. The node emits a `_miboTrace` warning when the payload exceeds 80% of that limit. Large outputs (file blobs, base64 images) are the usual cause — strip them upstream if you don't need them in the trace.

---

## API reference

### Endpoint

`POST /public/traces`

Authentication: `x-api-key` header.

### Request headers

| Header | Description |
|--------|-------------|
| `x-api-key` | Your Mibo Testing API key |
| `Content-Type` | `application/json` |
| `x-request-id` | Optional — correlates this trace with active testing |

### Response codes

| Code | Meaning |
|------|---------|
| `201` | Trace created |
| `200` | Existing trace updated (matched by `x-request-id`) |
| `401` | Missing or invalid API key |
| `403` | API key not authorized for the resolved agent |
| `404` | Agent not found (see [Agent resolution](#agent-resolution)) |
| `413` | Payload too large (exceeds 10 MB) |
| `500` | Server error |

### Agent resolution

The API resolves the target agent in this order:

1. `platformId` from the request body, if present
2. API-key restrictions — if the key is restricted to a single agent, that agent is used automatically

If neither resolves, the API returns `404 PLATFORM_NOT_FOUND`. When the key is restricted but `platformId` doesn't match an allowed agent, you'll get the same error.

### Error codes

| Code | Description |
|------|-------------|
| `MISSING_API_KEY` | The `x-api-key` header is missing |
| `INVALID_API_KEY` | The API key doesn't exist or has been revoked |
| `PLATFORM_NOT_FOUND` | Agent can't be resolved — wrong `platformId` or API-key restrictions don't match |
| `VALIDATION_ERROR` | Request body failed validation |
| `PAYLOAD_TOO_LARGE` | Trace exceeds the 10 MB limit |

---

## How the Mibo runner uses the trace

### Matching assertions to spans

Mibo's `node_call` assertions match against `span.name` — the **n8n display name** of the node. Rename a node in the editor and existing assertions referencing the old name will stop matching.

### AI node auto-detection

The runner identifies AI spans by substring match on `n8n.node.type`: `langchain`, `openai`, `anthropic`, `azure`, `gemini`, `ollama`. This works out of the box because every span carries its full n8n type.

### Per-assertion targeting

For fine-grained control, an assertion can specify `target_node` (matched against `span.name`) and `output_key` (a path inside the parsed `n8n.node.output`):

```json
{
  "criteria": "Must provide accurate analysis",
  "target_node": "Message a model",
  "output_key": "content.parts.0.text"
}
```

This overrides the runner's auto-detection.

---

## Best practices

1. **Add the n8n API key to credentials** — auto-discovery via the REST API is more robust than wiring a Get Workflow node
2. **Set a Request ID** for active-testing scenarios so the runner can correlate
3. **Keep node display names stable** — they're the join key for Mibo assertions
4. **Strip large binary fields upstream** if you don't need them in traces (file uploads, base64 images)
5. **Use Include Metadata + Environment** to separate prod / staging traces in the Mibo dashboard
