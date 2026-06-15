import type { IExecuteFunctions, INode } from 'n8n-workflow';

import { NodeOperationError } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import {
  buildCanonicalTracePayload,
  buildMetadata,
  extractToolCalls,
} from '../nodes/MiboTesting/builders';
import type { SpanSource } from '../nodes/MiboTesting/types';

const mockNode = {
  getNode: () => ({ name: 'Test Node' }) as INode,
} as unknown as IExecuteFunctions;

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('buildMetadata', () => {
  const base = {
    workflowId: 'wf-1',
    workflowName: 'Test Workflow',
    timestamp: '2025-01-01T00:00:00.000Z',
  };

  it('returns base metadata when includeMetadata is false', () => {
    const result = buildMetadata(
      base.workflowId,
      base.workflowName,
      base.timestamp,
      false,
      {},
      mockNode,
    );
    expect(result).toEqual({
      workflowId: 'wf-1',
      workflowName: 'Test Workflow',
      timestamp: '2025-01-01T00:00:00.000Z',
    });
  });

  it('returns base metadata when includeMetadata is true but no fields', () => {
    const result = buildMetadata(
      base.workflowId,
      base.workflowName,
      base.timestamp,
      true,
      {},
      mockNode,
    );
    expect(result).toEqual({
      workflowId: 'wf-1',
      workflowName: 'Test Workflow',
      timestamp: '2025-01-01T00:00:00.000Z',
    });
  });

  it('includes environment and version when provided', () => {
    const config = { fields: { environment: 'staging', version: '2.0.0' } };
    const result = buildMetadata(
      base.workflowId,
      base.workflowName,
      base.timestamp,
      true,
      config,
      mockNode,
    );
    expect(result.environment).toBe('staging');
    expect(result.version).toBe('2.0.0');
  });

  it('merges additionalFields from JSON string', () => {
    const config = { fields: { additionalFields: '{"team":"backend","feature":"auth"}' } };
    const result = buildMetadata(
      base.workflowId,
      base.workflowName,
      base.timestamp,
      true,
      config,
      mockNode,
    );
    expect(result.team).toBe('backend');
    expect(result.feature).toBe('auth');
  });

  it('merges additionalFields from object', () => {
    const config = { fields: { additionalFields: { team: 'backend' } } };
    const result = buildMetadata(
      base.workflowId,
      base.workflowName,
      base.timestamp,
      true,
      config,
      mockNode,
    );
    expect(result.team).toBe('backend');
  });

  it('throws on invalid JSON in additionalFields', () => {
    const config = { fields: { additionalFields: '{invalid json}' } };
    expect(() =>
      buildMetadata(base.workflowId, base.workflowName, base.timestamp, true, config, mockNode),
    ).toThrow(NodeOperationError);
  });
});

describe('buildCanonicalTracePayload', () => {
  const sources: SpanSource[] = [
    {
      nodeName: 'Webhook',
      type: 'n8n-nodes-base.webhook',
      status: 'success',
      items: [{ body: { question: 'hi' } }],
    },
    {
      nodeName: 'HTTP Request',
      type: 'n8n-nodes-base.httpRequest',
      status: 'success',
      items: [{ response: 'ok' }],
      parameters: { url: 'https://example.com', method: 'GET' },
    },
    {
      nodeName: 'AI Agent',
      type: '@n8n/n8n-nodes-langchain.agent',
      status: 'success',
      items: [{ output: 'reply' }],
    },
  ];

  const parentMap = {
    'HTTP Request': 'Webhook',
    'AI Agent': 'HTTP Request',
  };

  it('emits one span per source, names match display, parents wired through internal span_ids', () => {
    const payload = buildCanonicalTracePayload(sources, 'wf-1', { workflowId: 'wf-1' }, '', parentMap);
    expect(payload.spans).toHaveLength(3);

    const [webhook, http, agent] = payload.spans;
    expect(webhook.name).toBe('Webhook');
    expect(http.name).toBe('HTTP Request');
    expect(agent.name).toBe('AI Agent');

    expect(webhook.parent_span_id).toBeNull();
    expect(http.parent_span_id).toBe(webhook.span_id);
    expect(agent.parent_span_id).toBe(http.span_id);

    for (const s of payload.spans) {
      expect(s.span_id).toMatch(UUID_RX);
    }
  });

  it('encodes single-item output as object, multi-item as array, both JSON-stringified', () => {
    const multi: SpanSource[] = [
      { nodeName: 'A', type: 't', status: 'success', items: [{ x: 1 }] },
      { nodeName: 'B', type: 't', status: 'success', items: [{ x: 1 }, { x: 2 }] },
    ];
    const payload = buildCanonicalTracePayload(multi, 'wf-1', {}, '', {});
    expect(payload.spans[0].attributes['n8n.node.output']).toBe('{"x":1}');
    expect(payload.spans[1].attributes['n8n.node.output']).toBe('[{"x":1},{"x":2}]');
  });

  it('marks skipped sources without output attribute', () => {
    const skipped: SpanSource[] = [
      { nodeName: 'NotExecuted', type: 't', status: 'skipped', items: [] },
    ];
    const span = buildCanonicalTracePayload(skipped, 'wf-1', {}, '', {}).spans[0];
    expect(span.attributes['n8n.node.status']).toBe('skipped');
    expect(span.attributes['n8n.node.output']).toBeUndefined();
  });

  it('emits tool-call child spans parented to their agent', () => {
    const sources: SpanSource[] = [
      { nodeName: 'AI Agent', type: '@n8n/n8n-nodes-langchain.agent', status: 'success', items: [{ output: 'ok' }] },
    ];
    const toolCalls = [
      { name: 'search', arguments: { q: 'rsi' }, agentNodeName: 'AI Agent' },
      { name: 'no_args_tool', agentNodeName: 'AI Agent' },
    ];
    const payload = buildCanonicalTracePayload(sources, 'wf-1', {}, '', {}, toolCalls);

    const agent = payload.spans.find((s) => s.name === 'AI Agent');
    const search = payload.spans.find((s) => s.name === 'search');
    expect(search?.attributes['gen_ai.tool.name']).toBe('search');
    expect(search?.attributes['gen_ai.tool.call.arguments']).toBe('{"q":"rsi"}');
    expect(search?.parent_span_id).toBe(agent?.span_id);

    // No arguments resolved → the attribute is omitted, the call still emitted.
    const noArgs = payload.spans.find((s) => s.name === 'no_args_tool');
    expect(noArgs?.attributes['gen_ai.tool.name']).toBe('no_args_tool');
    expect(noArgs?.attributes['gen_ai.tool.call.arguments']).toBeUndefined();
  });

  it('serializes BigInt parameters without throwing', () => {
    const withBigint: SpanSource[] = [
      {
        nodeName: 'A',
        type: 't',
        status: 'success',
        items: [{ x: 1 }],
        parameters: { limit: 9007199254740993n as unknown as number },
      },
    ];
    const span = buildCanonicalTracePayload(withBigint, 'wf-1', {}, '', {}).spans[0];
    expect(typeof span.attributes['n8n.node.parameters']).toBe('string');
    expect(span.attributes['n8n.node.parameters']).toContain('9007199254740993');
  });

  it('does not self-parent on a self-looped connection', () => {
    const looped: SpanSource[] = [
      { nodeName: 'A', type: 't', status: 'success', items: [{ x: 1 }] },
    ];
    const span = buildCanonicalTracePayload(looped, 'wf-1', {}, '', { A: 'A' }).spans[0];
    expect(span.parent_span_id).toBeNull();
  });

  it('walks past filtered ancestors to wire the nearest captured parent', () => {
    const flow: SpanSource[] = [
      { nodeName: 'Webhook', type: 't', status: 'success', items: [{ x: 1 }] },
      { nodeName: 'AI Agent', type: 't', status: 'success', items: [{ x: 1 }] },
    ];
    // Sticky was filtered out before reaching the builder; AI Agent still hangs off Webhook.
    const map = { Sticky: 'Webhook', 'AI Agent': 'Sticky' };
    const spans = buildCanonicalTracePayload(flow, 'wf-1', {}, '', map).spans;
    const webhook = spans.find((s) => s.name === 'Webhook');
    const agent = spans.find((s) => s.name === 'AI Agent');
    expect(agent?.parent_span_id).toBe(webhook?.span_id);
  });

  it('passes platformId when provided', () => {
    const p = buildCanonicalTracePayload(
      sources,
      'wf-1',
      {},
      '019469a5-cb6b-7c5e-9e6a-1a2b3c4d5e6f',
      parentMap,
    );
    expect(p.platformId).toBe('019469a5-cb6b-7c5e-9e6a-1a2b3c4d5e6f');
  });

  it('omits platformId when empty', () => {
    const p = buildCanonicalTracePayload(sources, 'wf-1', {}, '', parentMap);
    expect(p.platformId).toBeUndefined();
  });

  it('span.name uses display name verbatim (the Custom API contract)', () => {
    const odd: SpanSource[] = [
      { nodeName: 'My Custom AI Agent (v2)', type: 'x', status: 'success', items: [{ y: 1 }] },
    ];
    const span = buildCanonicalTracePayload(odd, 'wf-1', {}, '', {}).spans[0];
    expect(span.name).toBe('My Custom AI Agent (v2)');
  });
});

describe('extractToolCalls', () => {
  const agentSource = (intermediateSteps: unknown): SpanSource => ({
    nodeName: 'AI Agent',
    type: '@n8n/n8n-nodes-langchain.agent',
    status: 'success',
    items: [{ output: 'done', intermediateSteps }] as SpanSource['items'],
  });

  it('pulls tool name and toolInput from each step', () => {
    const calls = extractToolCalls([
      agentSource([{ action: { tool: 'search', toolInput: { q: 'rsi' } }, observation: 'x' }]),
    ]);
    expect(calls).toEqual([{ name: 'search', arguments: { q: 'rsi' }, agentNodeName: 'AI Agent' }]);
  });

  it('falls back to messageLog tool_calls args when toolInput is empty (issue #23501)', () => {
    const calls = extractToolCalls([
      agentSource([
        {
          action: {
            tool: 'Calculator',
            toolInput: {},
            toolCallId: 'call_1',
            messageLog: [{ tool_calls: [{ id: 'call_1', args: { input: '5*343' } }] }],
          },
          observation: '1715',
        },
      ]),
    ]);
    expect(calls[0].arguments).toEqual({ input: '5*343' });
  });

  it('emits the call with undefined arguments when none can be resolved', () => {
    const calls = extractToolCalls([
      agentSource([{ action: { tool: 'ping', toolInput: {} }, observation: 'pong' }]),
    ]);
    expect(calls).toEqual([{ name: 'ping', arguments: undefined, agentNodeName: 'AI Agent' }]);
  });

  // Verbatim shape captured from a real n8n run (Date & Time tool, exec #5): toolInput
  // arrives empty (issue #23501) and the args live in messageLog[].tool_calls[].args,
  // keyed by toolCallId. The tool name is n8n's sanitized "Date_Time", not the node's
  // display name "Date & Time".
  it('parses the real n8n intermediateSteps shape, recovering args from messageLog', () => {
    const realStep = {
      action: {
        tool: 'Date_Time',
        toolInput: {},
        log: 'Calling Date_Time with input: {"id":"68dee6d5-5183-42bc-a5c6-9280ffe5daf8"}',
        messageLog: [
          {
            lc_serializable: true,
            content: 'Calling Date_Time with input: {"id":"68dee6d5-5183-42bc-a5c6-9280ffe5daf8"}',
            type: 'ai',
            tool_calls: [
              {
                id: '68dee6d5-5183-42bc-a5c6-9280ffe5daf8',
                name: 'Date_Time',
                args: { id: '68dee6d5-5183-42bc-a5c6-9280ffe5daf8' },
                type: 'tool_call',
              },
            ],
            invalid_tool_calls: [],
          },
        ],
        toolCallId: '68dee6d5-5183-42bc-a5c6-9280ffe5daf8',
        type: 'tool_call',
      },
      observation: '[{"currentDate":"2026-06-15T16:48:38.986-03:00"}]',
    };
    expect(extractToolCalls([agentSource([realStep])])).toEqual([
      {
        name: 'Date_Time',
        arguments: { id: '68dee6d5-5183-42bc-a5c6-9280ffe5daf8' },
        agentNodeName: 'AI Agent',
      },
    ]);
  });

  it('matches the right tool_call by toolCallId when several are present', () => {
    const action = {
      tool: 'second',
      toolInput: {},
      toolCallId: 'id-2',
      messageLog: [
        {
          tool_calls: [
            { id: 'id-1', args: { a: 1 } },
            { id: 'id-2', args: { b: 2 } },
          ],
        },
      ],
    };
    const calls = extractToolCalls([agentSource([{ action, observation: 'x' }])]);
    expect(calls[0].arguments).toEqual({ b: 2 });
  });

  it('ignores sources without intermediateSteps and skipped sources', () => {
    const skipped: SpanSource = {
      nodeName: 'AI Agent',
      type: 'agent',
      status: 'skipped',
      items: [],
    };
    const plain: SpanSource = {
      nodeName: 'HTTP Request',
      type: 'http',
      status: 'success',
      items: [{ ok: true }],
    };
    expect(extractToolCalls([skipped, plain])).toEqual([]);
  });
});
