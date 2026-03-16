# Changelog

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
