import { describe, it, expect, beforeEach, vi } from "vitest"
import { installFetchMock, type FetchMock } from "../../helpers/mock-fetch.js"
import { FakeMcpServer, asToolResult } from "../../helpers/fake-mcp-server.js"
import { fxBook, fxChapter, fxCharacter, fxLocation, fxEvent } from "../../helpers/fixtures.js"

async function setup() {
  vi.resetModules()
  const { registerBookTools } = await import("../../../src/tools/books.js")
  const server = new FakeMcpServer()
  registerBookTools(server as never)
  return server
}

describe("book tools", () => {
  let fetchMock: FetchMock

  beforeEach(() => {
    fetchMock = installFetchMock()
  })

  it("registers all four book tools", async () => {
    const server = await setup()
    expect(server.names().sort()).toEqual([
      "create_book",
      "get_book",
      "get_book_context",
      "list_books",
    ])
  })

  describe("list_books", () => {
    it("renders a bullet list of books", async () => {
      const server = await setup()
      fetchMock.mockSuccess([fxBook, { ...fxBook, id: "book_2", title: "Other" }])
      const result = asToolResult(await server.call("list_books"))
      expect(result.isError).toBeFalsy()
      expect(result.content[0].text).toContain("The Test Saga")
      expect(result.content[0].text).toContain("Other")
      expect(fetchMock.lastCall()?.url).toBe("https://test.creader.local/api/books")
      expect(fetchMock.lastCall()?.method).toBe("GET")
    })

    it("returns 'No books found.' when empty", async () => {
      const server = await setup()
      fetchMock.mockSuccess([])
      const result = asToolResult(await server.call("list_books"))
      expect(result.content[0].text).toBe("No books found.")
    })

    it("returns an error result when the API fails", async () => {
      const server = await setup()
      fetchMock.mockApiError("INTERNAL", "boom")
      const result = asToolResult(await server.call("list_books"))
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("boom")
    })
  })

  describe("get_book", () => {
    it("formats book details", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxBook)
      const result = asToolResult(await server.call("get_book", { bookId: "book_1" }))
      expect(result.content[0].text).toContain("Title: The Test Saga")
      expect(result.content[0].text).toContain("ID: book_1")
      expect(result.content[0].text).toContain("Type: novel")
      expect(fetchMock.lastCall()?.url).toBe("https://test.creader.local/api/books/book_1")
    })

    it("omits optional fields when missing", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ ...fxBook, description: undefined, visibility: undefined })
      const result = asToolResult(await server.call("get_book", { bookId: "book_1" }))
      expect(result.content[0].text).not.toContain("Description:")
      expect(result.content[0].text).not.toContain("Visibility:")
    })
  })

  describe("create_book", () => {
    it("POSTs the body and reports the created book", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxBook)
      const result = asToolResult(
        await server.call("create_book", {
          title: "The Test Saga",
          description: "x",
          contentType: "novel",
        })
      )
      expect(result.content[0].text).toContain("Created: The Test Saga")
      const call = fetchMock.lastCall()!
      expect(call.method).toBe("POST")
      expect(call.body).toMatchObject({ title: "The Test Saga", contentType: "novel" })
    })
  })

  describe("get_book_context", () => {
    it("aggregates book + chapters + characters + locations + events", async () => {
      const server = await setup()
      fetchMock
        .mockSuccess(fxBook)
        .mockSuccess([fxChapter])
        .mockSuccess([fxCharacter])
        .mockSuccess([fxLocation])
        .mockSuccess([fxEvent])

      const result = asToolResult(await server.call("get_book_context", { bookId: "book_1" }))
      const text = result.content[0].text
      expect(text).toContain("## Book")
      expect(text).toContain("## Chapters")
      expect(text).toContain("Chapter One")
      expect(text).toContain("## Characters")
      expect(text).toContain("Alice")
      expect(text).toContain("## Locations")
      expect(text).toContain("Wonderland")
      expect(text).toContain("## Events")
      expect(text).toContain("The Fall")
      expect(fetchMock.calls.length).toBe(5)
    })

    it("omits empty sections", async () => {
      const server = await setup()
      fetchMock
        .mockSuccess(fxBook)
        .mockSuccess([])
        .mockSuccess([])
        .mockSuccess([])
        .mockSuccess([])

      const result = asToolResult(await server.call("get_book_context", { bookId: "book_1" }))
      const text = result.content[0].text
      expect(text).toContain("## Book")
      expect(text).not.toContain("## Chapters")
      expect(text).not.toContain("## Characters")
    })

    it("propagates API errors as tool errors", async () => {
      const server = await setup()
      fetchMock.mockHttpError(500, { success: false, error: { code: "X", message: "down" } })
      const result = asToolResult(await server.call("get_book_context", { bookId: "book_1" }))
      expect(result.isError).toBe(true)
    })
  })
})
