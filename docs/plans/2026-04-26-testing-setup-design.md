# Testing Setup Design — Creader MCP Server

**Date:** 2026-04-26

## Goal

Add a unit + integration test suite with coverage reporting to the Creader MCP server. Hit a 70% line/function/branch/statement threshold gated in CI via `vitest`.

## Decisions

| Question | Choice |
|---|---|
| Test scope | Both unit and integration |
| Framework | Vitest (native ESM/TS, built-in coverage) |
| Mocking strategy | Stub `globalThis.fetch` per test; exercise real `CreaderClient` |
| Coverage gate | 70% lines/functions/branches/statements |
| Integration gating | `describe.skipIf(!process.env.CREADER_API_TOKEN)` — auto-skip without token |

## Layout

```
creader-mcp/
├── tests/
│   ├── unit/
│   │   ├── api-client.test.ts
│   │   ├── errors.test.ts
│   │   └── tools/
│   │       ├── ai.test.ts
│   │       ├── books.test.ts
│   │       ├── chapters.test.ts
│   │       ├── knowledge.test.ts
│   │       ├── publishing.test.ts
│   │       ├── relations.test.ts
│   │       └── stats.test.ts
│   ├── integration/
│   │   └── creader-api.test.ts
│   └── helpers/
│       ├── mock-fetch.ts
│       ├── fixtures.ts
│       └── fake-mcp-server.ts
└── vitest.config.ts
```

## Key implementation notes

- **Singleton client + cache.** `getClient()` returns a module-level singleton with a 60s in-memory GET cache. Tests use `vi.resetModules()` in `beforeEach` and dynamic-import the tool registrars so each test gets a fresh client/cache.
- **Env at import time.** `CREADER_API_KEY` is read at module load. Setup file sets `process.env.CREADER_API_KEY = "test-key"` before any import.
- **Response envelope.** The API returns `{ success, data, error }`. `mock-fetch.ts` provides `mockSuccess(data)` (wraps in envelope) and `mockApiError(code, message)` (returns `{ success: false, error }`), plus `mockHttpError(status, body?)` for non-2xx.
- **MCP tool registration.** `McpServer.tool(name, description, schema, annotations, handler)`. `FakeMcpServer` stubs this signature, records each registration, and exposes `call(name, args)` to invoke the handler.
- **Tools return errors, don't throw.** `toolError()` returns `{ content, isError: true }`. Tests assert on `result.isError === true` and on the message text.

## Scripts (package.json)

- `test` → `vitest run tests/unit`
- `test:watch` → `vitest tests/unit`
- `test:integration` → `vitest run tests/integration`
- `test:coverage` → `vitest run tests/unit --coverage`
- `test:all` → `vitest run`

## vitest.config.ts essentials

```ts
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/helpers/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/lib/types.ts", "**/*.d.ts"],
      thresholds: { lines: 70, functions: 70, branches: 70, statements: 70 },
      reporter: ["text", "html", "lcov"],
    },
  },
});
```

## Build order

1. Install deps; add `vitest.config.ts`, scripts, `.gitignore`.
2. Helpers: `mock-fetch.ts`, `fixtures.ts`, `fake-mcp-server.ts`, `setup.ts`.
3. `api-client.test.ts` + `errors.test.ts`.
4. Tool tests, one file at a time, until 70% threshold passes.
5. Integration test file.
6. README "Testing" section.
