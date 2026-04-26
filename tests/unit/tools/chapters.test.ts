import { describe, it, expect, beforeEach, vi } from "vitest"
import { installFetchMock, type FetchMock } from "../../helpers/mock-fetch.js"
import { FakeMcpServer, asToolResult } from "../../helpers/fake-mcp-server.js"
import { fxChapter } from "../../helpers/fixtures.js"

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
    it("PATCHes by chapter id", async () => {
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
