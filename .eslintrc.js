/**
 * ESLint config — runs ONLY eslint-plugin-n8n-nodes-base rules.
 * Biome handles every other lint/format concern (see biome.json).
 * This file exists because n8n's community-node rules are not
 * expressible in Biome.
 */
module.exports = {
	root: true,
	ignorePatterns: ['.eslintrc.js', '**/*.js', 'node_modules/**', 'dist/**'],
	overrides: [
		{
			files: ['package.json'],
			parser: 'jsonc-eslint-parser',
			plugins: ['eslint-plugin-n8n-nodes-base'],
			extends: ['plugin:n8n-nodes-base/community'],
		},
		{
			files: ['./credentials/**/*.ts'],
			parser: '@typescript-eslint/parser',
			parserOptions: { sourceType: 'module' },
			plugins: ['eslint-plugin-n8n-nodes-base'],
			extends: ['plugin:n8n-nodes-base/credentials'],
			rules: {
				// Autofix is broken — it mangles the URL into camelCase.
				// The URL itself is a valid https:// link; suppress the false positive.
				'n8n-nodes-base/cred-class-field-documentation-url-miscased': 'off',
			},
		},
		{
			files: ['./nodes/**/*.ts'],
			parser: '@typescript-eslint/parser',
			parserOptions: { sourceType: 'module' },
			plugins: ['eslint-plugin-n8n-nodes-base'],
			extends: ['plugin:n8n-nodes-base/nodes'],
		},
	],
};
