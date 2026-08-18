import { describe, it, expect, beforeEach, vi } from "vitest"
import { installFetchMock, type FetchMock } from "../../helpers/mock-fetch.js"
import { FakeMcpServer, asToolResult } from "../../helpers/fake-mcp-server.js"
import { fxChapter, fxGuardianRun, fxVectorCheck } from "../../helpers/fixtures.js"

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

  it("registers the three live AI tools", async () => {
    const server = await setup()
    expect(server.names().sort()).toEqual([
      "generate_outline",
      "guardian_check",
      "vector_check",
    ])
  })

  it("no longer exposes the tools whose routes the product deleted", async () => {
    const server = await setup()
    // consistency_check / analyze_book / proofread fronted /guardian/quick-check,
    // /analyze and /proofread. All three were deleted on 2026-05-01 and replaced
    // by the single /guardian/run dispatcher, so every call 404'd.
    expect(server.has("consistency_check")).toBe(false)
    expect(server.has("analyze_book")).toBe(false)
    expect(server.has("proofread")).toBe(false)
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

  describe("guardian_check", () => {
    it("reads the chapter, then POSTs plain text to the run dispatcher", async () => {
      const server = await setup()
      fetchMock
        .mockSuccess({ ...fxChapter, content: "<p>He had a <em>heart of gold</em>.</p>" })
        .mockRaw(fxGuardianRun)

      await server.call("guardian_check", { bookId: "book_1", chapterId: "chap_1" })

      expect(fetchMock.calls[0].method).toBe("GET")
      expect(fetchMock.calls[0].url).toBe("https://test.creader.local/api/chapters/chap_1")
      const call = fetchMock.calls[1]
      expect(call.method).toBe("POST")
      expect(call.url).toBe("https://test.creader.local/api/books/book_1/guardian/run")
      // Offsets in the response index into plainContent, so the tags must be
      // removed without spacers — anything else mislocates every finding.
      expect(call.body).toMatchObject({
        chapterId: "chap_1",
        plainContent: "He had a heart of gold.",
        htmlContent: "<p>He had a <em>heart of gold</em>.</p>",
        trigger: "manual",
      })
    })

    it("defaults to the local budget so a plain check spends no token quota", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxChapter).mockRaw(fxGuardianRun)
      await server.call("guardian_check", { bookId: "book_1", chapterId: "chap_1" })
      expect(fetchMock.calls[1].body).toMatchObject({ costBudget: "local" })
    })

    it("passes through an explicit layer selection and budget", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxChapter).mockRaw(fxGuardianRun)
      await server.call("guardian_check", {
        bookId: "book_1",
        chapterId: "chap_1",
        layers: [2, 5],
        costBudget: "api-heavy",
        locale: "zh",
      })
      expect(fetchMock.calls[1].body).toMatchObject({
        layers: [2, 5],
        costBudget: "api-heavy",
        locale: "zh",
      })
    })

    it("omits layers entirely when none are given, so the server runs all five", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxChapter).mockRaw(fxGuardianRun)
      await server.call("guardian_check", { bookId: "book_1", chapterId: "chap_1" })
      expect(fetchMock.calls[1].body).not.toHaveProperty("layers")
    })

    it("surfaces detector errors and truncation, not just the issue list", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxChapter).mockRaw(fxGuardianRun)
      const result = asToolResult(
        await server.call("guardian_check", { bookId: "book_1", chapterId: "chap_1" })
      )
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.issues).toHaveLength(1)
      expect(parsed.traceId).toBe("run-abc-1234")
      expect(parsed.tokensSpent).toBe(0)
      // A layer whose detector died covered less than the issue count implies.
      // Hiding that would report "clean" for prose nobody actually checked.
      const l2 = parsed.layers.find((l: { layer: number }) => l.layer === 2)
      expect(l2.errors).toEqual([{ detectorId: "l2.proofread", message: "provider timeout" }])
      expect(l2.truncation).toEqual({ analyzedChars: 6000, totalChars: 9000 })
    })

    it("returns a tool error when the chapter has no prose", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ ...fxChapter, content: "<p></p>" })
      const result = asToolResult(
        await server.call("guardian_check", { bookId: "book_1", chapterId: "chap_1" })
      )
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("no content")
    })

    it("propagates dispatcher HTTP errors (e.g. a key without the ai scope)", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxChapter).mockHttpError(403, { error: "This API key lacks the 'ai' scope." })
      const result = asToolResult(
        await server.call("guardian_check", { bookId: "book_1", chapterId: "chap_1" })
      )
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("'ai' scope")
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

})
