import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { DOCS_URL, UUID_REGEX } from './constants';
import type { FetchedWorkflow, WorkflowConnections, WorkflowNode } from './types';

export function isValidUUID(value: string): boolean {
  return UUID_REGEX.test(value);
}

/**
 * JSON.stringify that survives BigInt and other non-serializable values
 * by falling back to a replacer that coerces them to strings.
 */
export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  }
}

export function normalizeServerUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export function resolveN8nBaseUrl(credentialValue: string): string {
  if (credentialValue) {
    return credentialValue;
  }

  let base: string;
  if (process.env.WEBHOOK_URL) {
    base = process.env.WEBHOOK_URL.replace(/\/+$/, '');
  } else {
    const protocol = process.env.N8N_PROTOCOL || 'http';
    const host = process.env.N8N_HOST || 'localhost';
    const port = process.env.N8N_PORT || '5678';
    base = `${protocol}://${host}:${port}`;
  }

  return `${base}/api/v1`;
}

export async function fetchWorkflow(
  node: IExecuteFunctions,
  n8nBaseUrl: string,
  n8nApiKey: string,
  workflowId: string,
): Promise<FetchedWorkflow> {
  const baseUrl = normalizeServerUrl(n8nBaseUrl);

  try {
    const response = await node.helpers.httpRequest({
      method: 'GET',
      url: `${baseUrl}/workflows/${workflowId}`,
      headers: {
        'X-N8N-API-KEY': n8nApiKey,
      },
      json: true,
    });

    const nodes = response?.nodes;
    if (!nodes || !Array.isArray(nodes)) {
      throw new NodeOperationError(node.getNode(), 'Unexpected response from n8n API', {
        description:
          'The n8n API did not return a valid list of workflow nodes. Please verify that your n8n API Key has the "workflow:read" scope and that the workflow exists.',
      });
    }

    return {
      nodes: nodes.map((n: WorkflowNode) => ({
        name: n.name,
        parameters: n.parameters || {},
        type: n.type,
      })),
      connections: (response?.connections as WorkflowConnections) || {},
    };
  } catch (error) {
    if (error instanceof NodeOperationError) {
      throw error;
    }

    throw new NodeOperationError(node.getNode(), 'Could not connect to your n8n instance', {
      description:
        'Please check that your n8n API Key and Base URL are correct in the Mibo Testing credentials. You can find your API key in n8n under Settings > API. Make sure your n8n instance is running and reachable.',
    });
  }
}

/**
 * Build a child→parent map from n8n's connection graph.
 *
 * n8n `connections` is keyed by *source* node; each entry lists outgoing edges
 * grouped by output type (`main`, `ai_tool`, ...). We invert that: every target
 * node records its first incoming source as its parent. Nodes with no incoming
 * edge map to null (roots). Merge nodes pick the first connector deterministically
 * — assertions evaluate against `span.name`, not graph topology.
 */
export function buildParentMap(connections: WorkflowConnections): Record<string, string | null> {
  const parents: Record<string, string | null> = {};
  for (const sourceName of Object.keys(connections)) {
    const outputs = connections[sourceName];
    for (const outputType of Object.keys(outputs)) {
      for (const branch of outputs[outputType]) {
        for (const edge of branch) {
          if (edge?.node && parents[edge.node] === undefined) {
            parents[edge.node] = sourceName;
          }
        }
      }
    }
  }
  return parents;
}

function extractRequestIdFromHeaders(headers: IDataObject | undefined): string | undefined {
  if (!headers) {
    return undefined;
  }

  const headerKey = Object.keys(headers).find((key) => key.toLowerCase() === 'x-request-id');

  return headerKey ? (headers[headerKey] as string) : undefined;
}

/**
 * Resolve the workflow graph (nodes + connections) from one of two supported sources:
 * the n8n REST API (when credentials carry an n8n API key) or an upstream `Get Workflow`
 * node feeding `nodes`/`connections` through `items[0].json`. No other path is supported.
 */
export async function resolveWorkflow(
  node: IExecuteFunctions,
  credentials: IDataObject,
  workflowId: string,
  items: INodeExecutionData[],
): Promise<{ nodes: WorkflowNode[]; connections: WorkflowConnections }> {
  const n8nApiKey = (credentials.n8nApiKey as string) || '';
  if (n8nApiKey) {
    const n8nBaseUrl = resolveN8nBaseUrl((credentials.n8nBaseUrl as string) || '');
    const fetched = await fetchWorkflow(node, n8nBaseUrl, n8nApiKey, workflowId);
    return { nodes: fetched.nodes, connections: fetched.connections };
  }

  const firstItem = items[0]?.json as IDataObject | undefined;
  const upstreamNodes = firstItem?.nodes as WorkflowNode[] | undefined;
  if (upstreamNodes && Array.isArray(upstreamNodes)) {
    const upstreamConnections = (firstItem?.connections as WorkflowConnections) || {};
    return { nodes: upstreamNodes, connections: upstreamConnections };
  }

  throw new NodeOperationError(node.getNode(), 'Cannot enumerate workflow nodes', {
    description: `Configure the n8n API Key and Base URL in the Mibo Testing credentials (recommended) or connect an n8n "Get Workflow" node before this one. See ${DOCS_URL}.`,
  });
}

export function findRequestIdInData(data: IDataObject): string | undefined {
  if (data.headers) {
    const requestId = extractRequestIdFromHeaders(data.headers as IDataObject);
    if (requestId) {
      return requestId;
    }
  }

  for (const value of Object.values(data)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const requestId = findRequestIdInData(value as IDataObject);
      if (requestId) {
        return requestId;
      }
    }
  }

  return undefined;
}
