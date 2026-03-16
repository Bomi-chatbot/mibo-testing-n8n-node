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

export interface NodeDataInput {
  _notExecuted?: boolean;
  items: IDataObject[];
  nodeName: string;
  parameters?: IDataObject;
  type?: string;
}

export interface TracePayload {
  data: {
    input: IDataObject[];
    nodes?: NodeDataInput[];
  };
  externalId?: string;
  externalMetadata: {
    workflowId: string;
  };
  metadata: IDataObject;
  platformId?: string;
}

export interface NodeOptions {
  timeout?: number;
}

export interface MetadataFields {
  additionalFields?: string | IDataObject;
  environment?: string;
  version?: string;
}

export interface OptimizedNodeData {
  output: IDataObject | IDataObject[];
  parameters?: IDataObject;
  status: 'success' | 'skipped';
  type: string;
}

export interface OptimizedTraceMetadata {
  [key: string]: unknown;
  timestamp: string;
  workflow_id: string;
  workflow_name: string;
}

export interface OptimizedTracePayload {
  data: Record<string, OptimizedNodeData>;
  metadata: OptimizedTraceMetadata;
  platformId?: string;
  status: 'success' | 'partial';
}
