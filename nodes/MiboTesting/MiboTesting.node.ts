import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { buildCanonicalTracePayload, buildMetadata, extractToolCalls } from './builders';
import {
  AUTO_EXCLUDED_NODE_TYPES,
  DEFAULT_SERVER_URL,
  DEFAULT_TIMEOUT_SECONDS,
  DOCS_URL,
} from './constants';
import {
  calculatePayloadSize,
  formatBytes,
  getPayloadSizeWarning,
  parseErrorResponse,
  sendTrace,
} from './mibo-client';
import { buildRedactionPolicy, redactCapture } from './redaction';
import type { NodeOptions, SpanSource } from './types';
import {
  agentsMissingIntermediateSteps,
  buildParentMap,
  buildSubNodeNames,
  buildToolNodeNames,
  findRequestIdInData,
  isValidUUID,
  normalizeServerUrl,
  resolveWorkflow,
} from './utils';

export class MiboTesting implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Mibo Testing',
    name: 'miboTesting',
    icon: {
      light: 'file:mibo-testing.svg',
      dark: 'file:mibo-testing-dark.svg',
    },
    group: ['output'],
    version: 1,
    description:
      'Capture every executed workflow node and send a canonical trace to Mibo Testing for semantic and procedural testing',
    defaults: {
      name: 'Mibo Testing',
    },
    subtitle: 'Capture workflow trace',
    usableAsTool: true,
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
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
        placeholder: 'e.g. 550e8400-e29b-41d4-a716-446655440000',
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
        displayName: 'Automatic Sensitive Data Protection',
        name: 'automaticRedaction',
        type: 'boolean',
        noDataExpression: true,
        default: true,
        description:
          'Whether to hide common sensitive values and safe secret-name patterns such as passwords, API keys, tokens, and cookies before sending the trace',
      },
      {
        displayName: 'Custom Sensitive Data Protection',
        name: 'manualRedaction',
        type: 'boolean',
        noDataExpression: true,
        default: false,
        description:
          'Whether to hide values matching your custom field paths before sending the trace',
      },
      {
        displayName: 'Fields to Protect',
        name: 'redactionFields',
        type: 'fixedCollection',
        typeOptions: {
          multipleValues: true,
        },
        default: {},
        displayOptions: {
          show: {
            manualRedaction: [true],
          },
        },
        options: [
          {
            displayName: 'Field Paths',
            name: 'fieldPaths',
            values: [
              {
                displayName: 'Path',
                name: 'path',
                type: 'string',
                default: '',
                required: true,
                description:
                  "A dot-separated path for a deep search, not a single picked field. Every matching path is hidden; use '*' for one object or array level, such as 'customer.email' or 'customers.*.email'.",
                placeholder: 'e.g. customer.email',
              },
            ],
          },
        ],
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
    const automaticRedaction = this.getNodeParameter('automaticRedaction', 0, true) as boolean;
    const manualRedaction = this.getNodeParameter('manualRedaction', 0, false) as boolean;
    const redactionFields = this.getNodeParameter('redactionFields', 0, {}) as IDataObject;
    const options = this.getNodeParameter('options', 0, {}) as NodeOptions;

    let redactionPolicy;
    try {
      redactionPolicy = buildRedactionPolicy(automaticRedaction, manualRedaction, redactionFields);
    } catch (error) {
      throw new NodeOperationError(this.getNode(), 'Invalid redaction field path', {
        description: error instanceof Error ? error.message : 'Use dot-separated field paths.',
      });
    }

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
    // Excluded from node spans: the Mibo Testing node itself, and AI tools (a tool is not
    // a node — it appears only as a real tool-call from intermediateSteps). Model/memory
    // sub-nodes stay as output-less spans.
    const selfNodeName = this.getNode().name;
    const subNodeNames = buildSubNodeNames(connections);
    const toolNodeNames = buildToolNodeNames(connections);
    const capturedNodes = workflowNodes.filter(
      (n) =>
        n.name !== selfNodeName &&
        !toolNodeNames.has(n.name) &&
        !AUTO_EXCLUDED_NODE_TYPES.includes(n.type),
    );
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

      const isSubNode = subNodeNames.has(nodeName);

      let captured = false;
      // Sub-nodes never expose output via $items — skip the lookup, emit them below.
      if (!isSubNode) {
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
          // node not reachable in this execution branch — fall through below
        }
      }

      if (!captured) {
        if (isSubNode) {
          // Ran inside its parent: success, no output, not an alarm.
          sources.push({ nodeName, type, status: 'success', items: [], parameters });
        } else {
          nodesNotExecuted.push(nodeName);
          sources.push({ nodeName, type, status: 'skipped', items: [], parameters });
        }
      }
    }

    if (sources.filter((s) => s.items.length > 0).length === 0) {
      throw new NodeOperationError(this.getNode(), 'No executed nodes were captured', {
        description: `None of the workflow nodes had executed data when this node ran. Make sure the Mibo Testing node runs after the steps you want to capture. See ${DOCS_URL}.`,
      });
    }

    const manualRequestId = this.getNodeParameter('requestId', 0, '') as string;
    const requestId = manualRequestId || extractedRequestId || this.getExecutionId() || undefined;

    const {
      sources: redactedSources,
      metadata: redactedMetadata,
      summary,
    } = redactCapture(sources, metadata, redactionPolicy);

    const parentMap = buildParentMap(connections);
    const toolCalls = extractToolCalls(redactedSources);

    const tracePayload = buildCanonicalTracePayload(
      redactedSources,
      workflowId,
      redactedMetadata,
      platformId,
      parentMap,
      toolCalls,
    );

    // Agents that have tools wired but won't expose them (returnIntermediateSteps off).
    // Distinct from an agent that simply didn't call a tool this run.
    const agentsNeedingSteps = agentsMissingIntermediateSteps(connections, workflowNodes);

    const serverUrl = normalizeServerUrl(DEFAULT_SERVER_URL);
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
          spansSent: redactedSources.filter((s) => s.items.length > 0).length,
          toolCallsSent: toolCalls.length,
          payloadSize: payloadSizeFormatted,
          redaction: summary as unknown as IDataObject,
        };

        if (payloadWarning) {
          traceInfo.payloadWarning = payloadWarning;
        }

        if (nodesNotExecuted.length > 0) {
          traceInfo.warning = `Some nodes did not execute in this workflow branch: ${nodesNotExecuted.join(', ')}`;
          traceInfo.nodesNotExecuted = nodesNotExecuted;
        }

        if (agentsNeedingSteps.length > 0) {
          traceInfo.toolCallsWarning = `Turn on 'Return Intermediate Steps' on these agent nodes so tool-call assertions can see which tools ran: ${agentsNeedingSteps.join(', ')}.`;
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
        throw new NodeApiError(this.getNode(), error as JsonObject, {
          message: `Failed to send trace to Mibo Testing: ${errorMessage}`,
          description: isPayloadTooLarge
            ? 'Try excluding nodes with large outputs (files, images, etc.) or reducing payload-heavy parameters.'
            : 'Check your Mibo Testing API Key (the first field in the credentials). This is NOT the n8n API Key.',
        });
      }
    }

    return [returnData];
  }
}
