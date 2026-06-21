import type { IDataObject, IExecuteFunctions, INode, INodeExecutionData } from 'n8n-workflow';

import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

      const trace = result[0][0].json._miboTrace as IDataObject;
      expect(trace.nodesNotExecuted).toBeUndefined();
      expect(trace.warning).toBeUndefined();
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
      const trace = result[0][0].json._miboTrace as IDataObject;
      expect(trace.toolCallsSent).toBe(1);
      expect(trace.toolCallsWarning).toBeUndefined();
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

      const trace = result[0][0].json._miboTrace as IDataObject;
      expect(trace.toolCallsSent).toBe(1);
      expect(trace.toolCallsWarning).toBeUndefined();
    });

    it("warns when an agent has tools wired but 'Return Intermediate Steps' is off", async () => {
      // DEFAULT AI Agent has no returnIntermediateSteps and Date & Time wired as ai_tool.
      const { mock } = createMockExecuteFunctions();
      const result = await node.execute.call(mock);
      const trace = result[0][0].json._miboTrace as IDataObject;

      expect(trace.toolCallsSent).toBe(0);
      expect(trace.toolCallsWarning).toContain('Return Intermediate Steps');
      expect(trace.toolCallsWarning).toContain('AI Agent');
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
      const trace = result[0][0].json._miboTrace as IDataObject;

      expect(trace.toolCallsSent).toBe(0);
      expect(trace.toolCallsWarning).toBeUndefined();
    });

    it('passes input items through unchanged with _miboTrace appended', async () => {
      const { mock } = createMockExecuteFunctions({
        inputItems: [{ json: { message: 'first' } }, { json: { message: 'second' } }],
      });
      const result = await node.execute.call(mock);
      expect(result[0]).toHaveLength(2);
      expect(result[0][0].json.message).toBe('first');
      expect(result[0][1].json.message).toBe('second');
      expect((result[0][0].json._miboTrace as IDataObject).sent).toBe(true);
    });

    it('marks unreachable nodes as skipped and surfaces them in _miboTrace.nodesNotExecuted', async () => {
      const { mock } = createMockExecuteFunctions({
        itemsProxy: { Webhook: [{ body: 'data' }], 'HTTP Request': [{ ok: true }] },
      });
      const result = await node.execute.call(mock);
      const trace = result[0][0].json._miboTrace as IDataObject;
      expect(trace.nodesNotExecuted).toEqual(['AI Agent']);

      const payload = mockSendTrace.mock.calls[0][3] as CanonicalTracePayload;
      const agent = payload.spans.find((s) => s.name === 'AI Agent');
      expect(agent?.attributes['n8n.node.status']).toBe('skipped');
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
      await node.execute.call(mock);
      expect(mockSendTrace.mock.calls[0][5]).toBe('header-id');
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
  });
});
