import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class MiboTestingApi implements ICredentialType {
	name = 'miboTestingApi';

	displayName = 'Mibo Testing API';

	documentationUrl = 'https://docs.mibo-testing.com/integrations/n8n';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Your Mibo Testing API key. You can find this in your Mibo Testing dashboard under Settings > API Keys.',
		},
		{
			displayName: 'Server URL',
			name: 'serverUrl',
			type: 'string',
			default: 'https://api.mibo-ai.com',
			description: 'The Mibo Testing server URL. Only change this if you are using a self-hosted instance.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-API-Key': '={{$credentials?.apiKey}}',
				'Content-Type': 'application/json',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials?.serverUrl}}',
			url: '/health',
			method: 'GET',
		},
	};
}
