# Mibo Testing Node Documentation

This document explains how the MiboTesting n8n node works and the different modes for capturing workflow execution data.

## Overview

The MiboTesting node captures execution data from your n8n workflow and sends it to the Mibo Testing API for analysis, testing, and quality monitoring. It supports two modes of operation:

1. **Get Workflow Mode** (Recommended) - Automatically discovers and captures nodes
2. **Manual Node Names Mode** - Manually specify which nodes to capture

---

## Mode Comparison

| Feature | Get Workflow Mode | Manual Node Names Mode |
|---------|-------------------|----------------------|
| Node Discovery | Automatic | Manual |
| Node Types | Included | Not included |
| Payload Size | Optimized (smaller) | Larger |
| Setup Effort | Lower | Higher |
| Filtering Options | Preset filters + Custom | Only custom |
| Workflow Definition | Excluded | Included in input |

---

## Auto-detect Mode (Recommended)

### How It Works

1. MiboTesting fetches the workflow definition from the n8n API (if n8n API credentials are configured), or reads it from an upstream "Get Workflow" node as fallback
2. Based on your filter settings, it identifies which nodes to capture
3. It captures execution data from those nodes with their n8n types
4. Sends an **optimized trace** to the API

### Setup

**Option A: n8n API credentials (recommended, no extra node needed)**

1. In your Mibo Testing credential, fill in the **n8n API Key** and **n8n Base URL** fields
2. Add the MiboTesting node to your workflow
3. Enable "Auto-detect Workflow Nodes" toggle
4. Select a node filter preset

```
[Trigger] → [Your Nodes] → [MiboTesting]
```

**Option B: Fallback with "Get Workflow" node**

If you don't configure n8n API credentials, connect a "Get Workflow" node before MiboTesting:

```
[Get Workflow] → [MiboTesting]
```

1. Add a "Get Workflow" node and configure it to get the current workflow
2. Connect it to the MiboTesting node
3. Enable "Auto-detect Workflow Nodes" toggle
4. Select a node filter preset

### Node Filter Presets

| Preset | Description |
|--------|-------------|
| **All Nodes** | Captures data from every node (excluding auto-excluded types below) |
| **AI Nodes Only** | Nodes with "AI" in their name |
| **HTTP/Webhook Only** | HTTP Request and Webhook nodes only |
| **Exclude Utility Nodes** | Excludes Set, If, Merge, Switch |
| **Custom** | Specify exact node names |

### Automatically Excluded Nodes

These node types are always filtered out regardless of the selected preset:

| Node Type | Reason |
|-----------|--------|
| `n8n-nodes-base.stickyNote` | UI-only, no execution data |
| `CUSTOM.miboTesting` | The MiboTesting node itself (prevents infinite loops) |
| `n8n-nodes-base.n8n` | The "Get Workflow" node (internal helper, no useful output) |
| `n8n-nodes-base.respondToWebhook` | Response node, no execution data to capture |
| `n8n-nodes-base.noOp` | No-op node, produces no meaningful data |
| `n8n-nodes-base.wait` | Wait/delay node, no output |
| `n8n-nodes-base.start` | Legacy start node |
| `n8n-nodes-base.manualTrigger` | Manual trigger, no execution data |

### Optimized Trace Format

```json
{
  "status": "success",
  "data": {
    "Webhook": {
      "output": { "body": {...}, "headers": {...} },
      "type": "n8n-nodes-base.webhook",
      "status": "success"
    },
    "AI Agent": {
      "output": { "response": "..." },
      "type": "@n8n/n8n-nodes-langchain.agent",
      "status": "success",
      "tools_called": [
        {
          "name": "search_database",
          "input": { "query": "..." },
          "output": { "results": [...] },
          "status": "success"
        }
      ]
    }
  },
  "metadata": {
    "workflow_id": "abc123",
    "workflow_name": "My Workflow",
    "timestamp": "2024-01-15T10:30:00.000Z"
  },
  "platformId": "550e8400-..."
}
```

#### Root Level Fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `status` | Yes | string | `"success"`, `"partial"`, or `"error"` — overall execution status |
| `data` | Yes | object | Map of node names to their outputs |
| `metadata` | No | object | Workflow metadata (workflow_id, workflow_name, timestamp) |
| `platformId` | No | string | Platform UUID in Mibo Testing |

The node produces `"success"` when all target nodes executed, or `"partial"` when some nodes were skipped (not executed in the current workflow branch).

#### Node Object Fields (`data[nodeName]`)

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `output` | Yes | any | The node's output data (structure varies by node type). Single items are unwrapped. |
| `type` | Yes | string | Full n8n node type identifier (e.g., `@n8n/n8n-nodes-langchain.agent`) |
| `status` | Yes | string | `"success"`, `"skipped"`, or `"error"` |
| `error` | No | string | Error message when `status: "error"` |
| `tools_called` | No | array | Only present on AI nodes that invoke tools/functions (see below) |

#### Tool Call Object (`tools_called[]`)

Only present on AI agent nodes that invoke tools. Simple LLM calls (e.g., Google Gemini text generation) won't have this field.

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `name` | Yes | string | Tool/function name |
| `input` | Yes | any | Input passed to the tool |
| `output` | Yes | any | Tool's response |
| `status` | No | string | `"success"` or `"error"` |

**Key Benefits:**
- Node types included (enables AI auto-detection and filtering by type on the server)
- Flat structure (easy to extract specific node outputs)
- Single items are unwrapped (no `[{ data }]` when there's only one item)
- No workflow definition bloat

---

## Manual Node Names Mode

### How It Works

1. You manually list the names of nodes you want to capture
2. MiboTesting finds those nodes in the execution context
3. Captures their output data
4. Sends a **legacy trace** to the API

### Setup

1. Add MiboTesting node anywhere in your workflow
2. Leave "Auto-detect Workflow Nodes" disabled
3. Enter node names separated by commas: `Webhook, HTTP Request, AI Agent`

### When to Use This Mode

- When you can't use Get Workflow node
- When you need to capture data from specific known nodes
- For backwards compatibility with existing integrations

### Legacy Trace Format

```json
{
  "data": {
    "input": [{ "nodes": [...], "connections": {...} }],
    "nodes": [
      { "nodeName": "Webhook", "items": [{ ... }] },
      { "nodeName": "AI Agent", "items": [{ ... }] }
    ]
  },
  "externalMetadata": { "workflowId": "abc123" },
  "metadata": {
    "workflowId": "abc123",
    "workflowName": "My Workflow",
    "timestamp": "..."
  },
  "platformId": "...",
  "externalId": "..."
}
```

**Characteristics:**
- Node types NOT included per node (available in `data.input[0].nodes[].type` if Get Workflow input is present)
- Items always wrapped in array
- May include full workflow definition in input
- Larger payload size

---

## Request ID Correlation

The MiboTesting node automatically searches for `x-request-id` in the execution data. This ID is critical for **active testing** — it correlates traces with the n8n execution that the test runner triggered.

### How It's Used

1. **Extraction**: The node searches for `x-request-id` in input headers and webhook data
2. **HTTP Header**: The extracted ID is sent as an `x-request-id` HTTP header on the `POST /public/traces` request
3. **API Matching**: The API uses this header to match and update existing traces (returns `200` for updates, `201` for new traces)

### Auto-Detection Order

1. Manual `Request ID` parameter (if provided)
2. Headers in input data (recursive search)
3. Webhook node data (when using Get Workflow mode)

### Setting Request ID Manually

Use an expression to extract from Webhook headers:
```
{{ $("Webhook").item.json.headers["x-request-id"] }}
```

---

## Metadata Options

Add custom metadata to your traces:

| Field | Description |
|-------|-------------|
| Environment | e.g., "production", "staging" |
| Version | Your workflow/app version |
| Additional Fields | JSON object with custom key-value pairs |

---

## Payload Size & Compression

Example workflow with 5 nodes:

| Format | Typical Size | Reduction |
|--------|-------------|-----------|
| Manual Mode | ~50-100 KB | - |
| Get Workflow Mode | ~5-15 KB | 80-90% |

The optimized format removes:
- Full workflow definitions
- Node positions, colors, IDs
- Connection metadata
- Credential details

**Payload size**: The maximum payload size accepted by the API is 10MB. The node warns when the payload exceeds 80% of this limit.

---

## API Reference

### Trace Ingestion Endpoint

The node sends traces to `POST /public/traces` using the `x-api-key` header for authentication.

**Request Headers:**
- `x-api-key` (required) — your Mibo Testing API key
- `Content-Type: application/json`
- `x-request-id` (optional) — for trace correlation with active testing

**Response Codes:**

| Code | Meaning |
|------|---------|
| `201` | Trace created successfully |
| `200` | Existing trace updated (matched by `x-request-id`) |
| `401` | Missing or invalid API key |
| `403` | API key not authorized for the resolved platform |
| `404` | Platform not found (see below) |
| `413` | Payload too large (exceeds 10MB) |
| `500` | Server error |

### Platform Resolution

The API resolves the target platform using:
1. `platformId` in the request body (if provided), or
2. API key restrictions — if the key is restricted to a single platform, that platform is used automatically

If resolution fails, the API returns `404 PLATFORM_NOT_FOUND`. API keys can be restricted to specific platforms via `allowed_platform_ids`. If your key is restricted but the `platformId` doesn't match an allowed platform, you'll get this error.

### Other Trace Endpoints

The API also provides read endpoints (not used by the node, but useful for debugging):

- `GET /public/traces?platformId=X` — List traces for a platform
- `GET /public/traces/:traceId` — Get a single trace by ID

Both require the `x-api-key` header.

### Error Codes

| Code | Description |
|------|-------------|
| `MISSING_API_KEY` | The `x-api-key` header is missing |
| `INVALID_API_KEY` | The API key doesn't exist or has been revoked |
| `PLATFORM_NOT_FOUND` | Platform can't be resolved — either the `platformId` is wrong, or the API key restrictions don't match |
| `VALIDATION_ERROR` | Request body failed validation |
| `PAYLOAD_TOO_LARGE` | Trace data exceeds the 10MB limit |

### Format Detection

The API auto-detects the trace format:

```javascript
// Optimized: root has "status" + data is a flat node map
// Legacy: data.nodes is an array
function isOptimizedFormat(payload) {
  return payload.data && !Array.isArray(payload.data.nodes);
}
```

---

## How the Runner Processes Traces

Understanding how the Mibo Test Runner processes traces helps explain why certain fields matter.

### AI Node Auto-Detection

The runner automatically identifies AI nodes by checking if the node `type` contains any of these substrings: `langchain`, `openai`, `anthropic`, `azure`, `gemini`, `ollama`.

This is why **Get Workflow Mode is recommended** — it includes node types, enabling the runner to auto-detect AI nodes without manual configuration.

### Response Text Extraction

The runner uses a fallback chain to find the most relevant output:

1. **AI node detection** — finds the last AI node by type
2. **Last non-trigger node** — excludes nodes with types matching "webhook", "trigger", "start", "manualTrigger"
3. **Common key search** — looks for `text`, `output`, `message`, `content`, `response` in the node output
4. **Raw fallback** — returns the full output as-is

### Per-Assertion Targeting

For fine-grained control, test case assertions can specify `target_node` and `output_key` to evaluate a specific node's output:

```json
{
  "criteria": "Must provide accurate analysis",
  "target_node": "Message a model",
  "output_key": "content.parts.0.text"
}
```

This overrides the auto-detection and evaluates exactly the specified path.

---

## Node Type Examples

Common n8n node types you might see:

| Type | Description |
|------|-------------|
| `n8n-nodes-base.webhook` | Webhook trigger |
| `n8n-nodes-base.httpRequest` | HTTP Request |
| `n8n-nodes-base.set` | Set node |
| `n8n-nodes-base.if` | IF conditional |
| `n8n-nodes-base.code` | Code node |
| `@n8n/n8n-nodes-langchain.agent` | AI Agent (LangChain) |
| `@n8n/n8n-nodes-langchain.openAi` | OpenAI Chat Model |
| `@n8n/n8n-nodes-langchain.googleGemini` | Google Gemini |
| `@n8n/n8n-nodes-langchain.lmChatGoogleGemini` | Google Gemini Chat Model |
| `@n8n/n8n-nodes-langchain.toolCode` | Code tool for agents |

---

## Best Practices

1. **Use Get Workflow Mode** when possible for smaller payloads and type information
2. **Filter nodes** to only capture what you need for testing
3. **Set Platform ID** to avoid relying on API key restrictions for platform resolution
4. **Set Request ID** for active testing scenarios (required for test runner correlation)
5. **Monitor payload size** warnings in the output
6. **Include AI nodes** in your filter — their types enable auto-detection by the runner
7. **Use expressions** to dynamically set Platform ID if needed
