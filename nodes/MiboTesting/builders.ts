import { randomUUID } from 'node:crypto';
import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import type {
  CanonicalSpan,
  CanonicalTracePayload,
  MetadataFields,
  SpanSource,
  ToolCall,
  WorkflowNode,
} from './types';
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

export function resolveHttpResponseStatus(
  workflowNodes: WorkflowNode[],
  parentMap: Record<string, string | null>,
  miboNodeName: string,
): number | undefined {
  const nodesByName = new Map(workflowNodes.map((node) => [node.name, node]));
  const seen = new Set<string>([miboNodeName]);
  let current = parentMap[miboNodeName] ?? null;
  let responseNode: WorkflowNode | undefined;
  let responseWebhookFound = false;

  while (current && !seen.has(current)) {
    seen.add(current);
    const node = nodesByName.get(current);
    if (node?.type === 'n8n-nodes-base.respondToWebhook' && !responseNode) {
      responseNode = node;
    }
    if (
      node?.type === 'n8n-nodes-base.webhook' &&
      node.parameters?.responseMode === 'responseNode'
    ) {
      responseWebhookFound = true;
    }
    current = parentMap[current] ?? null;
  }

  if (!responseNode || !responseWebhookFound) return undefined;

  const options = responseNode.parameters?.options;
  if (!options || typeof options !== 'object' || Array.isArray(options)) return 200;

  const responseCode = (options as IDataObject).responseCode;
  if (responseCode === undefined) return 200;
  if (
    typeof responseCode !== 'number' ||
    !Number.isInteger(responseCode) ||
    responseCode < 100 ||
    responseCode > 599
  ) {
    return undefined;
  }
  return responseCode;
}

/**
 * Resolve a tool call's arguments, working around n8n issue #23501 where `toolInput`
 * can be empty while the real args live in `messageLog[].tool_calls[].args`.
 */
function resolveToolArguments(action: IDataObject): unknown {
  const toolInput = action.toolInput;
  if (toolInput && typeof toolInput === 'object' && Object.keys(toolInput).length > 0) {
    return toolInput;
  }

  const messageLog = action.messageLog;
  if (Array.isArray(messageLog)) {
    const toolCallId = action.toolCallId;
    for (const message of messageLog) {
      const toolCalls = (message as IDataObject)?.tool_calls;
      if (!Array.isArray(toolCalls)) continue;
      const match = toolCalls.find((tc) => (tc as IDataObject)?.id === toolCallId) ?? toolCalls[0];
      const args = (match as IDataObject)?.args;
      if (args && typeof args === 'object' && Object.keys(args).length > 0) {
        return args;
      }
    }
  }

  return undefined;
}

/**
 * Recover the tools each agent actually invoked from its `intermediateSteps` output.
 * Only captured (success) sources carry output; nodes without `intermediateSteps`
 * yield nothing. The agent must have "Return Intermediate Steps" enabled.
 */
export function extractToolCalls(sources: SpanSource[]): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const source of sources) {
    if (source.status !== 'success') continue;
    for (const item of source.items) {
      const steps = item.intermediateSteps;
      if (!Array.isArray(steps)) continue;
      for (const step of steps) {
        const action = (step as IDataObject)?.action as IDataObject | undefined;
        const tool = action?.tool;
        if (typeof tool !== 'string' || tool.length === 0) continue;
        calls.push({
          name: tool,
          arguments: action ? resolveToolArguments(action) : undefined,
          agentNodeName: source.nodeName,
        });
      }
    }
  }
  return calls;
}

export function buildCanonicalTracePayload(
  sources: SpanSource[],
  workflowId: string,
  metadata: IDataObject,
  platformId: string,
  parentMap: Record<string, string | null>,
  toolCalls: ToolCall[] = [],
  httpResponseStatus?: number,
): CanonicalTracePayload {
  const spanIdByNode: Record<string, string> = {};
  for (const s of sources) {
    spanIdByNode[s.nodeName] = randomUUID();
  }

  const spans = sources.map((s) => buildSpan(s, spanIdByNode, parentMap));

  if (httpResponseStatus !== undefined) {
    const rootSpan = spans.find((span) => span.parent_span_id === null);
    if (rootSpan) rootSpan.attributes['http.response.status_code'] = httpResponseStatus;
  }

  // Real tool invocations become child spans of their agent so the consumer
  // evaluates them via expected_tool_calls (gen_ai.tool.name + parent_span_id).
  for (const call of toolCalls) {
    const attributes: Record<string, unknown> = { 'gen_ai.tool.name': call.name };
    if (call.arguments !== undefined) {
      attributes['gen_ai.tool.call.arguments'] = safeStringify(call.arguments);
    }
    spans.push({
      span_id: randomUUID(),
      parent_span_id: spanIdByNode[call.agentNodeName] ?? null,
      name: call.name,
      attributes,
    });
  }

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
