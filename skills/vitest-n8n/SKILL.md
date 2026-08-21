---
name: vitest-n8n
description: Author or extend Vitest tests for the Mibo Testing n8n node — mock `IExecuteFunctions` with `createMockExecuteFunctions(overrides)`, stub `helpers.httpRequest`, and assert summary and passthrough output modes. Use when the user mentions adding/changing a test, writing coverage, or any work under `tests/`.
metadata:
  version: "1.0.0"
---

# Vitest tests for the n8n node

## Commands

- `pnpm test` — one-shot.
- `pnpm test:watch` — watch mode.

## File layout

`tests/` mirrors `nodes/MiboTesting/`:

```
tests/
├── node.test.ts          # execute() end-to-end
├── builders.test.ts      # buildTracePayload / buildOptimizedTracePayload
├── mibo-client.test.ts   # sendTrace HTTP behavior (mocked)
└── utils.test.ts         # pure helpers
```

Match the source filename: `foo.ts` → `foo.test.ts`.

## Mocking `IExecuteFunctions`

Use the existing factory rather than hand-rolling per test:

```ts
const ctx = createMockExecuteFunctions({
  getNodeParameter: (name) => params[name],
  getCredentials: async () => ({ apiKey: 'test-key' }),
  helpers: { httpRequest: vi.fn().mockResolvedValue(mockResponse) },
});
```

Override only the fields the test needs. Reset `vi` state between tests if mocks are stateful.

## What to cover

1. **Golden path** for every exported function and `execute()`.
2. **At least one failure case** per public surface:
   - Mibo API error response (`mibo-client`)
   - Oversized payload (over `MAX_PAYLOAD_SIZE_BYTES`)
   - Missing required parameter / credential field
   - Network timeout
3. **Output modes** (`node.test.ts`): the default returns one summary; opt-in passthrough preserves every input field and appends `_miboTrace`.
4. **Payload size recommendation** (`node.test.ts` + `mibo-client.test.ts`): payload above 80% of `MAX_PAYLOAD_SIZE_BYTES` adds a `payload_size` entry to `_miboTrace.recommendations`; the request body is always plain JSON.
5. **`continueOnFail()`**: when enabled, errors emit an item with `error` instead of throwing.
6. **`x-request-id` propagation** from webhook headers when not explicitly set.

## What not to test

- n8n internals (workflow execution, credential decryption). Trust the framework.
- Private helper return shapes that aren't part of any contract.
- Log message strings.

## Assertion style

- `describe()` per function or behavior.
- One concept per `it()`. Multiple `expect()` calls are fine when they assert the same concept.
- Assert against `helpers.httpRequest.mock.calls[0][0]` to inspect URL / headers / body shape rather than re-implementing the request in the test.
