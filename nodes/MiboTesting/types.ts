import type { IDataObject } from 'n8n-workflow';

export interface MiboErrorResponse {
  error: {
    code: string;
    details?: Array<{
      location: string;
      msg: string;
      path: string;
      type: string;
    }>;
    message: string;
  };
  success: false;
  timestamp: string;
}

export interface MiboSuccessResponse {
  data: {
    createdAt: string;
    externalId?: string;
    id: string;
    platformId: string;
    status: string;
    updatedAt: string;
  };
  message: string;
  success: boolean;
  timestamp: string;
}

export interface WorkflowNode {
  name: string;
  parameters?: IDataObject;
  type: string;
}

export type WorkflowConnections = Record<
  string,
  Record<string, Array<Array<{ node: string; type?: string; index?: number }>>>
>;

export interface FetchedWorkflow {
  nodes: WorkflowNode[];
  connections: WorkflowConnections;
}

export interface NodeOptions {
  timeout?: number;
}

export interface MetadataFields {
  additionalFields?: string | IDataObject;
  environment?: string;
  version?: string;
}

export interface CanonicalSpan {
  span_id: string;
  parent_span_id: string | null;
  name: string;
  attributes: Record<string, unknown>;
}

export interface CanonicalTracePayload {
  spans: CanonicalSpan[];
  externalMetadata: {
    workflowId: string;
  };
  metadata: IDataObject;
  platformId?: string;
}

export interface SpanSource {
  nodeName: string;
  type: string;
  status: 'success' | 'skipped';
  items: IDataObject[];
  parameters?: IDataObject;
}
