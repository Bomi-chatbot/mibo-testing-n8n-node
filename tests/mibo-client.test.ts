import type { CanonicalTracePayload } from '../nodes/MiboTesting/types';

import { describe, expect, it } from 'vitest';

import {
  calculatePayloadSize,
  formatBytes,
  getPayloadSizeWarning,
  parseErrorResponse,
} from '../nodes/MiboTesting/mibo-client';

describe('parseErrorResponse', () => {
  it('returns message from generic error', () => {
    const error = { message: 'Connection refused' };
    expect(parseErrorResponse(error)).toBe('Connection refused');
  });

  it('returns fallback for unknown error', () => {
    expect(parseErrorResponse({})).toBe('Unknown error while sending the trace');
  });

  it('detects payload too large from message', () => {
    const error = { message: 'Request Entity Too Large' };
    const result = parseErrorResponse(error);
    expect(result).toContain('too large');
  });

  it('detects payload too large (alternate wording)', () => {
    const error = { message: 'Payload too large' };
    const result = parseErrorResponse(error);
    expect(result).toContain('too large');
  });

  it('handles PLATFORM_NOT_FOUND without restrictions', () => {
    const error = {
      response: {
        data: {
          error: {
            code: 'PLATFORM_NOT_FOUND',
            message: 'Platform not found',
          },
        },
      },
    };
    const result = parseErrorResponse(error);
    expect(result).toContain('Could not determine the target agent');
  });

  it('handles PLATFORM_NOT_FOUND with restrictions', () => {
    const error = {
      response: {
        data: {
          error: {
            code: 'PLATFORM_NOT_FOUND',
            message: 'API key is restricted to allowed platforms',
          },
        },
      },
    };
    const result = parseErrorResponse(error);
    expect(result).toContain('restricted to specific agents');
  });

  it('handles VALIDATION_ERROR with details', () => {
    const error = {
      response: {
        data: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            details: [
              { path: 'data', msg: 'is required', location: 'body', type: 'field' },
            ],
          },
        },
      },
    };
    const result = parseErrorResponse(error);
    expect(result).toContain('Details: data: is required');
  });

  it('handles known error code without details', () => {
    const error = {
      response: {
        data: {
          error: {
            code: 'INVALID_API_KEY',
            message: 'Invalid key',
          },
        },
      },
    };
    const result = parseErrorResponse(error);
    expect(result).toContain('does not exist or has been revoked');
  });

  it('falls back to server message for unknown error code', () => {
    const error = {
      response: {
        data: {
          error: {
            code: 'SOME_NEW_CODE',
            message: 'Something unexpected',
          },
        },
      },
    };
    const result = parseErrorResponse(error);
    expect(result).toBe('Something unexpected');
  });
});

describe('calculatePayloadSize', () => {
  it('returns correct byte size', () => {
    const payload: CanonicalTracePayload = {
      spans: [{ span_id: 's1', parent_span_id: null, name: 'Webhook', attributes: {} }],
      metadata: {},
      externalMetadata: { workflowId: 'wf-1' },
    };
    const expected = new TextEncoder().encode(JSON.stringify(payload)).length;
    expect(calculatePayloadSize(payload)).toBe(expected);
  });

  it('handles unicode correctly', () => {
    const payload: CanonicalTracePayload = {
      spans: [{ span_id: 's1', parent_span_id: null, name: 'héllo wörld', attributes: {} }],
      metadata: {},
      externalMetadata: { workflowId: 'wf-1' },
    };
    const size = calculatePayloadSize(payload);
    expect(size).toBeGreaterThan(JSON.stringify(payload).length);
  });
});

describe('formatBytes', () => {
  it('formats bytes', () => {
    expect(formatBytes(500)).toBe('500 B');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('formats megabytes', () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
  });
});

describe('getPayloadSizeWarning', () => {
  it('returns null when size is under 80% of limit', () => {
    const size = 7 * 1024 * 1024; // 7MB, limit is 10MB
    expect(getPayloadSizeWarning(size)).toBeNull();
  });

  it('returns warning when size exceeds 80% of limit', () => {
    const size = 8.5 * 1024 * 1024; // 8.5MB
    const result = getPayloadSizeWarning(size);
    expect(result).not.toBeNull();
    expect(result).toContain('Warning');
    expect(result).toContain('close to the');
  });

  it('returns warning at exactly 80%', () => {
    const size = 8 * 1024 * 1024 + 1; // just over 8MB
    expect(getPayloadSizeWarning(size)).not.toBeNull();
  });
});
