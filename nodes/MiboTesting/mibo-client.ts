import type { IDataObject, IExecuteFunctions, IHttpRequestMethods } from 'n8n-workflow';
import { ERROR_CODES, MAX_PAYLOAD_SIZE_MB } from './constants';
import type { CanonicalTracePayload, MiboErrorResponse, MiboSuccessResponse } from './types';

export function parseErrorResponse(error: unknown): string {
  const err = error as { message?: string; response?: { data?: MiboErrorResponse } };
  const errorData = err.response?.data;
  const errorMessage = err.message?.toLowerCase() || '';

  // Check for payload too large error
  if (errorMessage.includes('entity too large') || errorMessage.includes('payload too large')) {
    return ERROR_CODES.PAYLOAD_TOO_LARGE;
  }

  if (errorData?.error?.code) {
    const code = errorData.error.code;
    let baseMessage: string;
    if (code === 'PLATFORM_NOT_FOUND') {
      const serverMessage = errorData.error.message || '';
      const hasRestrictions =
        serverMessage.toLowerCase().includes('restricted') ||
        serverMessage.toLowerCase().includes('allowed');
      baseMessage = hasRestrictions
        ? ERROR_CODES.PLATFORM_NOT_FOUND.withRestrictions
        : ERROR_CODES.PLATFORM_NOT_FOUND.withoutRestrictions;
    } else {
      const errorCode = ERROR_CODES[code as keyof typeof ERROR_CODES];
      baseMessage = (typeof errorCode === 'string' ? errorCode : null) || errorData.error.message;
    }

    if (errorData.error.details?.length) {
      const details = errorData.error.details.map((d) => `${d.path}: ${d.msg}`).join('; ');
      return `${baseMessage} Details: ${details}`;
    }

    return baseMessage;
  }

  return err.message || 'Unknown error while sending the trace';
}

export function calculatePayloadSize(payload: CanonicalTracePayload): number {
  return new TextEncoder().encode(JSON.stringify(payload)).length;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getPayloadSizeWarning(sizeBytes: number): string | null {
  const sizeMB = sizeBytes / (1024 * 1024);
  if (sizeMB > MAX_PAYLOAD_SIZE_MB * 0.8) {
    return `Warning: Payload size (${formatBytes(sizeBytes)}) is close to the ${MAX_PAYLOAD_SIZE_MB}MB limit. Consider reducing target nodes.`;
  }
  return null;
}

export async function sendTrace(
  node: IExecuteFunctions,
  serverUrl: string,
  apiKey: string,
  payload: CanonicalTracePayload,
  timeout: number,
  requestId?: string,
): Promise<MiboSuccessResponse> {
  const headers: IDataObject = {
    'x-api-key': apiKey,
    'Content-Type': 'application/json',
  };

  if (requestId) {
    headers['x-request-id'] = requestId;
  }

  return node.helpers.httpRequest({
    method: 'POST' as IHttpRequestMethods,
    url: `${serverUrl}/public/traces`,
    headers,
    body: payload,
    json: true,
    timeout,
  });
}
