import { describe, it, expect, beforeEach, vi } from "vitest"
import { installFetchMock, type FetchMock } from "../../helpers/mock-fetch.js"
import { FakeMcpServer, asToolResult } from "../../helpers/fake-mcp-server.js"
import { fxChapter } from "../../helpers/fixtures.js"
import { contentHash } from "../../../src/lib/content-hash.js"

async function setup() {
  vi.resetModules()
  const { registerChapterTools } = await import("../../../src/tools/chapters.js")
  const server = new FakeMcpServer()
  registerChapterTools(server as never)
  return server
}

describe("chapter tools", () => {
  let fetchMock: FetchMock

  beforeEach(() => {
    fetchMock = installFetchMock()
  })

  it("registers all four chapter tools", async () => {
    const server = await setup()
    expect(server.names().sort()).toEqual([
      "create_chapter",
      "get_chapter",
      "list_chapters",
      "update_chapter",
    ])
  })

  describe("list_chapters", () => {
    it("formats a list of chapters", async () => {
      const server = await setup()
      fetchMock.mockSuccess([fxChapter, { ...fxChapter, id: "chap_2", title: "Two", orderIndex: 1, wordCount: 100 }])
      const result = asToolResult(await server.call("list_chapters", { bookId: "book_1" }))
      expect(result.content[0].text).toContain("1. Chapter One")
      expect(result.content[0].text).toContain("2. Two")
      expect(fetchMock.lastCall()?.url).toBe("https://test.creader.local/api/books/book_1/chapters")
    })

    it("handles empty list", async () => {
      const server = await setup()
      fetchMock.mockSuccess([])
      const result = asToolResult(await server.call("list_chapters", { bookId: "book_1" }))
      expect(result.content[0].text).toBe("No chapters found.")
    })
  })

  describe("get_chapter", () => {
    it("renders title, id, word count, and content", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxChapter)
      const result = asToolResult(await server.call("get_chapter", { chapterId: "chap_1" }))
      expect(result.content[0].text).toContain("# Chapter One")
      expect(result.content[0].text).toContain("4 words")
      expect(result.content[0].text).toContain("Once upon a time.")
    })

    it("hands back the baseContentHash of the prose it just read", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxChapter)
      const result = asToolResult(await server.call("get_chapter", { chapterId: "chap_1" }))
      expect(result.content[0].text).toContain(
        `baseContentHash:${contentHash("Once upon a time.")}`
      )
    })

    it("shows '(empty)' when content is missing", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ ...fxChapter, content: undefined })
      const result = asToolResult(await server.call("get_chapter", { chapterId: "chap_1" }))
      expect(result.content[0].text).toContain("(empty)")
    })
  })

  describe("create_chapter", () => {
    it("POSTs to the book's chapters endpoint", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxChapter)
      const result = asToolResult(
        await server.call("create_chapter", {
          bookId: "book_1",
          title: "Chapter One",
          content: "<p>hi</p>",
        })
      )
      expect(result.content[0].text).toContain("Created chapter: Chapter One")
      const call = fetchMock.lastCall()!
      expect(call.method).toBe("POST")
      expect(call.url).toBe("https://test.creader.local/api/books/book_1/chapters")
      expect(call.body).toMatchObject({ title: "Chapter One", content: "<p>hi</p>" })
    })
  })

  describe("update_chapter", () => {
    it("PATCHes a title-only edit without a guard — a title cannot clobber prose", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ ...fxChapter, title: "New Title", wordCount: 8 })
      const result = asToolResult(
        await server.call("update_chapter", {
          chapterId: "chap_1",
          title: "New Title",
        })
      )
      expect(result.content[0].text).toContain("Updated: New Title")
      const call = fetchMock.lastCall()!
      expect(call.method).toBe("PATCH")
      expect(call.url).toBe("https://test.creader.local/api/chapters/chap_1")
      expect(call.body).toMatchObject({ title: "New Title" })
      expect(call.body).not.toHaveProperty("baseContentHash")
    })

    it("refuses a blind content write rather than last-write-wins over the editor", async () => {
      const server = await setup()
      const result = asToolResult(
        await server.call("update_chapter", { chapterId: "chap_1", content: "<p>new</p>" })
      )
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("baseContentHash")
      // The point is that nothing reaches the server at all.
      expect(fetchMock.calls.length).toBe(0)
    })

    it("sends the hash of the prose that was READ, not of the prose being written", async () => {
      const server = await setup()
      fetchMock
        .mockSuccess(fxChapter)
        .mockSuccess({ ...fxChapter, content: "<p>rewritten</p>" })

      await server.call("get_chapter", { chapterId: "chap_1" })
      await server.call("update_chapter", { chapterId: "chap_1", content: "<p>rewritten</p>" })

      // Hashing the NEW content (or re-reading at write time) would satisfy the
      // server's compare-and-swap every time and guard nothing.
      expect(fetchMock.lastCall()!.body).toMatchObject({
        content: "<p>rewritten</p>",
        baseContentHash: contentHash("Once upon a time."),
      })
    })

    it("accepts an explicit baseContentHash, which survives a server restart", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxChapter)
      await server.call("update_chapter", {
        chapterId: "chap_1",
        content: "<p>x</p>",
        baseContentHash: "deadbeef",
      })
      expect(fetchMock.lastCall()!.body).toMatchObject({ baseContentHash: "deadbeef" })
    })

    it("re-baselines after a successful write so consecutive edits need no re-read", async () => {
      const server = await setup()
      fetchMock
        .mockSuccess(fxChapter)
        .mockSuccess({ ...fxChapter, content: "<p>first</p>" })
        .mockSuccess({ ...fxChapter, content: "<p>second</p>" })

      await server.call("get_chapter", { chapterId: "chap_1" })
      await server.call("update_chapter", { chapterId: "chap_1", content: "<p>first</p>" })
      await server.call("update_chapter", { chapterId: "chap_1", content: "<p>second</p>" })

      expect(fetchMock.lastCall()!.body).toMatchObject({
        baseContentHash: contentHash("<p>first</p>"),
      })
    })

    it("treats a create as a baseline, so a fresh chapter can be filled in directly", async () => {
      const server = await setup()
      fetchMock
        .mockSuccess({ ...fxChapter, content: "" })
        .mockSuccess({ ...fxChapter, content: "<p>body</p>" })

      await server.call("create_chapter", { bookId: "book_1", title: "Chapter One" })
      const result = asToolResult(
        await server.call("update_chapter", { chapterId: "chap_1", content: "<p>body</p>" })
      )

      expect(result.isError).toBeUndefined()
      expect(fetchMock.lastCall()!.body).toMatchObject({ baseContentHash: contentHash("") })
    })

    it("reports a 409 as a conflict and neither retries nor overwrites", async () => {
      const server = await setup()
      fetchMock
        .mockSuccess(fxChapter)
        .mockHttpError(409, {
          success: false,
          error: {
            code: "CHAPTER_CONTENT_CONFLICT",
            message: "Chapter content changed since this draft was made",
          },
        })

      await server.call("get_chapter", { chapterId: "chap_1" })
      const result = asToolResult(
        await server.call("update_chapter", { chapterId: "chap_1", content: "<p>mine</p>" })
      )

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("Conflict")
      expect(result.content[0].text).toContain("no words were lost")
      expect(result.content[0].text).toContain("Chapter content changed since this draft was made")
      // Exactly one GET + one rejected PATCH: no silent retry, no re-send
      // without the guard.
      expect(fetchMock.calls.length).toBe(2)
    })

    it("drops the stale baseline on conflict so the caller must re-read", async () => {
      const server = await setup()
      fetchMock
        .mockSuccess(fxChapter)
        .mockHttpError(409, {
          success: false,
          error: { code: "CHAPTER_CONTENT_CONFLICT", message: "conflict" },
        })

      await server.call("get_chapter", { chapterId: "chap_1" })
      await server.call("update_chapter", { chapterId: "chap_1", content: "<p>mine</p>" })

      // Keeping the dead pre-image would let the caller loop forever on the
      // same rejected write.
      const retry = asToolResult(
        await server.call("update_chapter", { chapterId: "chap_1", content: "<p>mine</p>" })
      )
      expect(retry.isError).toBe(true)
      expect(retry.content[0].text).toContain("Call get_chapter first")
      expect(fetchMock.calls.length).toBe(2)
    })

    it("returns tool error on API failure", async () => {
      const server = await setup()
      fetchMock.mockApiError("BAD", "nope")
      const result = asToolResult(
        await server.call("update_chapter", { chapterId: "chap_1", title: "x" })
      )
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("nope")
    })
  })
})
