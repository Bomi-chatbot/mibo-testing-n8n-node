import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IDataObject,
	IHttpRequestMethods,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

interface TraceEntry {
	nodeId: string;
	nodeName: string;
	nodeType: string;
	executionTime: number;
	input: IDataObject;
	output: IDataObject;
	error?: string;
	timestamp: string;
}

interface WorkflowTrace {
	workflowId: string;
	workflowName: string;
	executionId: string;
	startTime: string;
	endTime: string;
	status: 'success' | 'error';
	platformId?: string;
	metadata?: IDataObject;
	nodes: TraceEntry[];
	inputData: IDataObject[];
	outputData: IDataObject[];
}

/**
 * Recursively scrubs PII keys from a JSON object
 */
function scrubPII(data: any, keys: string[]): any {
	if (!data || typeof data !== 'object') return data;
	
	if (Array.isArray(data)) {
		return data.map(item => scrubPII(item, keys));
	}

	const scrubbed: IDataObject = {};
	for (const key of Object.keys(data)) {
		if (keys.includes(key)) {
			scrubbed[key] = '[REDACTED]';
		} else if (typeof data[key] === 'object' && data[key] !== null) {
			scrubbed[key] = scrubPII(data[key], keys);
		} else {
			scrubbed[key] = data[key];
		}
	}
	return scrubbed;
}

export class MiboTesting implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Mibo Testing',
		name: 'miboTesting',
		icon: 'file:mibo-testing.svg',
		group: ['output'],
		version: 1,
		description: 'Capture and send workflow traces to Mibo Testing for semantic and procedural testing',
		defaults: {
			name: 'Mibo Testing',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'miboTestingApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Platform ID',
				name: 'platformId',
				type: 'string',
				default: '',
				required: true,
				description: 'The unique identifier for your platform in Mibo Testing',
				placeholder: 'e.g., plt_abc123',
			},
			{
				displayName: 'Clean PII',
				name: 'cleanPii',
				type: 'boolean',
				default: false,
				description: 'Whether to scrub PII (Personally Identifiable Information) locally before sending',
				hint: 'Mibo Testing also scrubs data on its servers before storage, but enabling this adds a layer of local protection.',
			},
			{
				displayName: 'PII Keys to Scrub',
				name: 'piiKeys',
				type: 'string',
				default: 'email, password, phone, address',
				displayOptions: {
					show: {
						cleanPii: [true],
					},
				},
				description: 'Comma-separated list of keys to redact from the data',
				placeholder: 'e.g., email, password, credit_card',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Custom Metadata',
						name: 'metadata',
						type: 'json',
						default: '{}',
						description: 'Additional metadata to send with the trace (JSON format)',
						placeholder: '{"environment": "production", "version": "1.0.0"}',
					},
					{
						displayName: 'Custom Server URL',
						name: 'serverUrl',
						type: 'string',
						default: '',
						description: 'Override the default server URL from credentials. Leave empty to use the credential URL.',
						placeholder: 'https://custom.mibo-testing.com',
					},
					{
						displayName: 'Timeout (Seconds)',
						name: 'timeout',
						type: 'number',
						default: 30,
						description: 'Maximum time to wait for the server response',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const credentials = await this.getCredentials('miboTestingApi');
		
		const platformId = this.getNodeParameter('platformId', 0) as string;
		const cleanPii = this.getNodeParameter('cleanPii', 0, false) as boolean;
		const options = this.getNodeParameter('options', 0, {}) as IDataObject;

		let piiKeys: string[] = [];
		if (cleanPii) {
			const keysString = this.getNodeParameter('piiKeys', 0, '') as string;
			piiKeys = keysString.split(',').map(k => k.trim()).filter(k => k.length > 0);
		}

		let metadata: IDataObject = {};
		if (options.metadata) {
			try {
				metadata = typeof options.metadata === 'string' 
					? JSON.parse(options.metadata) 
					: options.metadata as IDataObject;
			} catch {
				throw new NodeOperationError(
					this.getNode(),
					'Invalid JSON in metadata field',
					{ description: 'Please ensure the metadata field contains valid JSON' }
				);
			}
		}

		const workflowData = this.getWorkflow();
		const executionId = this.getExecutionId();
		const now = new Date().toISOString();
		
		// Always include input data as requested
		let inputData: IDataObject[] = items.map(item => item.json as IDataObject);
		
		if (cleanPii && piiKeys.length > 0) {
			inputData = inputData.map(data => scrubPII(data, piiKeys));
		}

		const trace: WorkflowTrace = {
			workflowId: workflowData.id || 'unknown',
			workflowName: workflowData.name || 'Unnamed Workflow',
			executionId: executionId || 'unknown',
			startTime: now,
			endTime: now,
			status: 'success',
			platformId,
			metadata,
			nodes: [],
			inputData,
			outputData: inputData,
		};

		const serverUrl = (options.serverUrl as string) || (credentials.serverUrl as string) || 'https://api.mibo-testing.com';
		const timeout = ((options.timeout as number) || 30) * 1000;

		try {
			const response = await this.helpers.httpRequest({
				method: 'POST' as IHttpRequestMethods,
				url: `${serverUrl}/traces`,
				headers: {
					'X-API-Key': credentials.apiKey as string,
					'Content-Type': 'application/json',
				},
				body: trace,
				timeout,
			});

			for (let i = 0; i < items.length; i++) {
				returnData.push({
					json: {
						...items[i].json,
						_miboTrace: {
							sent: true,
							traceId: response?.traceId || response?.id || 'unknown',
							platformId,
							timestamp: now,
						},
					},
					pairedItem: { item: i },
				});
			}
		} catch (error) {
			if (this.continueOnFail()) {
				for (let i = 0; i < items.length; i++) {
					returnData.push({
						json: {
							...items[i].json,
							_miboTrace: {
								sent: false,
								error: (error as Error).message,
								platformId,
								timestamp: now,
							},
						},
						pairedItem: { item: i },
					});
				}
			} else {
				throw new NodeOperationError(
					this.getNode(),
					`Failed to send trace to Mibo Testing: ${(error as Error).message}`,
					{
						description: 'Check your API key and server URL in the credentials',
					}
				);
			}
		}

		return [returnData];
	}
}
