/**
 * Vitest setup file — runs before any test module is imported.
 * Ensures CREADER_API_KEY is set so CreaderClient construction doesn't throw.
 */

if (!process.env.CREADER_API_KEY) {
  process.env.CREADER_API_KEY = "test-key"
}

// Pin a stable base URL so test assertions can match it exactly.
process.env.CREADER_API_URL = "https://test.creader.local"
