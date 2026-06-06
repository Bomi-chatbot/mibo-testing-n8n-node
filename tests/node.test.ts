import type { OptimizedTracePayload, TracePayload } from '../nodes/MiboTesting/types';
import type { IDataObject, IExecuteFunctions, INode, INodeExecutionData } from 'n8n-workflow';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeOperationError } from 'n8n-workflow';

import { MiboTesting } from '../nodes/MiboTesting/MiboTesting.node';

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
  inputItems?: INodeExecutionData[];
  itemsProxy?: Record<string, IDataObject[]>;
  nodeProxy?: Record<string, { json: IDataObject }>;
  params?: Record<string, unknown>;
}

function createMockExecuteFunctions(overrides: MockOverrides = {}) {
  const inputItems: INodeExecutionData[] = overrides.inputItems || [
    { json: { message: 'hello' } },
  ];

  const nodeParams: Record<string, unknown> = {
    useGetWorkflow: false,
    targetNodes: 'Webhook, AI Agent',
    requestId: '',
    platformId: '',
    includeMetadata: false,
    metadata: {},
    options: {},
    nodeFilterPreset: 'all',
    customTargetNodes: '',
    ...overrides.params,
  };

  const nodeProxy: Record<string, { json: IDataObject }> = overrides.nodeProxy || {
    Webhook: { json: { headers: { 'content-type': 'application/json' }, body: 'hi' } },
    'AI Agent': { json: { output: 'response text' } },
  };

  const itemsProxy: Record<string, IDataObject[]> = overrides.itemsProxy || {
    Webhook: [{ headers: { 'content-type': 'application/json' }, body: 'hi' }],
    'AI Agent': [{ output: 'response text' }],
  };

  const mock = {
    getInputData: vi.fn(() => inputItems),
    getNode: vi.fn(() => ({ name: 'Mibo Testing' }) as INode),
    getNodeParameter: vi.fn((name: string) => nodeParams[name]),
    getCredentials: vi.fn(async () => ({
      apiKey: 'test-api-key',
      serverUrl: 'https://api.mibo-ai.com',
    })),
    getWorkflow: vi.fn(() => ({ id: 'wf-123', name: 'Test Workflow' })),
    getWorkflowDataProxy: vi.fn(() => ({
      $node: nodeProxy,
      $items: (nodeName: string) => {
        const items = itemsProxy[nodeName];
        if (!items) throw new Error(`Node ${nodeName} not found`);
        return items.map((json) => ({ json }));
      },
    })),
    continueOnFail: vi.fn(() => overrides.continueOnFail || false),
    helpers: {
      httpRequest: vi.fn(),
    },
  };

  return mock as unknown as IExecuteFunctions;
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

  describe('manual mode', () => {
    it('sends trace and returns passthrough with _miboTrace', async () => {
      const mock = createMockExecuteFunctions();
      const executeResult = await node.execute.call(mock);

      expect(mockSendTrace).toHaveBeenCalledOnce();
      expect(executeResult).toHaveLength(1);
      expect(executeResult[0]).toHaveLength(1);

      const output = executeResult[0][0].json;
      expect(output.message).toBe('hello');
      expect(output._miboTrace).toBeDefined();

      const trace = output._miboTrace as IDataObject;
      expect(trace.sent).toBe(true);
      expect(trace.traceId).toBe('trace-id-123');
    });

    it('preserves all input items in passthrough', async () => {
      const mock = createMockExecuteFunctions({
        inputItems: [
          { json: { message: 'first' } },
          { json: { message: 'second' } },
        ],
      });

      const result = await node.execute.call(mock);
      expect(result[0]).toHaveLength(2);
      expect(result[0][0].json.message).toBe('first');
      expect(result[0][1].json.message).toBe('second');
      expect((result[0][0].json._miboTrace as IDataObject).sent).toBe(true);
      expect((result[0][1].json._miboTrace as IDataObject).sent).toBe(true);
    });
  });

  describe('get workflow mode', () => {
    const workflowNodes = [
      { name: 'Webhook', type: 'n8n-nodes-base.webhook' },
      { name: 'AI Agent', type: 'n8n-nodes-base.ai' },
      { name: 'Set', type: 'n8n-nodes-base.set' },
      { name: 'Sticky Note', type: 'n8n-nodes-base.stickyNote' },
    ];

    it('captures all nodes with "all" filter (excluding auto-excluded)', async () => {
      const mock = createMockExecuteFunctions({
        inputItems: [{ json: { nodes: workflowNodes } }],
        params: { useGetWorkflow: true, nodeFilterPreset: 'all' },
        nodeProxy: {
          Webhook: { json: { body: 'data' } },
          'AI Agent': { json: { output: 'text' } },
          Set: { json: { value: 1 } },
        },
        itemsProxy: {
          Webhook: [{ body: 'data' }],
          'AI Agent': [{ output: 'text' }],
          Set: [{ value: 1 }],
        },
      });

      const result = await node.execute.call(mock);
      expect(result[0]).toHaveLength(1);

      const traceCall = mockSendTrace.mock.calls[0];
      const payload = traceCall[3] as OptimizedTracePayload;
      expect(payload.status).toBeDefined();
      expect(payload.data).toBeDefined();
    });

    it('filters AI nodes with "ai" filter', async () => {
      const mock = createMockExecuteFunctions({
        inputItems: [{ json: { nodes: workflowNodes } }],
        params: { useGetWorkflow: true, nodeFilterPreset: 'ai' },
        nodeProxy: {
          'AI Agent': { json: { output: 'text' } },
        },
        itemsProxy: {
          'AI Agent': [{ output: 'text' }],
        },
      });

      const result = await node.execute.call(mock);
      expect(result[0]).toHaveLength(1);

      const traceCall = mockSendTrace.mock.calls[0];
      const payload = traceCall[3] as OptimizedTracePayload;
      expect(Object.keys(payload.data)).toEqual(['AI Agent']);
    });

    it('uses custom node names with "custom" filter', async () => {
      const mock = createMockExecuteFunctions({
        inputItems: [{ json: { nodes: workflowNodes } }],
        params: {
          useGetWorkflow: true,
          nodeFilterPreset: 'custom',
          customTargetNodes: 'Webhook',
        },
        nodeProxy: {
          Webhook: { json: { body: 'data' } },
        },
        itemsProxy: {
          Webhook: [{ body: 'data' }],
        },
      });

      const result = await node.execute.call(mock);
      const traceCall = mockSendTrace.mock.calls[0];
      const payload = traceCall[3] as OptimizedTracePayload;
      expect(Object.keys(payload.data)).toEqual(['Webhook']);
    });
  });

  describe('validations', () => {
    it('throws when no target nodes configured', async () => {
      const mock = createMockExecuteFunctions({
        params: { targetNodes: '' },
      });

      await expect(node.execute.call(mock)).rejects.toThrow(NodeOperationError);
      await expect(node.execute.call(mock)).rejects.toThrow('No target nodes configured');
    });

    it('throws when platformId is invalid UUID', async () => {
      const mock = createMockExecuteFunctions({
        params: { platformId: 'not-a-uuid' },
      });

      await expect(node.execute.call(mock)).rejects.toThrow('Agent ID must be a valid UUID');
    });

    it('throws when get workflow mode has no nodes in input', async () => {
      const mock = createMockExecuteFunctions({
        inputItems: [{ json: {} }],
        params: { useGetWorkflow: true },
      });

      await expect(node.execute.call(mock)).rejects.toThrow('No workflow nodes found');
    });
  });

  describe('error handling', () => {
    it('throws NodeOperationError when continueOnFail is false', async () => {
      mockSendTrace.mockRejectedValue({ message: 'Connection refused' });
      const mock = createMockExecuteFunctions();

      await expect(node.execute.call(mock)).rejects.toThrow('Failed to send trace');
    });

    it('returns trace with sent=false when continueOnFail is true', async () => {
      mockSendTrace.mockRejectedValue({ message: 'Connection refused' });
      const mock = createMockExecuteFunctions({ continueOnFail: true });

      const result = await node.execute.call(mock);
      expect(result[0]).toHaveLength(1);

      const trace = result[0][0].json._miboTrace as IDataObject;
      expect(trace.sent).toBe(false);
      expect(trace.error).toBe('Connection refused');
    });
  });

  describe('request ID detection', () => {
    it('uses manual requestId when provided', async () => {
      const mock = createMockExecuteFunctions({
        params: { requestId: 'manual-req-id' },
      });

      await node.execute.call(mock);
      const traceCall = mockSendTrace.mock.calls[0];
      expect(traceCall[5]).toBe('manual-req-id');
    });

    it('auto-detects requestId from input data headers', async () => {
      const mock = createMockExecuteFunctions({
        inputItems: [{ json: { headers: { 'x-request-id': 'auto-detected-id' } } }],
      });

      await node.execute.call(mock);
      const traceCall = mockSendTrace.mock.calls[0];
      expect(traceCall[5]).toBe('auto-detected-id');
    });
  });
});
