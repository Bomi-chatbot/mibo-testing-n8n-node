import { randomUUID } from 'node:crypto';
import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import type { CanonicalSpan, CanonicalTracePayload, MetadataFields, SpanSource } from './types';
import { safeStringify } from './utils';

export function buildMetadata(
  workflowId: string,
  workflowName: string,
  timestamp: string,
  includeMetadata: boolean,
  metadataConfig: IDataObject,
  node: IExecuteFunctions,
): IDataObject {
  const metadata: IDataObject = {
    workflowId,
    workflowName,
    timestamp,
  };

  if (!includeMetadata) {
    return metadata;
  }

  const fields = metadataConfig.fields as MetadataFields | undefined;
  if (!fields) {
    return metadata;
  }

  if (fields.environment) {
    metadata.environment = fields.environment;
  }

  if (fields.version) {
    metadata.version = fields.version;
  }

  if (fields.additionalFields) {
    try {
      const additionalFields =
        typeof fields.additionalFields === 'string'
          ? JSON.parse(fields.additionalFields)
          : fields.additionalFields;
      Object.assign(metadata, additionalFields);
    } catch {
      throw new NodeOperationError(node.getNode(), 'Invalid JSON in Additional Fields', {
        description: 'Please ensure the Additional Fields contains valid JSON',
      });
    }
  }

  return metadata;
}

function resolveCapturedAncestor(
  nodeName: string,
  spanIdByNode: Record<string, string>,
  parentMap: Record<string, string | null>,
): string | null {
  const seen = new Set<string>([nodeName]);
  let current = parentMap[nodeName] ?? null;
  while (current && !seen.has(current)) {
    if (spanIdByNode[current]) return spanIdByNode[current];
    seen.add(current);
    current = parentMap[current] ?? null;
  }
  return null;
}

function buildSpan(
  source: SpanSource,
  spanIdByNode: Record<string, string>,
  parentMap: Record<string, string | null>,
): CanonicalSpan {
  const spanId = spanIdByNode[source.nodeName];
  const parentSpanId = resolveCapturedAncestor(source.nodeName, spanIdByNode, parentMap);

  const attributes: Record<string, unknown> = {
    'n8n.node.type': source.type,
    'n8n.node.status': source.status,
  };

  if (source.parameters && Object.keys(source.parameters).length > 0) {
    attributes['n8n.node.parameters'] = safeStringify(source.parameters);
  }

  if (source.status === 'success' && source.items.length > 0) {
    const output = source.items.length === 1 ? source.items[0] : source.items;
    attributes['n8n.node.output'] = safeStringify(output);
  }

  return {
    span_id: spanId,
    parent_span_id: parentSpanId,
    name: source.nodeName,
    attributes,
  };
}

export function buildCanonicalTracePayload(
  sources: SpanSource[],
  workflowId: string,
  metadata: IDataObject,
  platformId: string,
  parentMap: Record<string, string | null>,
): CanonicalTracePayload {
  const spanIdByNode: Record<string, string> = {};
  for (const s of sources) {
    spanIdByNode[s.nodeName] = randomUUID();
  }

  const spans = sources.map((s) => buildSpan(s, spanIdByNode, parentMap));

  const payload: CanonicalTracePayload = {
    spans,
    externalMetadata: { workflowId },
    metadata,
  };

  if (platformId) {
    payload.platformId = platformId;
  }

  return payload;
}
