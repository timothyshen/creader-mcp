/**
 * Integration tests against a real Creader API.
 *
 * Auto-skipped when CREADER_API_TOKEN is unset, so CI without the secret
 * stays green and local runs without the env var don't hit the network.
 *
 * Usage:
 *   export CREADER_API_TOKEN=...           # required
 *   export CREADER_API_URL=https://...     # optional, defaults to creader.io
 *   pnpm test:integration
 *
 * These tests are READ-ONLY. They never create, update, or delete data.
 */

import { describe, it, expect, beforeAll } from "vitest"

const token = process.env.CREADER_API_TOKEN
const baseUrl = process.env.CREADER_API_URL ?? "https://creader.io"

describe.skipIf(!token)("Creader API integration", () => {
  beforeAll(() => {
    process.env.CREADER_API_KEY = token!
    process.env.CREADER_API_URL = baseUrl
  })

  async function makeClient() {
    const { CreaderClient } = await import("../../src/lib/api-client.js")
    return new CreaderClient(token!, baseUrl)
  }

  it(
    "lists books for the authenticated user",
    async () => {
      const client = await makeClient()
      const books = await client.get<unknown>("/api/books")
      expect(Array.isArray(books)).toBe(true)
    },
    30_000
  )

  it(
    "returns writing stats for the authenticated user",
    async () => {
      const client = await makeClient()
      const stats = await client.get<{ currentStreak: number; totalWords: number }>(
        "/api/user/writing-stats"
      )
      expect(stats).toBeDefined()
      expect(typeof stats.currentStreak).toBe("number")
      expect(typeof stats.totalWords).toBe("number")
    },
    30_000
  )

  it(
    "returns the AI token quota",
    async () => {
      const client = await makeClient()
      const quota = await client.get<{ tokenQuota: number; remaining: number }>(
        "/api/user/quota"
      )
      expect(typeof quota.tokenQuota).toBe("number")
      expect(typeof quota.remaining).toBe("number")
    },
    30_000
  )

  it(
    "rejects requests with an invalid token",
    async () => {
      const { CreaderClient } = await import("../../src/lib/api-client.js")
      const bad = new CreaderClient("definitely-not-a-real-token", baseUrl)
      await expect(bad.get("/api/books")).rejects.toThrow()
    },
    30_000
  )
})

if (!token) {
  // eslint-disable-next-line no-console
  console.log(
    "[integration] skipped — set CREADER_API_TOKEN to run integration tests"
  )
}
