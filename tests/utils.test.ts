import { describe, expect, it } from 'vitest';

import {
  agentsMissingIntermediateSteps,
  buildParentMap,
  buildSubNodeNames,
  buildToolNodeNames,
  findRequestIdInData,
  isValidUUID,
  normalizeServerUrl,
  safeStringify,
} from '../nodes/MiboTesting/utils';

describe('isValidUUID', () => {
  it('accepts valid v4 UUIDs', () => {
    expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('accepts valid v7 UUIDs', () => {
    expect(isValidUUID('019469a5-cb6b-7c5e-9e6a-1a2b3c4d5e6f')).toBe(true);
    expect(isValidUUID('01946a00-0000-7000-8000-000000000000')).toBe(true);
  });

  it('accepts uppercase UUIDs', () => {
    expect(isValidUUID('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
  });

  it('rejects invalid UUIDs', () => {
    expect(isValidUUID('')).toBe(false);
    expect(isValidUUID('not-a-uuid')).toBe(false);
    expect(isValidUUID('550e8400-e29b-41d4-a716')).toBe(false);
    expect(isValidUUID('550e8400e29b41d4a716446655440000')).toBe(false);
  });
});

describe('normalizeServerUrl', () => {
  it('removes trailing slashes', () => {
    expect(normalizeServerUrl('https://api.example.com/')).toBe('https://api.example.com');
    expect(normalizeServerUrl('https://api.example.com///')).toBe('https://api.example.com');
  });

  it('trims whitespace', () => {
    expect(normalizeServerUrl('  https://api.example.com  ')).toBe('https://api.example.com');
  });

  it('handles combined whitespace and trailing slashes', () => {
    expect(normalizeServerUrl('  https://api.example.com/  ')).toBe('https://api.example.com');
  });

  it('returns clean URL unchanged', () => {
    expect(normalizeServerUrl('https://api.example.com')).toBe('https://api.example.com');
  });
});

describe('findRequestIdInData', () => {
  it('finds x-request-id in direct headers', () => {
    const data = { headers: { 'x-request-id': 'abc-123' } };
    expect(findRequestIdInData(data)).toBe('abc-123');
  });

  it('finds X-Request-Id case-insensitively', () => {
    const data = { headers: { 'X-Request-Id': 'abc-123' } };
    expect(findRequestIdInData(data)).toBe('abc-123');
  });

  it('finds x-request-id in nested objects', () => {
    const data = {
      body: {
        nested: {
          headers: { 'x-request-id': 'deep-id' },
        },
      },
    };
    expect(findRequestIdInData(data)).toBe('deep-id');
  });

  it('returns undefined when no headers present', () => {
    const data = { body: 'hello', status: 200 };
    expect(findRequestIdInData(data)).toBeUndefined();
  });

  it('returns undefined when headers exist but no x-request-id', () => {
    const data = { headers: { 'content-type': 'application/json' } };
    expect(findRequestIdInData(data)).toBeUndefined();
  });

  it('does not recurse into arrays', () => {
    const data = { items: [{ headers: { 'x-request-id': 'in-array' } }] };
    expect(findRequestIdInData(data)).toBeUndefined();
  });
});

describe('buildParentMap', () => {
  it('maps each downstream node to its first upstream source', () => {
    const connections = {
      Webhook: { main: [[{ node: 'HTTP Request' }]] },
      'HTTP Request': { main: [[{ node: 'AI Agent' }]] },
    };
    const parents = buildParentMap(connections);
    expect(parents).toEqual({ 'HTTP Request': 'Webhook', 'AI Agent': 'HTTP Request' });
  });

  it('keeps the first parent when a node has multiple incoming edges', () => {
    const connections = {
      Source1: { main: [[{ node: 'Merge' }]] },
      Source2: { main: [[{ node: 'Merge' }]] },
    };
    const parents = buildParentMap(connections);
    expect(parents.Merge).toBe('Source1');
  });

  it('nests AI sub-nodes under the node they feed, keeping the agent on its main parent', () => {
    const connections = {
      Tool: { ai_tool: [[{ node: 'AI Agent' }]] },
      'Chat Model': { ai_languageModel: [[{ node: 'AI Agent' }]] },
      'HTTP Request': { main: [[{ node: 'AI Agent' }]] },
    };
    const parents = buildParentMap(connections);
    // The Agent keeps its main upstream node as parent...
    expect(parents['AI Agent']).toBe('HTTP Request');
    // ...while the model/tool nest under the Agent they feed.
    expect(parents.Tool).toBe('AI Agent');
    expect(parents['Chat Model']).toBe('AI Agent');
  });

  it('returns empty map for empty connections', () => {
    expect(buildParentMap({})).toEqual({});
  });
});

describe('buildSubNodeNames', () => {
  it('collects nodes that feed a parent via non-main connections', () => {
    const connections = {
      Webhook: { main: [[{ node: 'AI Agent' }]] },
      'Chat Model': { ai_languageModel: [[{ node: 'AI Agent' }]] },
      'Date & Time': { ai_tool: [[{ node: 'AI Agent' }]] },
    };
    const subNodes = buildSubNodeNames(connections);
    expect(subNodes.has('Chat Model')).toBe(true);
    expect(subNodes.has('Date & Time')).toBe(true);
    expect(subNodes.has('Webhook')).toBe(false);
  });

  it('returns an empty set for empty connections', () => {
    expect(buildSubNodeNames({}).size).toBe(0);
  });
});

describe('agentsMissingIntermediateSteps', () => {
  const connections = { Tool: { ai_tool: [[{ node: 'AI Agent' }]] } };

  it('flags an agent with tools whose returnIntermediateSteps is not enabled', () => {
    const nodes = [{ name: 'AI Agent', type: 'agent', parameters: { options: {} } }];
    expect(agentsMissingIntermediateSteps(connections, nodes)).toEqual(['AI Agent']);
  });

  it('does not flag an agent that enabled returnIntermediateSteps', () => {
    const nodes = [
      { name: 'AI Agent', type: 'agent', parameters: { options: { returnIntermediateSteps: true } } },
    ];
    expect(agentsMissingIntermediateSteps(connections, nodes)).toEqual([]);
  });

  it('returns empty when no tools are wired', () => {
    expect(agentsMissingIntermediateSteps({}, [])).toEqual([]);
  });
});

describe('buildToolNodeNames', () => {
  it('collects only ai_tool sources, not models or memory', () => {
    const connections = {
      'Date & Time': { ai_tool: [[{ node: 'AI Agent' }]] },
      'Chat Model': { ai_languageModel: [[{ node: 'AI Agent' }]] },
      Memory: { ai_memory: [[{ node: 'AI Agent' }]] },
      Webhook: { main: [[{ node: 'AI Agent' }]] },
    };
    const tools = buildToolNodeNames(connections);
    expect(tools.has('Date & Time')).toBe(true);
    expect(tools.has('Chat Model')).toBe(false);
    expect(tools.has('Memory')).toBe(false);
    expect(tools.has('Webhook')).toBe(false);
  });
});

describe('safeStringify', () => {
  it('stringifies plain objects', () => {
    expect(safeStringify({ a: 1 })).toBe('{"a":1}');
  });

  it('coerces BigInt to string instead of throwing', () => {
    const result = safeStringify({ big: 9007199254740993n });
    expect(result).toContain('9007199254740993');
  });
});
