import type { IDataObject } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import {
  buildRedactionPolicy,
  REDACTED_VALUE,
  redactCapture,
  validateRedactionPath,
} from '../nodes/MiboTesting/redaction';

describe('validateRedactionPath', () => {
  it('accepts nested paths and one-segment wildcards', () => {
    expect(validateRedactionPath('customers.*.email')).toBe('customers.*.email');
  });

  it('rejects empty segments and unsupported wildcard syntax', () => {
    expect(() => validateRedactionPath('customers..email')).toThrow();
    expect(() => validateRedactionPath('.email')).toThrow();
    expect(() => validateRedactionPath('email*')).toThrow();
    expect(() => validateRedactionPath('customers[0].email')).toThrow();
  });
});

describe('redactCapture', () => {
  const source = {
    nodeName: 'Agent',
    type: 'agent',
    status: 'success' as const,
    parameters: {
      headers: { Authorization: 'Bearer secret-token', 'x-api-key': 'api-secret' },
      totalTokens: 12,
    },
    items: [
      {
        customers: [
          { email: 'alice@example.com', name: 'Alice' },
          { email: 'bob@example.com', name: 'Bob' },
        ],
        intermediateSteps: [
          {
            action: {
              tool: 'lookupCustomer',
              toolInput: { email: 'tool@example.com', query: 'safe' },
            },
          },
        ],
      },
    ],
  };

  it('redacts automatic secret keys while preserving shape and usage fields', () => {
    const policy = buildRedactionPolicy(true, false, {});
    const result = redactCapture([source], {
      workflowId: 'workflow-1',
      workflowName: 'Workflow',
      timestamp: '2026-01-01T00:00:00.000Z',
      metadata: { password: 'metadata-secret' },
    }, policy);

    expect(result.sources[0].parameters).toEqual({
      headers: { Authorization: REDACTED_VALUE, 'x-api-key': REDACTED_VALUE },
      totalTokens: 12,
    });
    expect(result.sources[0].items[0].intermediateSteps).toEqual([
      {
        action: {
          tool: 'lookupCustomer',
          toolInput: { email: 'tool@example.com', query: 'safe' },
        },
      },
    ]);
    expect(result.summary).toMatchObject({
      automaticEnabled: true,
      manualEnabled: false,
      automaticMatches: 3,
      valuesRedacted: 3,
    });
  });

  it('recognizes safe dynamic secret-name patterns without masking token metrics', () => {
    const policy = buildRedactionPolicy(true, false, {});
    const result = redactCapture(
      [
        {
          ...source,
          items: [
            {
              databasePassword: 'db-secret',
              sessionToken: 'session-secret',
              mySecret: 'custom-secret',
              aiKey: 'ai-secret',
              openAiKey: 'openai-secret',
              llmKey: 'llm-secret',
              ordinaryKey: 'not-a-secret',
              gen_ai_key: 'semantic-attribute',
              gen_ai_message: { role: 'user', content: 'safe message' },
              promptTokens: 10,
              totalTokens: 12,
            },
          ],
        },
      ],
      {},
      policy,
    );

    expect(result.sources[0].items[0]).toMatchObject({
      databasePassword: REDACTED_VALUE,
      sessionToken: REDACTED_VALUE,
      mySecret: REDACTED_VALUE,
      aiKey: REDACTED_VALUE,
      openAiKey: REDACTED_VALUE,
      llmKey: REDACTED_VALUE,
      ordinaryKey: 'not-a-secret',
      gen_ai_key: 'semantic-attribute',
      gen_ai_message: { role: 'user', content: 'safe message' },
      promptTokens: 10,
      totalTokens: 12,
    });
  });

  it('redacts manual paths through arrays and nested tool arguments', () => {
    const policy = buildRedactionPolicy(true, true, {
      fieldPaths: [{ path: 'customers.*.email' }],
    } as unknown as IDataObject);
    const result = redactCapture([source], {
      workflowId: 'workflow-1',
      workflowName: 'Workflow',
      timestamp: '2026-01-01T00:00:00.000Z',
      user: { email: 'metadata@example.com' },
    }, policy);

    expect(result.sources[0].items[0].customers).toEqual([
      { email: REDACTED_VALUE, name: 'Alice' },
      { email: REDACTED_VALUE, name: 'Bob' },
    ]);
    const intermediateSteps = result.sources[0].items[0].intermediateSteps as IDataObject[];
    expect((intermediateSteps[0] as IDataObject).action).toEqual({
      tool: 'lookupCustomer',
      toolInput: { email: 'tool@example.com', query: 'safe' },
    });
    expect((result.metadata as IDataObject).user).toEqual({ email: 'metadata@example.com' });
    expect(result.metadata.workflowId).toBe('workflow-1');
    expect(result.summary.manualMatches).toBe(2);
  });

  it('continues a deep search below a partial selector match', () => {
    const policy = buildRedactionPolicy(false, true, {
      fieldPaths: [{ path: 'customer.email' }],
    } as unknown as IDataObject);
    const result = redactCapture(
      [
        {
          ...source,
          items: [{ customer: { nested: { customer: { email: 'private@example.com' } } } }],
        },
      ],
      {},
      policy,
    );

    expect(result.sources[0].items[0].customer).toEqual({
      nested: { customer: { email: REDACTED_VALUE } },
    });
  });

  it('leaves capture values unchanged when both modes are disabled', () => {
    const policy = buildRedactionPolicy(false, false, {});
    const result = redactCapture([source], { workflowId: 'workflow-1' }, policy);

    expect(result.sources[0]).toEqual(source);
    expect(result.summary.valuesRedacted).toBe(0);
  });
});
