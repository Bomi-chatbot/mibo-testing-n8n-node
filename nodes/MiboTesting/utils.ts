import type { IDataObject, IExecuteFunctions, INodeExecutionData, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
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
  return credentialValue || 'http://localhost:5678/api/v1';
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

    throw new NodeApiError(node.getNode(), error as JsonObject, {
      message: 'Could not connect to your n8n instance',
      description:
        'Please check that your n8n API Key and Base URL are correct in the Mibo Testing credentials. You can find your API key in n8n under Settings > API. Make sure your n8n instance is running and reachable.',
    });
  }
}

/**
 * Child→parent map from n8n connections. `main` edges parent target→source;
 * AI sub-node edges invert so the sub-node nests under the agent it feeds.
 * First writer wins, so a node's `main` parent is never overwritten.
 */
export function buildParentMap(connections: WorkflowConnections): Record<string, string | null> {
  const parents: Record<string, string | null> = {};
  const setParent = (child: string, parent: string) => {
    if (parents[child] === undefined) {
      parents[child] = parent;
    }
  };

  for (const sourceName of Object.keys(connections)) {
    const outputs = connections[sourceName];
    for (const outputType of Object.keys(outputs)) {
      const isMain = outputType === 'main';
      for (const branch of outputs[outputType]) {
        for (const edge of branch) {
          if (!edge?.node) {
            continue;
          }
          if (isMain) {
            setParent(edge.node, sourceName);
          } else {
            setParent(sourceName, edge.node);
          }
        }
      }
    }
  }
  return parents;
}

/**
 * AI sub-nodes: sources of a non-`main` connection (`ai_languageModel`, `ai_tool`, ...).
 * Their output isn't reachable via `$items`, so they're emitted as output-less spans but
 * kept out of the "did not execute" warning.
 */
export function buildSubNodeNames(connections: WorkflowConnections): Set<string> {
  const subNodes = new Set<string>();
  for (const sourceName of Object.keys(connections)) {
    const outputs = connections[sourceName];
    for (const outputType of Object.keys(outputs)) {
      if (outputType !== 'main') {
        subNodes.add(sourceName);
        break;
      }
    }
  }
  return subNodes;
}

/**
 * AI tools: sources of an `ai_tool` connection. Their real invocations are recovered
 * from the agent's `intermediateSteps`, so this set is only used to detect when tools
 * are present (e.g. to check the agent is configured to expose them).
 */
export function buildToolNodeNames(connections: WorkflowConnections): Set<string> {
  const tools = new Set<string>();
  for (const sourceName of Object.keys(connections)) {
    if (connections[sourceName].ai_tool) {
      tools.add(sourceName);
    }
  }
  return tools;
}

/**
 * Names of agent nodes that have tools wired but don't expose them: an `ai_tool` feeds
 * the agent, yet its `options.returnIntermediateSteps` isn't enabled. Without that flag
 * n8n never reports which tools ran, so tool-call assertions would see nothing. Used to
 * warn the user — not to be confused with an agent that simply called no tool this run.
 */
export function agentsMissingIntermediateSteps(
  connections: WorkflowConnections,
  nodes: WorkflowNode[],
): string[] {
  const agentsWithTools = new Set<string>();
  for (const sourceName of Object.keys(connections)) {
    const toolEdges = connections[sourceName].ai_tool;
    if (!toolEdges) continue;
    for (const branch of toolEdges) {
      for (const edge of branch) {
        if (edge?.node) agentsWithTools.add(edge.node);
      }
    }
  }

  const missing: string[] = [];
  for (const agentName of agentsWithTools) {
    const node = nodes.find((n) => n.name === agentName);
    const options = node?.parameters?.options as IDataObject | undefined;
    if (options?.returnIntermediateSteps !== true) {
      missing.push(agentName);
    }
  }
  return missing;
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
