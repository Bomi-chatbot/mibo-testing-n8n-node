import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  Icon,
  INodeProperties,
} from 'n8n-workflow';

export class MiboTestingApi implements ICredentialType {
  name = 'miboTestingApi';
  displayName = 'Mibo Testing API';
  documentationUrl = 'https://docs.mibo-ai.com/n8n-node/setup';
  icon? = 'file:mibo-testing.svg' as Icon;
  properties: INodeProperties[] = [
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      description:
        'Your Mibo Testing API key. You can find this in your Mibo Testing dashboard under Settings > API Keys.',
    },
    {
      displayName: 'n8n API Key (Optional)',
      name: 'n8nApiKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      description:
        'Your n8n instance API key. This allows Mibo Testing to automatically read your workflow structure without needing an extra "Get Workflow" node. To create one: open your n8n instance, go to Settings > API, and click "Create an API Key". The key only needs the "workflow:read" scope.',
    },
    {
      displayName: 'n8n API URL',
      name: 'n8nBaseUrl',
      type: 'string',
      default: 'http://localhost:5678/api/v1',
      description:
        'The URL of your n8n Public API. The default works for most self-hosted setups. Change it if your n8n runs on a different port or domain. If left empty, the node will attempt to auto-detect it from your n8n environment.',
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        'x-api-key': '={{$credentials?.apiKey}}',
        'Content-Type': 'application/json',
      },
    },
  };

  test: ICredentialTestRequest = {
    request: {
      baseURL: 'https://api.mibo-ai.com',
      url: '/health',
      method: 'GET',
    },
  };
}
