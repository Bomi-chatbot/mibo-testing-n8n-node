import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { UUID_REGEX } from './constants';
import type { WorkflowNode } from './types';

export function isValidUUID(value: string): boolean {
  return UUID_REGEX.test(value);
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

export async function fetchWorkflowNodes(
  node: IExecuteFunctions,
  n8nBaseUrl: string,
  n8nApiKey: string,
  workflowId: string,
): Promise<WorkflowNode[]> {
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

    return nodes.map((n: WorkflowNode) => ({
      name: n.name,
      parameters: n.parameters || {},
      type: n.type,
    }));
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

function extractRequestIdFromHeaders(headers: IDataObject | undefined): string | undefined {
  if (!headers) {
    return undefined;
  }

  const headerKey = Object.keys(headers).find((key) => key.toLowerCase() === 'x-request-id');

  return headerKey ? (headers[headerKey] as string) : undefined;
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
