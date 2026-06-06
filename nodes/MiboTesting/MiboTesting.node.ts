import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { buildCanonicalTracePayload, buildMetadata } from './builders';
import {
  AUTO_EXCLUDED_NODE_TYPES,
  DEFAULT_TIMEOUT_SECONDS,
  DOCS_URL,
  getServerUrl,
} from './constants';
import {
  calculatePayloadSize,
  formatBytes,
  getPayloadSizeWarning,
  parseErrorResponse,
  sendTrace,
} from './mibo-client';
import type { NodeOptions, SpanSource } from './types';
import {
  buildParentMap,
  findRequestIdInData,
  isValidUUID,
  normalizeServerUrl,
  resolveWorkflow,
} from './utils';

export class MiboTesting implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Mibo Testing',
    name: 'miboTesting',
    icon: 'file:mibo-testing.svg',
    group: ['output'],
    version: 1,
    description:
      'Capture every executed workflow node and send a canonical trace to Mibo Testing for semantic and procedural testing',
    defaults: {
      name: 'Mibo Testing',
    },
    inputs: ['main'],
    outputs: ['main'],
    credentials: [
      {
        name: 'miboTestingApi',
        required: true,
      },
    ],
    properties: [
      {
        displayName: 'Agent ID',
        name: 'platformId',
        type: 'string',
        default: '',
        description:
          'The unique identifier for your agent in Mibo Testing (UUID format). Leave empty if the API key is already scoped to a single agent.',
        placeholder: 'e.g., 550e8400-e29b-41d4-a716-446655440000',
      },
      {
        displayName: 'Request ID',
        name: 'requestId',
        type: 'string',
        default: '',
        description:
          'Override the x-request-ID used to correlate this trace. By default the node uses the x-request-ID from incoming webhook headers, then falls back to the n8n execution ID.',
        placeholder: '={{ $("Webhook").item.json.headers["x-request-ID"] }}',
      },
      {
        displayName: 'Include Metadata',
        name: 'includeMetadata',
        type: 'boolean',
        noDataExpression: true,
        default: false,
        description: 'Whether to include additional metadata with the trace',
      },
      {
        displayName: 'Metadata',
        name: 'metadata',
        type: 'fixedCollection',
        typeOptions: {
          multipleValues: false,
        },
        default: {},
        displayOptions: {
          show: {
            includeMetadata: [true],
          },
        },
        options: [
          {
            displayName: 'Fields',
            name: 'fields',
            values: [
              {
                displayName: 'Environment',
                name: 'environment',
                type: 'string',
                default: 'production',
                description: 'The environment where the workflow is running',
              },
              {
                displayName: 'Version',
                name: 'version',
                type: 'string',
                default: '1.0.0',
                description: 'The version of your workflow or application',
              },
              {
                displayName: 'Additional Fields',
                name: 'additionalFields',
                type: 'json',
                default: '{}',
                description: 'Any additional metadata fields (JSON format)',
                placeholder: '{"team": "backend", "feature": "user-auth"}',
              },
            ],
          },
        ],
      },
      {
        displayName: 'Options',
        name: 'options',
        type: 'collection',
        placeholder: 'Add Option',
        default: {},
        options: [
          {
            displayName: 'Timeout (Seconds)',
            name: 'timeout',
            type: 'number',
            default: DEFAULT_TIMEOUT_SECONDS,
            description: 'Maximum time in seconds to wait for the Mibo Testing server to respond',
          },
        ],
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    const credentials = await this.getCredentials('miboTestingApi');
    const workflowData = this.getWorkflow();
    const workflowId = workflowData.id || 'unknown';
    const workflowName = workflowData.name || 'Unnamed Workflow';

    const { nodes: workflowNodes, connections } = await resolveWorkflow(
      this,
      credentials,
      workflowId,
      items,
    );

    const platformId = this.getNodeParameter('platformId', 0, '') as string;
    const includeMetadata = this.getNodeParameter('includeMetadata', 0, false) as boolean;
    const options = this.getNodeParameter('options', 0, {}) as NodeOptions;

    if (platformId && !isValidUUID(platformId)) {
      throw new NodeOperationError(this.getNode(), 'Agent ID must be a valid UUID', {
        description:
          'The Agent ID must be in UUID format (e.g., 550e8400-e29b-41d4-a716-446655440000)',
      });
    }

    const timestamp = new Date().toISOString();
    const metadataConfig = includeMetadata
      ? (this.getNodeParameter('metadata', 0, {}) as IDataObject)
      : {};

    const metadata = buildMetadata(
      workflowId,
      workflowName,
      timestamp,
      includeMetadata,
      metadataConfig,
      this,
    );

    const proxy = this.getWorkflowDataProxy(0);

    const capturedNodes = workflowNodes.filter((n) => !AUTO_EXCLUDED_NODE_TYPES.includes(n.type));
    const sources: SpanSource[] = [];
    const nodesNotExecuted: string[] = [];
    let extractedRequestId: string | undefined;

    for (const item of items) {
      extractedRequestId = findRequestIdInData(item.json as IDataObject);
      if (extractedRequestId) break;
    }

    for (const wfNode of capturedNodes) {
      const nodeName = wfNode.name;
      const type = wfNode.type || 'unknown';
      const parameters =
        wfNode.parameters && Object.keys(wfNode.parameters).length > 0
          ? wfNode.parameters
          : undefined;

      let captured = false;
      try {
        const nodeItems = proxy.$items(nodeName);
        if (nodeItems && nodeItems.length > 0) {
          const itemsJson: IDataObject[] = [];
          for (const ni of nodeItems) {
            const itemJson = ni.json as IDataObject;
            itemsJson.push(itemJson);
            if (!extractedRequestId) {
              extractedRequestId = findRequestIdInData(itemJson);
            }
          }
          sources.push({
            nodeName,
            type,
            status: 'success',
            items: itemsJson,
            parameters,
          });
          captured = true;
        }
      } catch {
        // node not reachable in this execution branch — fall through to skipped
      }

      if (!captured) {
        nodesNotExecuted.push(nodeName);
        sources.push({
          nodeName,
          type,
          status: 'skipped',
          items: [],
          parameters,
        });
      }
    }

    if (sources.filter((s) => s.status === 'success').length === 0) {
      throw new NodeOperationError(this.getNode(), 'No executed nodes were captured', {
        description: `None of the workflow nodes had executed data when this node ran. Make sure the Mibo Testing node runs after the steps you want to capture. See ${DOCS_URL}.`,
      });
    }

    const manualRequestId = this.getNodeParameter('requestId', 0, '') as string;
    const requestId = manualRequestId || extractedRequestId || this.getExecutionId() || undefined;

    const parentMap = buildParentMap(connections);

    const tracePayload = buildCanonicalTracePayload(
      sources,
      workflowId,
      metadata,
      platformId,
      parentMap,
    );

    const serverUrl = normalizeServerUrl(getServerUrl());
    const timeout = (options.timeout || DEFAULT_TIMEOUT_SECONDS) * 1000;

    const payloadSize = calculatePayloadSize(tracePayload);
    const payloadSizeFormatted = formatBytes(payloadSize);
    const payloadWarning = getPayloadSizeWarning(payloadSize);

    try {
      const response = await sendTrace(
        this,
        serverUrl,
        credentials.apiKey as string,
        tracePayload,
        timeout,
        requestId,
      );

      for (let i = 0; i < items.length; i++) {
        const traceInfo: IDataObject = {
          sent: true,
          traceId: response?.data?.id || 'unknown',
          platformId: platformId || 'resolved-from-api-key',
          requestId: requestId || null,
          timestamp,
          spansSent: sources.filter((s) => s.status === 'success').length,
          payloadSize: payloadSizeFormatted,
        };

        if (payloadWarning) {
          traceInfo.payloadWarning = payloadWarning;
        }

        if (nodesNotExecuted.length > 0) {
          traceInfo.warning = `Some nodes did not execute in this workflow branch: ${nodesNotExecuted.join(', ')}`;
          traceInfo.nodesNotExecuted = nodesNotExecuted;
        }

        returnData.push({
          json: {
            ...items[i].json,
            _miboTrace: traceInfo,
          },
          pairedItem: { item: i },
        });
      }
    } catch (error: unknown) {
      const errorMessage = parseErrorResponse(error);

      if (this.continueOnFail()) {
        for (let i = 0; i < items.length; i++) {
          returnData.push({
            json: {
              ...items[i].json,
              _miboTrace: {
                sent: false,
                error: errorMessage,
                platformId: platformId || 'unknown',
                requestId: requestId || null,
                timestamp,
                payloadSize: payloadSizeFormatted,
              },
            },
            pairedItem: { item: i },
          });
        }
      } else {
        const isPayloadTooLarge = errorMessage.toLowerCase().includes('too large');
        throw new NodeOperationError(
          this.getNode(),
          `Failed to send trace to Mibo Testing: ${errorMessage}`,
          {
            description: isPayloadTooLarge
              ? 'Try excluding nodes with large outputs (files, images, etc.) or reducing payload-heavy parameters.'
              : 'Check your Mibo Testing API Key (the first field in the credentials). This is NOT the n8n API Key.',
          },
        );
      }
    }

    return [returnData];
  }
}
