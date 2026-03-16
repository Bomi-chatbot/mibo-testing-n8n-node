import type { IExecuteFunctions, INode } from 'n8n-workflow';

import { describe, expect, it, vi } from 'vitest';
import { NodeOperationError } from 'n8n-workflow';

import {
  buildMetadata,
  buildOptimizedTracePayload,
  buildTracePayload,
} from '../nodes/MiboTesting/builders';

const mockNode = {
  getNode: () => ({ name: 'Test Node' }) as INode,
} as unknown as IExecuteFunctions;

describe('buildMetadata', () => {
  const base = {
    workflowId: 'wf-1',
    workflowName: 'Test Workflow',
    timestamp: '2025-01-01T00:00:00.000Z',
  };

  it('returns base metadata when includeMetadata is false', () => {
    const result = buildMetadata(base.workflowId, base.workflowName, base.timestamp, false, {}, mockNode);
    expect(result).toEqual({
      workflowId: 'wf-1',
      workflowName: 'Test Workflow',
      timestamp: '2025-01-01T00:00:00.000Z',
    });
  });

  it('returns base metadata when includeMetadata is true but no fields', () => {
    const result = buildMetadata(base.workflowId, base.workflowName, base.timestamp, true, {}, mockNode);
    expect(result).toEqual({
      workflowId: 'wf-1',
      workflowName: 'Test Workflow',
      timestamp: '2025-01-01T00:00:00.000Z',
    });
  });

  it('includes environment and version when provided', () => {
    const config = { fields: { environment: 'staging', version: '2.0.0' } };
    const result = buildMetadata(base.workflowId, base.workflowName, base.timestamp, true, config, mockNode);
    expect(result.environment).toBe('staging');
    expect(result.version).toBe('2.0.0');
  });

  it('merges additionalFields from JSON string', () => {
    const config = { fields: { additionalFields: '{"team":"backend","feature":"auth"}' } };
    const result = buildMetadata(base.workflowId, base.workflowName, base.timestamp, true, config, mockNode);
    expect(result.team).toBe('backend');
    expect(result.feature).toBe('auth');
  });

  it('merges additionalFields from object', () => {
    const config = { fields: { additionalFields: { team: 'backend' } } };
    const result = buildMetadata(base.workflowId, base.workflowName, base.timestamp, true, config, mockNode);
    expect(result.team).toBe('backend');
  });

  it('throws on invalid JSON in additionalFields', () => {
    const config = { fields: { additionalFields: '{invalid json}' } };
    expect(() =>
      buildMetadata(base.workflowId, base.workflowName, base.timestamp, true, config, mockNode),
    ).toThrow(NodeOperationError);
  });
});

describe('buildTracePayload', () => {
  it('builds basic payload', () => {
    const result = buildTracePayload(
      [{ input: 'hello' }],
      'wf-1',
      { workflowId: 'wf-1' },
      '',
      '',
    );
    expect(result.data.input).toEqual([{ input: 'hello' }]);
    expect(result.externalMetadata.workflowId).toBe('wf-1');
    expect(result.platformId).toBeUndefined();
    expect(result.externalId).toBeUndefined();
  });

  it('includes platformId when provided', () => {
    const result = buildTracePayload([], 'wf-1', {}, '019469a5-cb6b-7c5e-9e6a-1a2b3c4d5e6f', '');
    expect(result.platformId).toBe('019469a5-cb6b-7c5e-9e6a-1a2b3c4d5e6f');
  });

  it('includes externalId when provided', () => {
    const result = buildTracePayload([], 'wf-1', {}, '', 'ext-123');
    expect(result.externalId).toBe('ext-123');
  });

  it('includes nodesData when provided', () => {
    const nodes = [{ nodeName: 'Webhook', items: [{ body: 'data' }], type: 'webhook' }];
    const result = buildTracePayload([], 'wf-1', {}, '', '', nodes);
    expect(result.data.nodes).toEqual(nodes);
  });

  it('omits nodesData when empty array', () => {
    const result = buildTracePayload([], 'wf-1', {}, '', '', []);
    expect(result.data.nodes).toBeUndefined();
  });
});

describe('buildOptimizedTracePayload', () => {
  it('sets status to success when all nodes executed', () => {
    const nodes = [
      { nodeName: 'Node1', items: [{ out: 1 }], type: 'httpRequest' },
      { nodeName: 'Node2', items: [{ out: 2 }], type: 'ai' },
    ];
    const result = buildOptimizedTracePayload(nodes, 'wf-1', 'My Flow', '2025-01-01T00:00:00.000Z');
    expect(result.status).toBe('success');
    expect(result.data['Node1'].status).toBe('success');
    expect(result.data['Node2'].status).toBe('success');
  });

  it('sets status to partial when some nodes are skipped', () => {
    const nodes = [
      { nodeName: 'Node1', items: [{ out: 1 }], type: 'httpRequest' },
      { nodeName: 'Node2', items: [], type: 'ai', _notExecuted: true },
    ];
    const result = buildOptimizedTracePayload(nodes, 'wf-1', 'My Flow', '2025-01-01T00:00:00.000Z');
    expect(result.status).toBe('partial');
    expect(result.data['Node1'].status).toBe('success');
    expect(result.data['Node2'].status).toBe('skipped');
    expect(result.data['Node2'].output).toEqual({});
  });

  it('unwraps single-item arrays', () => {
    const nodes = [{ nodeName: 'Node1', items: [{ value: 'single' }], type: 'test' }];
    const result = buildOptimizedTracePayload(nodes, 'wf-1', 'Flow', '2025-01-01T00:00:00.000Z');
    expect(result.data['Node1'].output).toEqual({ value: 'single' });
  });

  it('keeps multi-item arrays as arrays', () => {
    const nodes = [{ nodeName: 'Node1', items: [{ a: 1 }, { b: 2 }], type: 'test' }];
    const result = buildOptimizedTracePayload(nodes, 'wf-1', 'Flow', '2025-01-01T00:00:00.000Z');
    expect(result.data['Node1'].output).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('includes platformId when provided', () => {
    const result = buildOptimizedTracePayload([], 'wf-1', 'Flow', '2025-01-01T00:00:00.000Z', 'plat-id');
    expect(result.platformId).toBe('plat-id');
  });

  it('omits platformId when not provided', () => {
    const result = buildOptimizedTracePayload([], 'wf-1', 'Flow', '2025-01-01T00:00:00.000Z');
    expect(result.platformId).toBeUndefined();
  });

  it('merges extra metadata', () => {
    const result = buildOptimizedTracePayload(
      [],
      'wf-1',
      'Flow',
      '2025-01-01T00:00:00.000Z',
      undefined,
      { environment: 'prod' },
    );
    expect(result.metadata.environment).toBe('prod');
    expect(result.metadata.workflow_id).toBe('wf-1');
  });

  it('defaults type to unknown', () => {
    const nodes = [{ nodeName: 'Node1', items: [{ v: 1 }], type: undefined }];
    const result = buildOptimizedTracePayload(nodes, 'wf-1', 'Flow', '2025-01-01T00:00:00.000Z');
    expect(result.data['Node1'].type).toBe('unknown');
  });

  it('includes parameters when non-empty', () => {
    const nodes = [
      {
        nodeName: 'Scrape Website',
        items: [{ data: '<html>' }],
        type: 'n8n-nodes-base.httpRequest',
        parameters: { url: '={{ $json.targetUrl }}', method: 'GET', options: {} },
      },
    ];
    const result = buildOptimizedTracePayload(nodes, 'wf-1', 'Flow', '2025-01-01T00:00:00.000Z');
    expect(result.data['Scrape Website'].parameters).toEqual({
      url: '={{ $json.targetUrl }}',
      method: 'GET',
      options: {},
    });
  });

  it('omits parameters when undefined', () => {
    const nodes = [{ nodeName: 'Node1', items: [{ v: 1 }], type: 'test' }];
    const result = buildOptimizedTracePayload(nodes, 'wf-1', 'Flow', '2025-01-01T00:00:00.000Z');
    expect(result.data['Node1'].parameters).toBeUndefined();
  });

  it('omits parameters when empty object', () => {
    const nodes = [{ nodeName: 'Node1', items: [{ v: 1 }], type: 'test', parameters: {} }];
    const result = buildOptimizedTracePayload(nodes, 'wf-1', 'Flow', '2025-01-01T00:00:00.000Z');
    expect(result.data['Node1'].parameters).toBeUndefined();
  });
});
