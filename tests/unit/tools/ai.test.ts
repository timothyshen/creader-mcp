import { describe, it, expect, beforeEach, vi } from "vitest"
import { installFetchMock, type FetchMock } from "../../helpers/mock-fetch.js"
import { FakeMcpServer, asToolResult } from "../../helpers/fake-mcp-server.js"
import { fxChapter, fxVectorCheck } from "../../helpers/fixtures.js"

async function setup() {
  vi.resetModules()
  const { registerAITools } = await import("../../../src/tools/ai.js")
  const server = new FakeMcpServer()
  registerAITools(server as never)
  return server
}

describe("AI tools", () => {
  let fetchMock: FetchMock

  beforeEach(() => {
    fetchMock = installFetchMock()
  })

  it("registers all five AI tools", async () => {
    const server = await setup()
    expect(server.names().sort()).toEqual([
      "analyze_book",
      "consistency_check",
      "generate_outline",
      "proofread",
      "vector_check",
    ])
  })

  describe("generate_outline", () => {
    it("POSTs to /api/onboarding/generate-outline with defaults", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ chapters: [{ title: "Ch 1" }] })
      const result = asToolResult(
        await server.call("generate_outline", {
          title: "X",
          premise: "y",
        })
      )
      expect(result.content[0].text).toContain("Ch 1")
      const call = fetchMock.lastCall()!
      expect(call.url).toBe("https://test.creader.local/api/onboarding/generate-outline")
      expect(call.body).toMatchObject({
        title: "X",
        description: "y",
        chapterCount: 10,
      })
    })

    it("respects an explicit chapterCount", async () => {
      const server = await setup()
      fetchMock.mockSuccess({})
      await server.call("generate_outline", { title: "X", premise: "y", chapterCount: 3 })
      expect(fetchMock.lastCall()!.body).toMatchObject({ chapterCount: 3 })
    })
  })

  describe("consistency_check", () => {
    it("POSTs to the guardian quick-check endpoint", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ issues: [] })
      await server.call("consistency_check", { bookId: "book_1" })
      expect(fetchMock.lastCall()!.url).toBe(
        "https://test.creader.local/api/books/book_1/guardian/quick-check"
      )
      expect(fetchMock.lastCall()!.method).toBe("POST")
    })
  })

  describe("analyze_book", () => {
    it("fetches the chapter then POSTs to guardian/analyze", async () => {
      const server = await setup()
      fetchMock
        .mockSuccess(fxChapter)
        .mockSuccess([{ id: "i1", severity: "warning", category: "plot", title: "T", description: "D", fingerprint: "f", timestamp: 1 }])

      const result = asToolResult(
        await server.call("analyze_book", { bookId: "book_1", chapterId: "chap_1" })
      )
      expect(result.content[0].text).toContain("\"category\": \"plot\"")
      expect(fetchMock.calls[0].method).toBe("GET")
      expect(fetchMock.calls[1].method).toBe("POST")
      expect(fetchMock.calls[1].body).toMatchObject({
        chapterId: "chap_1",
        chapterContent: "Once upon a time.",
      })
    })

    it("returns 'No issues found.' when issues array is empty", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxChapter).mockSuccess([])
      const result = asToolResult(
        await server.call("analyze_book", { bookId: "book_1", chapterId: "chap_1" })
      )
      expect(result.content[0].text).toBe("No issues found.")
    })

    it("returns a tool error when chapter has no content", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ ...fxChapter, content: "" })
      const result = asToolResult(
        await server.call("analyze_book", { bookId: "book_1", chapterId: "chap_1" })
      )
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("no content")
    })
  })

  describe("vector_check", () => {
    it("uses postRaw and returns the raw response JSON-stringified", async () => {
      const server = await setup()
      fetchMock.mockRaw(fxVectorCheck)
      const result = asToolResult(
        await server.call("vector_check", { bookId: "book_1" })
      )
      expect(result.content[0].text).toContain("durationMs")
      expect(fetchMock.lastCall()!.url).toBe(
        "https://test.creader.local/api/books/book_1/guardian/vector-check"
      )
    })

    it("propagates HTTP errors as tool errors", async () => {
      const server = await setup()
      fetchMock.mockHttpError(500, { error: "down" })
      const result = asToolResult(
        await server.call("vector_check", { bookId: "book_1" })
      )
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("down")
    })
  })

  describe("proofread", () => {
    it("fetches the chapter then POSTs to guardian/proofread", async () => {
      const server = await setup()
      fetchMock
        .mockSuccess(fxChapter)
        .mockSuccess([{ id: "p1", severity: "info", category: "typo", title: "T", description: "D", fingerprint: "f", timestamp: 1 }])

      const result = asToolResult(
        await server.call("proofread", { bookId: "book_1", chapterId: "chap_1" })
      )
      expect(result.content[0].text).toContain("\"category\": \"typo\"")
    })

    it("returns 'No proofreading issues found.' when empty", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxChapter).mockSuccess([])
      const result = asToolResult(
        await server.call("proofread", { bookId: "book_1", chapterId: "chap_1" })
      )
      expect(result.content[0].text).toBe("No proofreading issues found.")
    })

    it("returns a tool error when chapter has no content", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ ...fxChapter, content: "" })
      const result = asToolResult(
        await server.call("proofread", { bookId: "book_1", chapterId: "chap_1" })
      )
      expect(result.isError).toBe(true)
    })
  })
})
