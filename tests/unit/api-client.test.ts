import { describe, it, expect, beforeEach, vi } from "vitest"
import { installFetchMock, type FetchMock } from "../helpers/mock-fetch.js"

// Re-imported per test via vi.resetModules() to get a fresh singleton + cache.
async function loadClient() {
  vi.resetModules()
  const mod = await import("../../src/lib/api-client.js")
  return mod
}

describe("CreaderClient", () => {
  let fetchMock: FetchMock

  beforeEach(() => {
    fetchMock = installFetchMock()
  })

  describe("constructor", () => {
    it("throws if no API key is provided and env is empty", async () => {
      const original = process.env.CREADER_API_KEY
      delete process.env.CREADER_API_KEY
      try {
        const { CreaderClient } = await loadClient()
        expect(() => new CreaderClient()).toThrow(/CREADER_API_KEY/)
      } finally {
        process.env.CREADER_API_KEY = original
      }
    })

    it("uses an explicit api key over env", async () => {
      const { CreaderClient } = await loadClient()
      const c = new CreaderClient("explicit-key", "https://example.test")
      fetchMock.mockSuccess({ ok: true })
      await c.get("/api/x")
      expect(fetchMock.lastCall()?.headers.authorization).toBe("Bearer explicit-key")
      expect(fetchMock.lastCall()?.url).toBe("https://example.test/api/x")
    })
  })

  describe("GET", () => {
    it("attaches Bearer token, base URL, and unwraps the data envelope", async () => {
      const { CreaderClient } = await loadClient()
      const c = new CreaderClient("k", "https://api.test")
      fetchMock.mockSuccess([{ id: "1" }])

      const data = await c.get<Array<{ id: string }>>("/api/books")

      expect(data).toEqual([{ id: "1" }])
      const call = fetchMock.lastCall()!
      expect(call.url).toBe("https://api.test/api/books")
      expect(call.method).toBe("GET")
      expect(call.headers.authorization).toBe("Bearer k")
      expect(call.headers["content-type"]).toBe("application/json")
    })

    it("caches GET responses within the TTL window", async () => {
      const { CreaderClient } = await loadClient()
      const c = new CreaderClient("k", "https://api.test")
      fetchMock.mockSuccess({ id: "1" })

      const a = await c.get("/api/books/1")
      const b = await c.get("/api/books/1")

      expect(a).toEqual(b)
      expect(fetchMock.calls.length).toBe(1)
    })

    it("does not share cache across distinct paths", async () => {
      const { CreaderClient } = await loadClient()
      const c = new CreaderClient("k", "https://api.test")
      fetchMock.mockSuccess({ id: "1" }).mockSuccess({ id: "2" })

      await c.get("/api/books/1")
      await c.get("/api/books/2")

      expect(fetchMock.calls.length).toBe(2)
    })
  })

  describe("write methods", () => {
    it("POST sends JSON body and clears the GET cache", async () => {
      const { CreaderClient } = await loadClient()
      const c = new CreaderClient("k", "https://api.test")
      fetchMock
        .mockSuccess({ cached: true })
        .mockSuccess({ created: true })
        .mockSuccess({ refreshed: true })

      await c.get("/api/books") // populates cache
      await c.post("/api/books", { title: "New" }) // clears cache
      await c.get("/api/books") // should re-fetch

      expect(fetchMock.calls.length).toBe(3)
      expect(fetchMock.calls[1].method).toBe("POST")
      expect(fetchMock.calls[1].body).toEqual({ title: "New" })
    })

    it("PATCH sends body and clears cache", async () => {
      const { CreaderClient } = await loadClient()
      const c = new CreaderClient("k", "https://api.test")
      fetchMock.mockSuccess({ ok: true })
      await c.patch("/api/books/1", { title: "Updated" })
      const call = fetchMock.lastCall()!
      expect(call.method).toBe("PATCH")
      expect(call.body).toEqual({ title: "Updated" })
    })

    it("DELETE sends no body", async () => {
      const { CreaderClient } = await loadClient()
      const c = new CreaderClient("k", "https://api.test")
      fetchMock.mockSuccess({ ok: true })
      await c.delete("/api/books/1")
      const call = fetchMock.lastCall()!
      expect(call.method).toBe("DELETE")
      expect(call.body).toBeUndefined()
    })
  })

  describe("error handling", () => {
    it("throws when envelope success=false using the API error message", async () => {
      const { CreaderClient } = await loadClient()
      const c = new CreaderClient("k", "https://api.test")
      fetchMock.mockApiError("BAD_INPUT", "title is required")
      await expect(c.post("/api/books", {})).rejects.toThrow("title is required")
    })

    it("throws on non-2xx HTTP status with envelope error", async () => {
      const { CreaderClient } = await loadClient()
      const c = new CreaderClient("k", "https://api.test")
      fetchMock.mockHttpError(404, { success: false, error: { code: "NOT_FOUND", message: "missing" } })
      await expect(c.get("/api/books/x")).rejects.toThrow("missing")
    })

    it("falls back to a generic message when error body lacks a message", async () => {
      const { CreaderClient } = await loadClient()
      const c = new CreaderClient("k", "https://api.test")
      fetchMock.mockHttpError(500, { success: false })
      await expect(c.get("/api/x")).rejects.toThrow(/API error: 500/)
    })

    it("propagates network errors from fetch", async () => {
      const { CreaderClient } = await loadClient()
      const c = new CreaderClient("k", "https://api.test")
      fetchMock.mockReject(new Error("network down"))
      await expect(c.get("/api/x")).rejects.toThrow("network down")
    })
  })

  describe("postRaw", () => {
    it("returns body verbatim and clears cache on success", async () => {
      const { CreaderClient } = await loadClient()
      const c = new CreaderClient("k", "https://api.test")
      fetchMock
        .mockSuccess({ cached: true })
        .mockRaw({ raw: "yes", count: 3 })
        .mockSuccess({ refreshed: true })

      await c.get("/api/x") // populates cache
      const result = await c.postRaw<{ raw: string; count: number }>("/api/raw", { q: 1 })
      await c.get("/api/x") // should refetch since cache was cleared

      expect(result).toEqual({ raw: "yes", count: 3 })
      expect(fetchMock.calls.length).toBe(3)
      expect(fetchMock.calls[1].body).toEqual({ q: 1 })
    })

    it("throws with the API string error on non-2xx", async () => {
      const { CreaderClient } = await loadClient()
      const c = new CreaderClient("k", "https://api.test")
      fetchMock.mockHttpError(403, { error: "forbidden" })
      await expect(c.postRaw("/api/raw")).rejects.toThrow("forbidden")
    })

    it("throws with the API object error message on non-2xx", async () => {
      const { CreaderClient } = await loadClient()
      const c = new CreaderClient("k", "https://api.test")
      fetchMock.mockHttpError(422, { error: { message: "vector dim mismatch" } })
      await expect(c.postRaw("/api/raw")).rejects.toThrow("vector dim mismatch")
    })

    it("falls back to status when body is not JSON", async () => {
      const { CreaderClient } = await loadClient()
      const c = new CreaderClient("k", "https://api.test")
      fetchMock.mockHttpError(500)
      await expect(c.postRaw("/api/raw")).rejects.toThrow(/API error: 500/)
    })
  })

  describe("getClient singleton", () => {
    it("returns the same instance on repeated calls", async () => {
      const { getClient } = await loadClient()
      const a = getClient()
      const b = getClient()
      expect(a).toBe(b)
    })
  })
})
