# n8n community node guidelines

Load when editing `nodes/**`, `credentials/**`, `package.json`, or any code that ships in the npm tarball. These rules are what makes this package eligible to be a [Verified Community Node](https://docs.n8n.io/integrations/creating-nodes/deploy/submit-community-nodes/). Breaking any of them is a regression.

Sources (re-read if a rule below seems ambiguous):
- <https://docs.n8n.io/integrations/creating-nodes/deploy/submit-community-nodes/#standards>
- <https://docs.n8n.io/integrations/creating-nodes/build/reference/verification-guidelines/>
- <https://docs.n8n.io/integrations/creating-nodes/build/reference/ux-guidelines/>

Authoritative validator: `npx @n8n/scan-community-package @mibo-ai/n8n-nodes-mibo-testing` against the published package. Run after any change that could affect verification (env access, imports, peerDependencies, dist contents).

## Hard rules — verification will fail

### Zero runtime dependencies
- `dependencies` in `package.json` **must stay empty**. Move anything needed at runtime into `devDependencies` only if it's build-time, or vendor it.
- **No `require`/`import` of Node built-ins beyond what n8n already loads** — even `node:zlib`, `node:fs`, `node:child_process` etc. are blocked by `@n8n/community-nodes/no-restricted-imports`. If you need compression, hashing, etc., do it server-side or skip the feature.

### No `process.env`, no filesystem
- The code **must not** read `process.env`, `os.*`, `fs.*`, or call `child_process`. All inputs come from node parameters or credentials.
- If you need a configurable URL, host, key, etc., add a credential field (with a sensible `default`). Never fall back to env vars.

### `peerDependencies.n8n-workflow` must be `"*"`
- The scanner rule `@n8n/community-nodes/valid-peer-dependencies` rejects any version range here. Use `"*"`.

### English only
- All UI strings (displayName, description, hints, placeholders, error messages) and all docs must be English.

### Provenance + GitHub Actions publish
- Publishing happens from `release.yml` via OIDC Trusted Publishing. Never publish from a local machine for the canonical release. See `agents/git.md` for release-please rules.

## UX rules — every parameter touches these

### Casing
- **Title Case** for: node `name`, parameter `displayName` (labels), dropdown titles.
- **Sentence case** for: node `description`, parameter `description` (tooltips), hints, dropdown descriptions, operation `action`.

### Booleans
- `description` for a boolean parameter MUST start with `Whether...`. Example: `Whether to include additional metadata with the trace`.

### Placeholders
- Start with `e.g. ` (no comma, lowercase, single space).
- Use camelCase for demo content.
- Examples: `e.g. https://example.com/image.png`, `e.g. nathan@example.com`.

### Referring to fields/parameters in copy
- Wrap parameter/field names in single quotes when mentioned in copy: `Please fill the 'Agent ID' parameter`.

### Capitalisation gotchas the linter catches
- `ID` in any user-facing string (descriptions, placeholders, hints) must be uppercase. `id` is only OK inside literal HTTP header names like `x-request-ID` — keep that consistent across the whole description.
- `URL`, `API`, `JSON`, `HTTP`, `OAuth` — uppercase / canonical case in user-facing copy.

### Credentials
- API keys and sensitive fields must be `password` type (`typeOptions: { password: true }`).
- If the service supports OAuth, include an OAuth credential variant.

### Node class description
- `inputs` / `outputs` must follow the canonical form enforced by the strict `@n8n/node-cli` configuration. The current release uses `NodeConnectionTypes.Main` for regular connections.

### Errors
- **HTTP/API failures use `NodeApiError`**, not `NodeOperationError`. n8n's manual review requires it for calls to external APIs (the Mibo Testing API, the n8n REST API): it preserves the HTTP status code and full response body in the execution UI, which helps users diagnose failures. Pass the original error so that detail survives: `throw new NodeApiError(this.getNode(), error as JsonObject, { message, description })`. Applies to the trace-POST `catch` in `MiboTesting.node.ts` and the `fetchWorkflow` `catch` in `utils.ts`.
- **Only `description` is reliably preserved; `message` is best-effort.** `NodeApiError` rewrites the headline `message` when the underlying error carries a recognised code — `ECONNREFUSED`, `ETIMEDOUT`, `EAI_AGAIN`, etc. (the common connection failures) become n8n's generic copy ("The service refused the connection…") and your custom `message` is demoted into `messages[]`. So put the actionable fix guidance in `description`, and never assert on the exact `message` in tests for the connection-failure path — assert on `description`/`httpCode` instead.
- `NodeOperationError(this.getNode(), message, { description, itemIndex })` is for the node's **own** validation/config errors — bad UUID, no captured nodes, unsupported workflow source, malformed API response shape — not for a failed outbound request.
- Message says *what happened*; description says *how to fix it*.
- Avoid the words "error", "problem", "failure", "mistake" in either.
- If the failure traces to a specific parameter, name it in the message using its `displayName` in single quotes.
- If you know the item index, append `[item N]` to the message.

## Linter

`pnpm run check` runs Oxfmt plus the unmodified strict configuration supplied by `@n8n/node-cli`. The n8n rules check `package.json`, `nodes/**`, and `credentials/**`. Both must pass before commit.

The official configuration disables `cred-class-field-documentation-url-miscased` because its autofix camelCases valid URLs. Don't re-enable without testing.

For the full Cloud-verification scan (catches env vars, restricted imports, peerDependencies), run against the published tarball:

```bash
npx @n8n/scan-community-package @mibo-ai/n8n-nodes-mibo-testing
```

This is stricter than the local lint. Run it before opening a release PR if you touched anything in the hard-rules section above.
