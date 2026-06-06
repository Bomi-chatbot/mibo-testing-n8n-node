import type { IExecuteFunctions, INode } from 'n8n-workflow';

import { NodeOperationError } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { buildCanonicalTracePayload, buildMetadata } from '../nodes/MiboTesting/builders';
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
