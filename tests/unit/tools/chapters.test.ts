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

  it("registers all six chapter tools", async () => {
    const server = await setup()
    expect(server.names().sort()).toEqual([
      "create_chapter",
      "delete_chapter",
      "get_chapter",
      "list_chapters",
      "reorder_chapters",
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

  describe("delete_chapter", () => {
    it("DELETEs the chapter and warns that later chapters were renumbered", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ message: "Chapter deleted successfully" })
      const result = asToolResult(await server.call("delete_chapter", { chapterId: "chap_1" }))
      expect(result.isError).toBeUndefined()
      expect(result.content[0].text).toContain("Deleted chapter chap_1")
      expect(result.content[0].text).toContain("renumbered")
      const call = fetchMock.lastCall()!
      expect(call.method).toBe("DELETE")
      expect(call.url).toBe("https://test.creader.local/api/chapters/chap_1")
    })

    it("drops the chapter's content baseline along with the chapter", async () => {
      const server = await setup()
      fetchMock
        .mockSuccess(fxChapter)
        .mockSuccess({ message: "Chapter deleted successfully" })

      await server.call("get_chapter", { chapterId: "chap_1" })
      await server.call("delete_chapter", { chapterId: "chap_1" })

      // A baseline for a deleted row is a lie — a later content write must be
      // refused for lack of one, not sent with a fingerprint of dead prose.
      const result = asToolResult(
        await server.call("update_chapter", { chapterId: "chap_1", content: "<p>x</p>" })
      )
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("baseContentHash")
      expect(fetchMock.calls.length).toBe(2)
    })

    it("propagates API errors (e.g. a key without the delete scope)", async () => {
      const server = await setup()
      fetchMock.mockHttpError(403, {
        success: false,
        error: { code: "FORBIDDEN", message: "This API key lacks the 'delete' scope." },
      })
      const result = asToolResult(await server.call("delete_chapter", { chapterId: "chap_1" }))
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("'delete' scope")
    })
  })

  describe("reorder_chapters", () => {
    const chA = { ...fxChapter, id: "ch_a", title: "A", orderIndex: 0 }
    const chB = { ...fxChapter, id: "ch_b", title: "B", orderIndex: 1 }
    const chC = { ...fxChapter, id: "ch_c", title: "C", orderIndex: 2 }

    it("PATCHes every chapter whose position changed, in list order, without a content guard", async () => {
      const server = await setup()
      fetchMock
        .mockSuccess([chA, chB, chC])
        .mockSuccess({ ...chC, orderIndex: 0 })
        .mockSuccess({ ...chA, orderIndex: 1 })
        .mockSuccess({ ...chB, orderIndex: 2 })

      const result = asToolResult(
        await server.call("reorder_chapters", { bookId: "book_1", chapterIds: ["ch_c", "ch_a", "ch_b"] })
      )

      expect(result.isError).toBeUndefined()
      expect(result.content[0].text).toContain("moved 3 of 3")
      const patches = fetchMock.calls.slice(1)
      expect(patches.map(c => c.url)).toEqual([
        "https://test.creader.local/api/chapters/ch_c",
        "https://test.creader.local/api/chapters/ch_a",
        "https://test.creader.local/api/chapters/ch_b",
      ])
      expect(patches.map(c => c.body)).toEqual([
        { orderIndex: 0 },
        { orderIndex: 1 },
        { orderIndex: 2 },
      ])
      // An orderIndex-only PATCH must not carry the CAS guard — the server
      // arms it only for content writes, and a hash here would be noise.
      for (const p of patches) {
        expect(p.method).toBe("PATCH")
        expect(p.body).not.toHaveProperty("baseContentHash")
        expect(p.body).not.toHaveProperty("content")
      }
    })

    it("writes only the chapters that actually move", async () => {
      const server = await setup()
      fetchMock
        .mockSuccess([chA, chB, chC])
        .mockSuccess({ ...chC, orderIndex: 1 })
        .mockSuccess({ ...chB, orderIndex: 2 })

      await server.call("reorder_chapters", { bookId: "book_1", chapterIds: ["ch_a", "ch_c", "ch_b"] })

      // ch_a is already at 0 — writing it anyway would be a pointless write.
      const patched = fetchMock.calls.slice(1).map(c => c.url)
      expect(patched).toEqual([
        "https://test.creader.local/api/chapters/ch_c",
        "https://test.creader.local/api/chapters/ch_b",
      ])
    })

    it("is a no-op when the requested order matches the server's", async () => {
      const server = await setup()
      fetchMock.mockSuccess([chA, chB, chC])
      const result = asToolResult(
        await server.call("reorder_chapters", { bookId: "book_1", chapterIds: ["ch_a", "ch_b", "ch_c"] })
      )
      expect(result.isError).toBeUndefined()
      expect(result.content[0].text).toContain("already in the requested order")
      expect(fetchMock.calls.length).toBe(1)
    })

    it("rejects a partial list and names the missing chapters, writing nothing", async () => {
      const server = await setup()
      fetchMock.mockSuccess([chA, chB, chC])
      const result = asToolResult(
        await server.call("reorder_chapters", { bookId: "book_1", chapterIds: ["ch_c", "ch_a"] })
      )
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("missing from your list: ch_b")
      expect(fetchMock.calls.length).toBe(1)
    })

    it("rejects IDs from outside the book and duplicates", async () => {
      const server = await setup()
      fetchMock.mockSuccess([chA, chB])
      const result = asToolResult(
        await server.call("reorder_chapters", {
          bookId: "book_1",
          chapterIds: ["ch_a", "ch_b", "ch_zz", "ch_a"],
        })
      )
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("not in this book: ch_zz")
      expect(result.content[0].text).toContain("duplicate")
      expect(fetchMock.calls.length).toBe(1)
    })

    it("re-reads the chapter list even when a fresh cached copy exists", async () => {
      const server = await setup()
      fetchMock
        .mockSuccess([chA, chB, chC]) // list_chapters — populates the cache
        .mockSuccess([chA, chB, chC]) // reorder's forced re-read
        .mockSuccess({ ...chB, orderIndex: 0 })
        .mockSuccess({ ...chA, orderIndex: 1 })

      await server.call("list_chapters", { bookId: "book_1" })
      await server.call("reorder_chapters", { bookId: "book_1", chapterIds: ["ch_b", "ch_a", "ch_c"] })

      // Planning writes from the 60s cache would reorder against a stale
      // snapshot of the book — the tool must invalidate and re-fetch.
      const gets = fetchMock.calls.filter(c => c.method === "GET")
      expect(gets.length).toBe(2)
    })

    it("reports exactly how far it got when a PATCH fails partway", async () => {
      const server = await setup()
      fetchMock
        .mockSuccess([chA, chB, chC])
        .mockSuccess({ ...chC, orderIndex: 0 })
        .mockHttpError(500, { success: false, error: { code: "OOPS", message: "db down" } })

      const result = asToolResult(
        await server.call("reorder_chapters", { bookId: "book_1", chapterIds: ["ch_c", "ch_a", "ch_b"] })
      )

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("Reorder interrupted at chapter ch_a")
      expect(result.content[0].text).toContain("db down")
      expect(result.content[0].text).toContain("Moved 1 of 3")
      expect(result.content[0].text).toContain("ch_c")
      // No blind retry of the failed or remaining writes.
      expect(fetchMock.calls.length).toBe(3)
    })
  })
})
