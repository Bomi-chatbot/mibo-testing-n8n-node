# n8n-nodes-mibo-testing

This is an n8n community node for **Mibo Testing** - a platform for semantic and procedural testing of AI workflows.

## Features

- **Capture Workflow Traces**: Automatically collect execution data from your n8n workflows
- **Send to Mibo Testing**: Securely transmit traces to Mibo Testing servers for analysis
- **Customizable Metadata**: Add custom JSON metadata to your traces
- **PII Scrubbing**: Redact sensitive information locally before sending traces
- **Platform Integration**: Link traces to specific platforms in your Mibo Testing account

## Installation

### Community Nodes (Recommended)

1. Go to **Settings > Community Nodes** in your n8n instance
2. Search for `n8n-nodes-mibo-testing`
3. Click **Install**

### Manual Installation

```bash
npm install n8n-nodes-mibo-testing
```

Then restart your n8n instance.

## Configuration

### Credentials

1. Create a new credential of type **Mibo Testing API**
2. Enter your **API Key** (found in Mibo Testing Dashboard > Settings > API Keys)
3. Optionally, change the **Server URL** if using a self-hosted instance

### Node Setup

1. Add the **Mibo Testing** node at the end of your workflow (or wherever you want to capture the trace)
2. Configure the following:
   - **Platform ID**: Your platform identifier from Mibo Testing
   - **Clean PII**: Enable this to redact sensitive information locally

#### Advanced Options

- **Custom Metadata**: JSON object with additional context (JSON format)
- **Custom Server URL**: Override the credential's server URL
- **Timeout**: Maximum wait time for server response

## Usage Example

### Basic Setup

```
[Trigger] → [Your Nodes] → [Mibo Testing]
```

The Mibo Testing node acts as a **passthrough** - it captures the trace and forwards the data unchanged to any connected nodes.

### With Custom Metadata

Configure the node with:
- Platform ID: `plt_your_platform_id`
- Options > Custom Metadata:
  ```json
  {
    "environment": "production",
    "version": "2.1.0",
    "feature": "user-onboarding"
  }
  ```

## Trace Data Structure

The trace sent to Mibo Testing includes:

```typescript
{
  workflowId: string;
  workflowName: string;
  executionId: string;
  startTime: string;
  endTime: string;
  status: 'success' | 'error';
  platformId: string;
  metadata: object;
  inputData: object[];
  outputData: object[];
}
```

## Development

### Prerequisites

- Node.js 20.0.0 or later
- npm or pnpm

### Setup

```bash
git clone https://github.com/mibo-testing/n8n-nodes-mibo-testing.git
cd n8n-nodes-mibo-testing
npm install
```

### Build

```bash
npm run build
```

### Development Mode

```bash
npm run dev
```

### Lint

```bash
npm run lint
npm run lint:fix
```

## License

GNU GPL v3

## Support

- Documentation: [https://docs.mibo-testing.com/integrations/n8n](https://docs.mibo-testing.com/integrations/n8n)
- Issues: [GitHub Issues](https://github.com/mibo-testing/n8n-nodes-mibo-testing/issues)
- Contact: support@mibo-testing.com
