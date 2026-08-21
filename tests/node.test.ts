import type { IDataObject, IExecuteFunctions, INode, INodeExecutionData } from 'n8n-workflow';

import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_PAYLOAD_SIZE_BYTES } from '../nodes/MiboTesting/constants';
import { MiboTesting } from '../nodes/MiboTesting/MiboTesting.node';
import type { CanonicalTracePayload } from '../nodes/MiboTesting/types';

vi.mock('../nodes/MiboTesting/mibo-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../nodes/MiboTesting/mibo-client')>();
  return {
    ...actual,
    sendTrace: vi.fn(),
  };
});

import { sendTrace } from '../nodes/MiboTesting/mibo-client';
const mockSendTrace = vi.mocked(sendTrace);

interface MockOverrides {
  continueOnFail?: boolean;
  credentials?: Record<string, unknown>;
  executionId?: string;
  inputItems?: INodeExecutionData[];
  itemsProxy?: Record<string, IDataObject[]>;
  params?: Record<string, unknown>;
  workflowResponse?: { nodes: unknown[]; connections?: Record<string, unknown> };
}

const DEFAULT_WORKFLOW_NODES = [
  { name: 'Webhook', type: 'n8n-nodes-base.webhook', parameters: {} },
  {
    name: 'HTTP Request',
    type: 'n8n-nodes-base.httpRequest',
    parameters: { url: 'https://example.com', method: 'GET' },
  },
  { name: 'AI Agent', type: '@n8n/n8n-nodes-langchain.agent', parameters: {} },
  {
    name: 'Google Gemini Chat Model',
    type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini',
    parameters: {},
  },
  { name: 'Date & Time', type: 'n8n-nodes-base.dateTime', parameters: {} },
  { name: 'Sticky Note', type: 'n8n-nodes-base.stickyNote', parameters: {} },
  {
    name: 'Mibo Testing',
    type: '@mibo-ai/n8n-nodes-mibo-testing.miboTesting',
    parameters: {},
  },
];

const DEFAULT_CONNECTIONS = {
  Webhook: { main: [[{ node: 'HTTP Request' }]] },
  'HTTP Request': { main: [[{ node: 'AI Agent' }]] },
  'AI Agent': { main: [[{ node: 'Mibo Testing' }]] },
  // AI sub-nodes feed the Agent via non-main connection types.
  'Google Gemini Chat Model': { ai_languageModel: [[{ node: 'AI Agent' }]] },
  'Date & Time': { ai_tool: [[{ node: 'AI Agent' }]] },
};

const DEFAULT_ITEMS_PROXY: Record<string, IDataObject[]> = {
  Webhook: [{ headers: { 'content-type': 'application/json' }, body: 'hi' }],
  'HTTP Request': [{ response: 'ok' }],
  'AI Agent': [{ output: 'response text' }],
};

function createMockExecuteFunctions(overrides: MockOverrides = {}) {
  const inputItems: INodeExecutionData[] = overrides.inputItems || [
    { json: { message: 'hello' } },
  ];

  const nodeParams: Record<string, unknown> = {
    requestId: '',
    platformId: '',
    includeMetadata: false,
    metadata: {},
    automaticRedaction: true,
    manualRedaction: false,
    redactionFields: {},
    options: {},
    ...overrides.params,
  };

  const itemsProxy: Record<string, IDataObject[]> = overrides.itemsProxy || DEFAULT_ITEMS_PROXY;

  const credentials = overrides.credentials || {
    apiKey: 'test-api-key',
    n8nApiKey: 'fake-n8n-key',
    n8nBaseUrl: 'http://localhost:5678/api/v1',
  };

  const workflowResponse = overrides.workflowResponse || {
    nodes: DEFAULT_WORKFLOW_NODES,
    connections: DEFAULT_CONNECTIONS,
  };

  const httpRequest = vi.fn(async (_opts?: unknown) => workflowResponse);

  const mock = {
    getInputData: vi.fn(() => inputItems),
    getExecutionId: vi.fn(() => overrides.executionId ?? 'exec-1'),
    getNode: vi.fn(() => ({ name: 'Mibo Testing' }) as INode),
    getNodeParameter: vi.fn((name: string) => nodeParams[name]),
    getCredentials: vi.fn(async () => credentials),
    getWorkflow: vi.fn(() => ({ id: 'wf-123', name: 'Test Workflow' })),
    getWorkflowDataProxy: vi.fn(() => ({
      $node: {},
      $items: (nodeName: string) => {
        const items = itemsProxy[nodeName];
        if (!items) throw new Error(`Node ${nodeName} not found`);
        return items.map((json) => ({ json }));
      },
    })),
    continueOnFail: vi.fn(() => overrides.continueOnFail || false),
    helpers: {
      httpRequest,
    },
  };

  return { mock: mock as unknown as IExecuteFunctions, httpRequest };
}

describe('MiboTesting.execute', () => {
  const node = new MiboTesting();

  beforeEach(() => {
    vi.clearAllMocks();
    mockSendTrace.mockResolvedValue({
      success: true,
      message: 'Trace created',
      timestamp: '2025-01-01T00:00:00.000Z',
      data: {
        id: 'trace-id-123',
        platformId: 'plat-1',
        status: 'completed',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
    });
  });

  describe('canonical trace emission', () => {
    it('emits one span per executed main node with display names and wired parents', async () => {
      const { mock } = createMockExecuteFunctions();
      await node.execute.call(mock);

      const payload = mockSendTrace.mock.calls[0][3] as CanonicalTracePayload;
      const byName = Object.fromEntries(payload.spans.map((s) => [s.name, s]));
      // Sticky Note (excluded type), Mibo Testing (self) and Date & Time (a tool, not a
      // node) are gone; the three main nodes plus the language model remain.
      expect(byName['Sticky Note']).toBeUndefined();
      expect(byName['Mibo Testing']).toBeUndefined();

      expect(byName.Webhook.parent_span_id).toBeNull();
      expect(byName['HTTP Request'].parent_span_id).toBe(byName.Webhook.span_id);
      expect(byName['AI Agent'].parent_span_id).toBe(byName['HTTP Request'].span_id);

      // The three reachable main nodes carry their captured output.
      expect(byName.Webhook.attributes['n8n.node.status']).toBe('success');
      expect(byName['HTTP Request'].attributes['n8n.node.status']).toBe('success');
      expect(byName['AI Agent'].attributes['n8n.node.status']).toBe('success');
    });

    it('emits the executed Respond to Webhook status on the root span', async () => {
      const workflowNodes = [
        {
          name: 'Webhook',
          type: 'n8n-nodes-base.webhook',
          parameters: { responseMode: 'responseNode' },
        },
        {
          name: 'Respond to Customer',
          type: 'n8n-nodes-base.respondToWebhook',
          parameters: { options: {} },
        },
        {
          name: 'Mibo Testing',
          type: '@mibo-ai/n8n-nodes-mibo-testing.miboTesting',
          parameters: {},
        },
      ];
      const connections = {
        Webhook: { main: [[{ node: 'Respond to Customer' }]] },
        'Respond to Customer': { main: [[{ node: 'Mibo Testing' }]] },
      };
      const { mock } = createMockExecuteFunctions({
        workflowResponse: { nodes: workflowNodes, connections },
        itemsProxy: { Webhook: [{ body: 'hi' }] },
      });

      await node.execute.call(mock);

      const payload = mockSendTrace.mock.calls[0][3] as CanonicalTracePayload;
      const rootSpan = payload.spans.find((span) => span.parent_span_id === null);
      expect(rootSpan?.name).toBe('Webhook');
      expect(rootSpan?.attributes['http.response.status_code']).toBe(200);
    });

    it('emits the language model as an output-less span but never the tool as a node', async () => {
      const { mock } = createMockExecuteFunctions();
      const result = await node.execute.call(mock);

      const payload = mockSendTrace.mock.calls[0][3] as CanonicalTracePayload;
      const byName = Object.fromEntries(payload.spans.map((s) => [s.name, s]));

      // The model runs with the agent: kept as an output-less span nested under it.
      const gemini = byName['Google Gemini Chat Model'];
      expect(gemini.attributes['n8n.node.status']).toBe('success');
      expect(gemini.attributes['n8n.node.output']).toBeUndefined();
      expect(gemini.parent_span_id).toBe(byName['AI Agent'].span_id);

      // A tool is not a node: Date & Time never appears as a node span (only as a
      // real tool-call from intermediateSteps, which this run has none of).
      expect(byName['Date & Time']).toBeUndefined();
      expect(payload.spans.map((s) => s.name)).not.toContain('Mibo Testing');

      const summary = result[0][0].json._miboTrace as IDataObject;
      expect(summary.recommendations).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'nodes_not_executed' })]),
      );
    });

    it('recovers real tool calls from the agent intermediateSteps as child spans', async () => {
      const agentWithSteps = DEFAULT_WORKFLOW_NODES.map((n) =>
        n.name === 'AI Agent'
          ? { ...n, parameters: { options: { returnIntermediateSteps: true } } }
          : n,
      );
      const { mock } = createMockExecuteFunctions({
        workflowResponse: { nodes: agentWithSteps, connections: DEFAULT_CONNECTIONS },
        itemsProxy: {
          Webhook: [{ body: 'hi' }],
          'HTTP Request': [{ ok: true }],
          'AI Agent': [
            {
              output: 'done',
              intermediateSteps: [
                {
                  action: { tool: 'Date & Time', toolInput: { format: 'iso' } },
                  observation: '2026-06-15',
                },
              ],
            },
          ],
        },
      });
      const result = await node.execute.call(mock);

      const payload = mockSendTrace.mock.calls[0][3] as CanonicalTracePayload;
      const byName = Object.fromEntries(payload.spans.map((s) => [s.name, s]));

      // One child span per real invocation, carrying the GenAI tool attributes and
      // parented to the agent that called it.
      const toolSpan = payload.spans.find((s) => s.attributes['gen_ai.tool.name'] === 'Date & Time');
      expect(toolSpan).toBeDefined();
      expect(toolSpan?.parent_span_id).toBe(byName['AI Agent'].span_id);
      expect(toolSpan?.attributes['gen_ai.tool.call.arguments']).toBe('{"format":"iso"}');

      // Captured the real call, so no "enable intermediate steps" warning.
      const summary = result[0][0].json._miboTrace as IDataObject;
      expect(summary.trace).toMatchObject({ toolCallsSent: 1 });
      expect(summary.recommendations).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'enable_intermediate_steps' })]),
      );
    });

    it('recovers tool args from messageLog when toolInput is empty (real #23501 run)', async () => {
      const agentWithSteps = DEFAULT_WORKFLOW_NODES.map((n) =>
        n.name === 'AI Agent'
          ? { ...n, parameters: { options: { returnIntermediateSteps: true } } }
          : n,
      );
      const { mock } = createMockExecuteFunctions({
        workflowResponse: { nodes: agentWithSteps, connections: DEFAULT_CONNECTIONS },
        itemsProxy: {
          Webhook: [{ body: 'hi' }],
          'HTTP Request': [{ ok: true }],
          'AI Agent': [
            {
              output: 'Here is the date',
              intermediateSteps: [
                {
                  action: {
                    tool: 'Date_Time',
                    toolInput: {},
                    toolCallId: 'tc-1',
                    messageLog: [{ tool_calls: [{ id: 'tc-1', args: { id: 'tc-1' } }] }],
                  },
                  observation: '[{"currentDate":"2026-06-15"}]',
                },
              ],
            },
          ],
        },
      });
      const result = await node.execute.call(mock);

      const payload = mockSendTrace.mock.calls[0][3] as CanonicalTracePayload;
      const agentSpan = payload.spans.find((s) => s.name === 'AI Agent');
      // The tool name is n8n's sanitized 'Date_Time', not the node label 'Date & Time'.
      const toolSpan = payload.spans.find((s) => s.attributes['gen_ai.tool.name'] === 'Date_Time');
      expect(toolSpan).toBeDefined();
      expect(toolSpan?.parent_span_id).toBe(agentSpan?.span_id);
      expect(toolSpan?.attributes['gen_ai.tool.call.arguments']).toBe('{"id":"tc-1"}');

      const summary = result[0][0].json._miboTrace as IDataObject;
      expect(summary.trace).toMatchObject({ toolCallsSent: 1 });
      expect(summary.recommendations).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'enable_intermediate_steps' })]),
      );
    });

    it("warns when an agent has tools wired but 'Return Intermediate Steps' is off", async () => {
      // DEFAULT AI Agent has no returnIntermediateSteps and Date & Time wired as ai_tool.
      const { mock } = createMockExecuteFunctions();
      const result = await node.execute.call(mock);
      const summary = result[0][0].json._miboTrace as IDataObject;

      expect(summary.trace).toMatchObject({ toolCallsSent: 0 });
      expect(summary.recommendations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'enable_intermediate_steps',
            nodes: ['AI Agent'],
          }),
        ]),
      );
    });

    it('does not warn when intermediate steps are on but no tool was called', async () => {
      const agentWithSteps = DEFAULT_WORKFLOW_NODES.map((n) =>
        n.name === 'AI Agent'
          ? { ...n, parameters: { options: { returnIntermediateSteps: true } } }
          : n,
      );
      const { mock } = createMockExecuteFunctions({
        workflowResponse: { nodes: agentWithSteps, connections: DEFAULT_CONNECTIONS },
      });
      const result = await node.execute.call(mock);
      const summary = result[0][0].json._miboTrace as IDataObject;

      expect(summary.trace).toMatchObject({ toolCallsSent: 0 });
      expect(summary.recommendations).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'enable_intermediate_steps' })]),
      );
    });

    it('returns one structured trace summary by default', async () => {
      const { mock } = createMockExecuteFunctions({
        inputItems: [{ json: { message: 'first' } }, { json: { message: 'second' } }],
      });
      const result = await node.execute.call(mock);

      expect(result[0]).toHaveLength(1);
      expect(result[0][0].json.message).toBeUndefined();
      expect(result[0][0].pairedItem).toEqual([{ item: 0 }, { item: 1 }]);

      const summary = result[0][0].json._miboTrace as IDataObject;
      const trace = summary.trace as IDataObject;
      const nodes = trace.nodes as IDataObject[];
      const recommendations = summary.recommendations as IDataObject[];

      expect(summary).toMatchObject({
        sent: true,
        traceId: 'trace-id-123',
        requestId: 'exec-1',
        requestIdSource: 'executionId',
        miboUrl: 'https://app.mibo-ai.com',
      });
      expect(trace).toMatchObject({ spansSent: 4, toolCallsSent: 0 });
      expect(nodes).toEqual(
        expect.arrayContaining([
          { name: 'Webhook', status: 'success', itemsCaptured: 1 },
          { name: 'AI Agent', status: 'success', itemsCaptured: 1 },
          {
            name: 'Google Gemini Chat Model',
            status: 'success',
            itemsCaptured: 0,
          },
        ]),
      );
      expect(recommendations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'enable_intermediate_steps' }),
        ]),
      );
    });

    it('includes every original input item when passthrough is enabled', async () => {
      const { mock } = createMockExecuteFunctions({
        params: { options: { includeInputData: true } },
        inputItems: [{ json: { message: 'first' } }, { json: { message: 'second' } }],
      });
      const result = await node.execute.call(mock);

      expect(result[0]).toHaveLength(2);
      expect(result[0][0].json.message).toBe('first');
      expect(result[0][1].json.message).toBe('second');
      expect((result[0][0].json._miboTrace as IDataObject).trace).toBeDefined();
    });

    it('redacts captured values before sending while preserving opted-in input items', async () => {
      const inputItems = [{ json: { password: 'workflow-password', keep: 'unchanged' } }];
      const { mock } = createMockExecuteFunctions({
        inputItems,
        params: { options: { includeInputData: true } },
        itemsProxy: {
          Webhook: [{ body: 'safe' }],
          'HTTP Request': [{ headers: { authorization: 'Bearer secret' }, password: 'output-secret' }],
          'AI Agent': [{ output: 'done' }],
        },
      });
      const result = await node.execute.call(mock);

      const payload = mockSendTrace.mock.calls[0][3] as CanonicalTracePayload;
      const httpSpan = payload.spans.find((span) => span.name === 'HTTP Request');
      expect(httpSpan?.attributes['n8n.node.output']).toContain('[REDACTED]');
      expect(result[0][0].json).toMatchObject(inputItems[0].json);
      expect((result[0][0].json._miboTrace as IDataObject).redaction).toMatchObject({
        automaticEnabled: true,
        manualEnabled: false,
      });
    });

    it('declares public sensitive-data protection controls', () => {
      const properties = node.description.properties;
      expect(properties.find((property) => property.name === 'automaticRedaction')?.displayName).toBe(
        'Automatic Sensitive Data Protection',
      );
      expect(properties.find((property) => property.name === 'manualRedaction')?.displayName).toBe(
        'Custom Sensitive Data Protection',
      );
      expect(properties.find((property) => property.name === 'redactionFields')?.displayName).toBe(
        'Fields to Protect',
      );
      expect(properties.find((property) => property.name === 'requestId')?.displayName).toBe(
        'Request ID Override',
      );
      const options = properties.find((property) => property.name === 'options');
      expect(options?.options?.find((option) => option.name === 'includeInputData')).toMatchObject({
        displayName: 'Include Input Data in Output',
        default: false,
      });
      expect(properties.find((property) => property.name === 'hostedDataProcessingNotice')?.type).toBe(
        'notice',
      );
      expect(properties.find((property) => property.name === 'automaticRedaction')?.hint).toContain(
        'Enabled by default',
      );
      expect(properties.find((property) => property.name === 'manualRedaction')?.hint).toContain(
        'deep search',
      );
      expect(node.description.hints).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: 'Trace sent successfully to Mibo. Access it at https://app.mibo-ai.com.',
            whenToDisplay: 'afterExecution',
            location: 'outputPane',
          }),
        ]),
      );
    });

    it('applies manual redaction to tool arguments without enabling automatic rules', async () => {
      const agentWithSteps = DEFAULT_WORKFLOW_NODES.map((n) =>
        n.name === 'AI Agent'
          ? { ...n, parameters: { options: { returnIntermediateSteps: true } } }
          : n,
      );
      const { mock } = createMockExecuteFunctions({
        params: {
          automaticRedaction: false,
          manualRedaction: true,
          redactionFields: { fieldPaths: [{ path: 'email' }] },
        },
        workflowResponse: { nodes: agentWithSteps, connections: DEFAULT_CONNECTIONS },
        itemsProxy: {
          Webhook: [{ body: 'hi' }],
          'HTTP Request': [{ ok: true }],
          'AI Agent': [
            {
              output: 'done',
              intermediateSteps: [
                { action: { tool: 'lookup', toolInput: { email: 'private@example.com' } } },
              ],
            },
          ],
        },
      });
      await node.execute.call(mock);

      const payload = mockSendTrace.mock.calls[0][3] as CanonicalTracePayload;
      const toolSpan = payload.spans.find((span) => span.attributes['gen_ai.tool.name'] === 'lookup');
      expect(toolSpan?.attributes['gen_ai.tool.call.arguments']).toBe(
        '{"email":"[REDACTED]"}',
      );
    });

    it('refuses invalid manual paths before sending a trace', async () => {
      const { mock } = createMockExecuteFunctions({
        params: {
          manualRedaction: true,
          redactionFields: { fieldPaths: [{ path: 'customer..email' }] },
        },
      });

      await expect(node.execute.call(mock)).rejects.toThrow(NodeOperationError);
      expect(mockSendTrace).not.toHaveBeenCalled();
    });

    it('returns a structured recommendation for nodes without output', async () => {
      const { mock } = createMockExecuteFunctions({
        itemsProxy: { Webhook: [{ body: 'data' }], 'HTTP Request': [{ ok: true }] },
      });
      const result = await node.execute.call(mock);
      const summary = result[0][0].json._miboTrace as IDataObject;
      const trace = summary.trace as IDataObject;

      expect(trace.nodes).toEqual(
        expect.arrayContaining([
          { name: 'AI Agent', status: 'skipped', itemsCaptured: 0 },
        ]),
      );
      expect(summary.recommendations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'nodes_not_executed',
            nodes: ['AI Agent'],
          }),
        ]),
      );

      const payload = mockSendTrace.mock.calls[0][3] as CanonicalTracePayload;
      const agent = payload.spans.find((span) => span.name === 'AI Agent');
      expect(agent?.attributes['n8n.node.status']).toBe('skipped');
    });

    it('returns a structured recommendation when the payload approaches the limit', async () => {
      const { mock } = createMockExecuteFunctions({
        itemsProxy: {
          Webhook: [{ body: 'x'.repeat(Math.ceil(MAX_PAYLOAD_SIZE_BYTES * 0.81)) }],
          'HTTP Request': [{ response: 'ok' }],
          'AI Agent': [{ output: 'response text' }],
        },
      });
      const result = await node.execute.call(mock);
      const summary = result[0][0].json._miboTrace as IDataObject;
      const trace = summary.trace as IDataObject;

      expect(trace.payloadSize).toMatch(/MB$/);
      expect(summary.recommendations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'payload_size',
            message: expect.stringContaining('close to the 10MB limit'),
          }),
        ]),
      );
    });
  });

  describe('workflow source resolution', () => {
    it('uses n8n REST API when n8nApiKey is configured', async () => {
      const { mock, httpRequest } = createMockExecuteFunctions();
      await node.execute.call(mock);
      expect(httpRequest).toHaveBeenCalledOnce();
      const args = httpRequest.mock.calls[0][0] as unknown as {
        headers: Record<string, string>;
        url: string;
      };
      expect(args.url).toContain('/workflows/wf-123');
      expect(args.headers['X-N8N-API-KEY']).toBe('fake-n8n-key');
    });

    it('falls back to upstream Get Workflow node when no n8nApiKey', async () => {
      const { mock, httpRequest } = createMockExecuteFunctions({
        credentials: { apiKey: 'test-api-key' },
        inputItems: [
          { json: { nodes: DEFAULT_WORKFLOW_NODES, connections: DEFAULT_CONNECTIONS } },
        ],
      });
      await node.execute.call(mock);
      expect(httpRequest).not.toHaveBeenCalled();
      const payload = mockSendTrace.mock.calls[0][3] as CanonicalTracePayload;
      expect(payload.spans.map((s) => s.name).sort()).toEqual([
        'AI Agent',
        'Google Gemini Chat Model',
        'HTTP Request',
        'Webhook',
      ]);
    });

    it('throws actionable error with docs link when neither source is available', async () => {
      const { mock } = createMockExecuteFunctions({
        credentials: { apiKey: 'test-api-key' },
        inputItems: [{ json: { message: 'hello' } }],
      });
      await expect(node.execute.call(mock)).rejects.toThrow(NodeOperationError);
      await expect(node.execute.call(mock)).rejects.toThrow(/Cannot enumerate workflow nodes/);
    });
  });

  describe('request id resolution', () => {
    it('prefers manual override', async () => {
      const { mock } = createMockExecuteFunctions({ params: { requestId: 'manual-id' } });
      await node.execute.call(mock);
      expect(mockSendTrace.mock.calls[0][5]).toBe('manual-id');
    });

    it('auto-detects x-request-id from input headers', async () => {
      const { mock } = createMockExecuteFunctions({
        inputItems: [{ json: { headers: { 'x-request-id': 'header-id' } } }],
      });
      const result = await node.execute.call(mock);
      expect(mockSendTrace.mock.calls[0][5]).toBe('header-id');
      expect(result[0][0].json._miboTrace).toMatchObject({
        requestId: 'header-id',
        requestIdSource: 'x-request-id',
      });
    });

    it('falls back to executionId when nothing else is found', async () => {
      const { mock } = createMockExecuteFunctions({ executionId: 'exec-xyz' });
      await node.execute.call(mock);
      expect(mockSendTrace.mock.calls[0][5]).toBe('exec-xyz');
    });
  });

  describe('validations', () => {
    it('throws when platformId is not a valid UUID', async () => {
      const { mock } = createMockExecuteFunctions({ params: { platformId: 'not-a-uuid' } });
      await expect(node.execute.call(mock)).rejects.toThrow('Agent ID must be a valid UUID');
    });

    it('throws when no node has executed data', async () => {
      const { mock } = createMockExecuteFunctions({ itemsProxy: {} });
      await expect(node.execute.call(mock)).rejects.toThrow('No executed nodes were captured');
    });
  });

  describe('error handling', () => {
    it('throws NodeApiError with actionable description when continueOnFail is false', async () => {
      mockSendTrace.mockRejectedValue({ message: 'connect ECONNREFUSED', code: 'ECONNREFUSED' });
      const { mock } = createMockExecuteFunctions();
      await expect(node.execute.call(mock)).rejects.toThrow(NodeApiError);
      await expect(node.execute.call(mock)).rejects.toMatchObject({
        description: expect.stringContaining('Mibo Testing API Key'),
      });
    });

    it('preserves the HTTP status code on the thrown NodeApiError', async () => {
      mockSendTrace.mockRejectedValue({
        message: 'Request failed',
        response: { status: 401 },
      });
      const { mock } = createMockExecuteFunctions();
      await expect(node.execute.call(mock)).rejects.toMatchObject({ httpCode: '401' });
    });

    it('returns trace with sent=false when continueOnFail is true', async () => {
      mockSendTrace.mockRejectedValue({ message: 'Connection refused' });
      const { mock } = createMockExecuteFunctions({ continueOnFail: true });
      const result = await node.execute.call(mock);
      const trace = result[0][0].json._miboTrace as IDataObject;
      expect(trace.sent).toBe(false);
      expect(trace.error).toBe('Connection refused');
    });

    it('returns only the failed trace summary by default', async () => {
      mockSendTrace.mockRejectedValue({ message: 'Connection refused' });
      const { mock } = createMockExecuteFunctions({
        continueOnFail: true,
        inputItems: [
          { json: { customer: 'hidden-from-output' } },
          { json: { customer: 'also-hidden' } },
        ],
      });
      const result = await node.execute.call(mock);

      expect(result[0]).toHaveLength(1);
      expect(result[0][0].json.customer).toBeUndefined();
      expect(result[0][0].pairedItem).toEqual([{ item: 0 }, { item: 1 }]);
      expect(result[0][0].json._miboTrace).toMatchObject({
        sent: false,
        error: 'Connection refused',
      });
    });
  });
});
