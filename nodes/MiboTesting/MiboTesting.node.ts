import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import {
  buildCanonicalTracePayload,
  buildMetadata,
  extractToolCalls,
  resolveHttpResponseStatus,
} from './builders';
import {
  AUTO_EXCLUDED_NODE_TYPES,
  DEFAULT_SERVER_URL,
  DEFAULT_TIMEOUT_SECONDS,
  DOCS_URL,
  MIBO_APP_URL,
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
    hints: [
      {
        message: 'Trace sent successfully to Mibo. Access it at https://app.mibo-ai.com.',
        location: 'outputPane',
        whenToDisplay: 'afterExecution',
      },
    ],
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
        displayName: 'Request ID Override',
        name: 'requestId',
        type: 'string',
        default: '',
        description:
          'Optionally override the x-request-ID used to correlate this trace. By default the node finds x-request-ID in incoming webhook headers, then falls back to the n8n execution ID.',
        placeholder: 'e.g. custom-request-ID',
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
        displayName:
          'Captured trace data is sent to the hosted Mibo Testing service for storage and evaluation.',
        name: 'hostedDataProcessingNotice',
        type: 'notice',
        default: '',
      },
      {
        displayName: 'Automatic Sensitive Data Protection',
        name: 'automaticRedaction',
        type: 'boolean',
        noDataExpression: true,
        default: true,
        description:
          'Whether to hide common sensitive values and safe secret-name patterns such as passwords, API keys, tokens, and cookies before sending the trace',
        hint: 'Enabled by default. Hides common secrets before the trace leaves n8n.',
      },
      {
        displayName: 'Custom Sensitive Data Protection',
        name: 'manualRedaction',
        type: 'boolean',
        noDataExpression: true,
        default: false,
        description:
          'Whether to hide values matching your custom field paths before sending the trace',
        hint: 'Use this for domain-specific fields such as email or customer ID. Paths use deep search.',
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
                hint: "Examples: 'email', 'customer.email', or 'customers.*.email'. Every matching occurrence is protected.",
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
            displayName: 'Include Input Data in Output',
            name: 'includeInputData',
            type: 'boolean',
            default: false,
            description:
              'Whether to include the original input fields alongside the Mibo trace summary',
          },
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
    const aggregatePairedItems = items.map((_, item) => ({ item }));

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
    const includeInputData = Boolean(options.includeInputData);

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
    const requestIdSource = manualRequestId
      ? 'manualOverride'
      : extractedRequestId
        ? 'x-request-id'
        : 'executionId';

    const {
      sources: redactedSources,
      metadata: redactedMetadata,
      summary,
    } = redactCapture(sources, metadata, redactionPolicy);

    const parentMap = buildParentMap(connections);
    const toolCalls = extractToolCalls(redactedSources);
    const httpResponseStatus = resolveHttpResponseStatus(workflowNodes, parentMap, selfNodeName);

    const tracePayload = buildCanonicalTracePayload(
      redactedSources,
      workflowId,
      redactedMetadata,
      platformId,
      parentMap,
      toolCalls,
      httpResponseStatus,
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

      const recommendations: IDataObject[] = [];

      if (nodesNotExecuted.length > 0) {
        recommendations.push({
          code: 'nodes_not_executed',
          message:
            'Review these nodes if you expected them to run. n8n exposed no output for this execution.',
          nodes: nodesNotExecuted,
        });
      }

      if (agentsNeedingSteps.length > 0) {
        recommendations.push({
          code: 'enable_intermediate_steps',
          message:
            "Turn on 'Return Intermediate Steps' on these agent nodes so Mibo can capture tool calls.",
          nodes: agentsNeedingSteps,
        });
      }

      if (payloadWarning) {
        recommendations.push({
          code: 'payload_size',
          message: payloadWarning,
        });
      }

      const traceInfo: IDataObject = {
        sent: true,
        traceId: response?.data?.id || 'unknown',
        platformId: platformId || 'resolved-from-api-key',
        requestId: requestId || null,
        requestIdSource,
        timestamp,
        trace: {
          spansSent: tracePayload.spans.length,
          toolCallsSent: toolCalls.length,
          payloadSize: payloadSizeFormatted,
          nodes: redactedSources.map((source) => ({
            name: source.nodeName,
            status: source.status,
            itemsCaptured: source.items.length,
          })),
        },
        redaction: summary as unknown as IDataObject,
        recommendations,
        miboUrl: MIBO_APP_URL,
      };

      if (includeInputData) {
        for (let i = 0; i < items.length; i++) {
          returnData.push({
            json: {
              ...items[i].json,
              _miboTrace: traceInfo,
            },
            pairedItem: { item: i },
          });
        }
      } else {
        returnData.push({
          json: {
            _miboTrace: traceInfo,
          },
          pairedItem: aggregatePairedItems,
        });
      }
    } catch (error: unknown) {
      const errorMessage = parseErrorResponse(error);

      if (this.continueOnFail()) {
        const traceInfo: IDataObject = {
          sent: false,
          error: errorMessage,
          platformId: platformId || 'unknown',
          requestId: requestId || null,
          requestIdSource,
          timestamp,
          payloadSize: payloadSizeFormatted,
        };

        if (includeInputData) {
          for (let i = 0; i < items.length; i++) {
            returnData.push({
              json: {
                ...items[i].json,
                _miboTrace: traceInfo,
              },
              pairedItem: { item: i },
            });
          }
        } else {
          returnData.push({
            json: {
              _miboTrace: traceInfo,
            },
            pairedItem: aggregatePairedItems,
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
