import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IDataObject,
	IHttpRequestMethods,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

/**
 * Recursively scrubs PII keys from a single JSON object
 */
function scrubPIIObject(data: IDataObject, keys: string[]): IDataObject {
	if (!data || typeof data !== 'object') return data;

	const scrubbed: IDataObject = {};
	for (const key of Object.keys(data)) {
		if (keys.includes(key)) {
			scrubbed[key] = '[REDACTED]';
		} else if (typeof data[key] === 'object' && data[key] !== null) {
			scrubbed[key] = scrubPIIObject(data[key] as IDataObject, keys);
		} else {
			scrubbed[key] = data[key];
		}
	}

	return scrubbed;
}

/**
 * Scrubs PII keys from an array of JSON objects
 */
function scrubPII(data: IDataObject[], keys: string[]): IDataObject[] {
	return data.map(item => scrubPIIObject(item, keys));
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
				description: 'The unique identifier for your platform in Mibo Testing (UUID format)',
				placeholder: 'e.g., 550e8400-e29b-41d4-a716-446655440000',
			},
			{
				displayName: 'External ID',
				name: 'externalId',
				type: 'string',
				default: '',
				description: 'Your custom trace identifier (max 255 characters)',
				placeholder: 'e.g., trace-123',
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
				displayName: 'Include Metadata',
				name: 'includeMetadata',
				type: 'boolean',
				default: false,
				description: 'Whether to include additional metadata with the trace',
			},
			{
				displayName: 'Metadata',
				name: 'metadata',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: false,
				},
				default: {},
				displayOptions: {
					show: {
						includeMetadata: [true],
					},
				},
				options: [
					{
						displayName: 'Fields',
						name: 'fields',
						values: [
							{
								displayName: 'Environment',
								name: 'environment',
								type: 'string',
								default: 'production',
								description: 'The environment where the workflow is running',
							},
							{
								displayName: 'Version',
								name: 'version',
								type: 'string',
								default: '1.0.0',
								description: 'The version of your workflow or application',
							},
							{
								displayName: 'Additional Fields',
								name: 'additionalFields',
								type: 'json',
								default: '{}',
								description: 'Any additional metadata fields (JSON format)',
								placeholder: '{"team": "backend", "feature": "user-auth"}',
							},
						],
					},
				],
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Custom Server URL',
						name: 'serverUrl',
						type: 'string',
						default: '',
						description: 'Override the default server URL from credentials. Leave empty to use the credential URL.',
						placeholder: 'https://custom.mibo-ai.com',
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
		const platformId = this.getNodeParameter('platformId', 0, '') as string;
		const externalId = this.getNodeParameter('externalId', 0, '') as string;
		const cleanPii = this.getNodeParameter('cleanPii', 0, false) as boolean;
		const includeMetadata = this.getNodeParameter('includeMetadata', 0, false) as boolean;
		const options = this.getNodeParameter('options', 0, {}) as IDataObject;
		let piiKeys: string[] = [];
		if (cleanPii) {
			const keysString = this.getNodeParameter('piiKeys', 0, '') as string;
			piiKeys = keysString.split(',').map(k => k.trim()).filter(k => k.length > 0);
		}

		const workflowData = this.getWorkflow();
		const now = new Date().toISOString();
		let inputData: IDataObject[] = items.map(item => item.json as IDataObject);
		if (cleanPii && piiKeys.length > 0) {
			inputData = scrubPII(inputData, piiKeys);
		}

		const metadata: IDataObject = {
			workflowId: workflowData.id || 'unknown',
			workflowName: workflowData.name || 'Unnamed Workflow',
			timestamp: now,
		};

		if (includeMetadata) {
			const metadataConfig = this.getNodeParameter('metadata', 0, {}) as IDataObject;
			const fields = metadataConfig.fields as IDataObject | undefined;
			
			if (fields) {
				if (fields.environment) {
					metadata.environment = fields.environment;
				}

				if (fields.version) {
					metadata.version = fields.version;
				}

				if (fields.additionalFields) {
					try {
						const additionalFields = typeof fields.additionalFields === 'string'
							? JSON.parse(fields.additionalFields)
							: fields.additionalFields;
						Object.assign(metadata, additionalFields);
					} catch {
						throw new NodeOperationError(
							this.getNode(),
							'Invalid JSON in Additional Fields',
							{ description: 'Please ensure the Additional Fields contains valid JSON' }
						);
					}
				}
			}
		}

		const tracePayload: IDataObject = {
			data: {
				input: inputData,
				workflowId: workflowData.id || 'unknown',
				workflowName: workflowData.name || 'Unnamed Workflow',
			},
			externalMetadata: {
				workflowId: workflowData.id || 'unknown',
			},
			metadata,
		};

		if (platformId) {
			tracePayload.platformId = platformId;
		}

		if (externalId) {
			tracePayload.externalId = externalId;
		}

		const serverUrl = (options.serverUrl as string) || (credentials.serverUrl as string) || 'https://api.mibo-ai.com';
		const timeout = ((options.timeout as number) || 30) * 1000;
		const requestHeaders: IDataObject = {
			'x-api-key': credentials.apiKey as string,
			'Content-Type': 'application/json',
		};

		const firstItem = items[0]?.json as IDataObject;
		const incomingHeaders = firstItem?.headers as IDataObject | undefined;
		const requestId = (incomingHeaders?.['x-request-id'] || incomingHeaders?.['X-Request-Id'] || firstItem?.['x-request-id'] || firstItem?.['X-Request-Id']) as string | undefined;
		if (requestId) {
			requestHeaders['X-Request-Id'] = requestId;
		}

		try {
			const response = await this.helpers.httpRequest({
				method: 'POST' as IHttpRequestMethods,
				url: `${serverUrl}/traces`,
				headers: requestHeaders,
				body: tracePayload,
				timeout,
			});

			for (let i = 0; i < items.length; i++) {
				returnData.push({
					json: {
						...items[i].json,
						_miboTrace: {
							sent: true,
							traceId: response?.traceId || response?.id || 'unknown',
							platformId: platformId || 'resolved-from-metadata',
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
								platformId: platformId || 'unknown',
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
