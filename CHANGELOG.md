# Changelog

## [1.0.1](https://github.com/mibo-ai/mibo-testing-n8n-node/compare/n8n-nodes-mibo-testing-v1.0.0...n8n-nodes-mibo-testing-v1.0.1) (2026-06-06)


### Bug Fixes

* comply with n8n verified-community-node guidelines ([b83aff2](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/b83aff24b093e5e12a3b09629549f40683f2ee3a))
* credential icon + sync agent docs to post-gzip reality ([fc730ab](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/fc730abb79072ff88c2b7b66460ae0d7fc2ea0e5))

## [1.0.0](https://github.com/mibo-ai/mibo-testing-n8n-node/compare/n8n-nodes-mibo-testing-v0.2.1...n8n-nodes-mibo-testing-v1.0.0) (2026-06-06)


### ⚠ BREAKING CHANGES

* canonical Custom API trace + UI cleanup + 1.0 release prep ([#1](https://github.com/mibo-ai/mibo-testing-n8n-node/issues/1))
* The trace payload is now {spans, externalMetadata, metadata, platformId?} with spans at the top level (no longer nested under data). The legacy {data: {input, nodes}} and {data: {NodeName: {output, ...}}} shapes are gone. Node parameters useGetWorkflow, nodeFilterPreset, targetNodes, and customTargetNodes have been removed; the node now always auto-captures every executed workflow node and requires either an n8n API key in the credentials or an upstream Get Workflow node.

### Features

* add auto-excluded node types for improved filtering in MiboTesting node ([9f4f245](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/9f4f245b90996c37bbd2d9abb219ef068212cf32))
* add changelog for version 0.2.0 and include noDataExpression property in MiboTesting node options ([0e6bf21](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/0e6bf21d9526b1e9ecc55753f5eafe9c33882c1f))
* add comprehensive coding standards and agent rules documentation ([c720e74](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/c720e747555adbc66bc4977e22f7b1723948425d))
* add comprehensive documentation for MiboTesting node and implement optimized trace payload handling ([89ba3d5](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/89ba3d5cdfb311a6fbf671f4c6c195af3d68d188))
* add noDataExpression property to workflow node options for improved functionality ([28e1332](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/28e1332e91b9a2fca72552754a0780413f797654))
* add parameters support in optimized trace payload and update changelog ([b2d476d](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/b2d476d7a392df359af09a69358ebdca7bca9146))
* add project context and coding standards documentation ([4e80daf](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/4e80daff87239a2d634ec4da1abb8fafe3d78cbd))
* add request ID parameter to MiboTesting node for trace correlation ([ff2cc36](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/ff2cc362c238c9fcb666b751cf122aaacb3a62c1))
* add skills-lock.json for skill management ([9899ef8](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/9899ef84be91779d82e56991b05aa8f1a260ab90))
* canonical Custom API trace + UI cleanup + 1.0 release prep ([#1](https://github.com/mibo-ai/mibo-testing-n8n-node/issues/1)) ([9899ef8](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/9899ef84be91779d82e56991b05aa8f1a260ab90))
* Configure N8N custom node installation path, add N8N environment variables to Dockerfile, and provide a `.env.example` template. ([ee46b0f](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/ee46b0ff5435982e8af2c43f5e02ec7288897557))
* create SKILL.md files for n8n-node and release-flow skills ([9899ef8](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/9899ef84be91779d82e56991b05aa8f1a260ab90))
* create SKILL.md for vitest-n8n skill ([9899ef8](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/9899ef84be91779d82e56991b05aa8f1a260ab90))
* enhance MiboSuccessResponse structure and add targetNodes parameter for improved data handling ([b4ab8ec](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/b4ab8ec73718072707ddb0030e0acf06bdee377a))
* enhance MiboTesting API integration with improved base URL handling and updated credential descriptions ([55052ec](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/55052ecff1d348d1b648a49ac7fe4923e62fab9a))
* enhance MiboTesting API integration with n8n support and improved error handling ([9e18e9c](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/9e18e9c525f837fc9c93e2ac65c2a89968ad5359))
* enhance MiboTesting node documentation with detailed node filtering and payload structure ([322f033](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/322f0330145d181eef17771c6a484160d272bd0a))
* implement gzip compression for payloads exceeding size threshold in sendTrace function ([0562393](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/05623932ce1e3f24dff7f4ae308f21efb3c6dfc1))
* Pass through `X-Request-Id` from incoming data to outgoing HTTP requests. ([1a4f52a](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/1a4f52a3edbe411695b05ecd51ed6b92bdcd1107))
* refactor MiboTesting node with enhanced node filtering and metadata handling ([82c0da2](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/82c0da213d1a2712fcda3c64ecf0d5b95c673092))
* update dev-docker script to rebuild and restart n8n container on changes ([90f791e](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/90f791e01151b3cfd138d95d34bf8ccf8008c798))
* update documentation for MiboTesting node to reflect auto-detect mode and setup options ([3c9c805](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/3c9c805aab6bb3cb338551bd170c744bd83df6bc))
* update MiboTesting node with improved metadata handling and error responses ([2e8e680](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/2e8e680bddcfcf4097a741bb631b7bc9653204d2))
* update sendTrace function to use public endpoint for trace submissions ([d67d333](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/d67d33309304fe2348ae49675e45d98575c04f82))


### Bug Fixes

* add missing icon property and enhance n8n API fields in MiboTestingApi credentials ([89a5ec4](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/89a5ec486f75aa3fd228e4d87097c32e53e2b14f))
* clarify API key requirements and error messages in documentation and utils ([5bcbb2a](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/5bcbb2a2884f9647cb7e0562aa6aabf0e3ef3f1e))
* remove optional n8n API fields from MiboTestingApi credentials ([ac5ea01](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/ac5ea0156badc24b052fb32249efa93193ece0da))
* Specify docker-compose file when restarting n8n in dev script ([737b79a](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/737b79a0561e26e167bdf8d90d45c994a9f5a714))
* update error message in MiboTesting.execute test for clarity ([21d9bc5](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/21d9bc59c49b4572bc8c1155db9c2a3491cf5535))
* update error messages to reflect Agent ID changes ([9899ef8](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/9899ef84be91779d82e56991b05aa8f1a260ab90))
* update MiboTesting API documentation URL ([9899ef8](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/9899ef84be91779d82e56991b05aa8f1a260ab90))
* update n8n Base URL description for clarity and examples ([a9b6061](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/a9b60616fb56fb10ae4ea01122cafc22c52c970b))
* update package URLs and installation instructions to reflect new organization structure ([f3951ec](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/f3951ec8abb98ed8a95d0d713b08406aefed5564))
* update tests to reflect Agent ID changes ([9899ef8](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/9899ef84be91779d82e56991b05aa8f1a260ab90))
* update UUID regex to allow version 6 and 7 UUIDs ([01defde](https://github.com/mibo-ai/mibo-testing-n8n-node/commit/01defde318fe346e99f617e9492e2cdafdae7e64))

## [0.2.1] - 2026-03-16

### Added

- Node `parameters` field in optimized trace payload (auto-detect mode) — enables asserting on
  httpRequest node configuration (e.g. `url`, `method`) via `expected_arguments` in Mibo Testing

## [0.2.0] - 2026-03-08

### Added

- Auto-detect Workflow Nodes: fetch workflow structure directly from n8n API (no external node needed)
- Node filter presets: All, AI Only, HTTP/Webhook Only, Exclude Utility, Custom
- Optimized trace payload format for auto-detect mode
- Automatic gzip compression for payloads larger than 5MB
- Automatic `x-request-id` detection from webhook headers
- n8n API credentials (optional) in Mibo Testing credential for direct workflow fetching

### Changed

- Renamed "Use Get Workflow Node" to "Auto-detect Workflow Nodes"
- Mibo API URL is now hardcoded (not user-configurable in production)

### Removed

- Custom Server URL option from credentials and node options
