import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import type {
  MetadataFields,
  NodeDataInput,
  OptimizedNodeData,
  OptimizedTracePayload,
  TracePayload,
} from './types';

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

export function buildTracePayload(
  inputData: IDataObject[],
  workflowId: string,
  metadata: IDataObject,
  platformId: string,
  externalId: string,
  nodesData?: NodeDataInput[],
): TracePayload {
  const payload: TracePayload = {
    data: {
      input: inputData,
    },
    externalMetadata: {
      workflowId,
    },
    metadata,
  };

  if (nodesData && nodesData.length > 0) {
    payload.data.nodes = nodesData;
  }

  if (platformId) {
    payload.platformId = platformId;
  }

  if (externalId) {
    payload.externalId = externalId;
  }

  return payload;
}

export function buildOptimizedTracePayload(
  nodesData: NodeDataInput[],
  workflowId: string,
  workflowName: string,
  timestamp: string,
  platformId?: string,
  extraMetadata?: IDataObject,
): OptimizedTracePayload {
  const data: Record<string, OptimizedNodeData> = {};
  let hasSkipped = false;

  for (const node of nodesData) {
    if (node._notExecuted) {
      hasSkipped = true;
      data[node.nodeName] = {
        output: {},
        type: node.type || 'unknown',
        status: 'skipped',
      };
    } else {
      const output = node.items.length === 1 ? node.items[0] : node.items;
      const nodeEntry: OptimizedNodeData = {
        output,
        type: node.type || 'unknown',
        status: 'success',
      };
      if (node.parameters && Object.keys(node.parameters).length > 0) {
        nodeEntry.parameters = node.parameters;
      }
      data[node.nodeName] = nodeEntry;
    }
  }

  const payload: OptimizedTracePayload = {
    status: hasSkipped ? 'partial' : 'success',
    data,
    metadata: {
      workflow_id: workflowId,
      workflow_name: workflowName,
      timestamp,
      ...extraMetadata,
    },
  };

  if (platformId) {
    payload.platformId = platformId;
  }

  return payload;
}
