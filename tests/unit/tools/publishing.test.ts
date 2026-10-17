import { describe, it, expect, beforeEach, vi } from "vitest"
import { installFetchMock, type FetchMock } from "../../helpers/mock-fetch.js"
import { FakeMcpServer, asToolResult } from "../../helpers/fake-mcp-server.js"

async function setup() {
  vi.resetModules()
  const { registerPublishingTools } = await import("../../../src/tools/publishing.js")
  const server = new FakeMcpServer()
  registerPublishingTools(server as never)
  return server
}

describe("publishing tools", () => {
  let fetchMock: FetchMock

  beforeEach(() => {
    fetchMock = installFetchMock()
  })

  it("registers set_visibility", async () => {
    const server = await setup()
    expect(server.names()).toEqual(["set_visibility"])
  })

  it("POSTs the visibility to the book's publish route, not the book PATCH", async () => {
    // The book PATCH silently drops `visibility`, so going there reported
    // success while nothing changed.
    const server = await setup()
    fetchMock.mockSuccess({
      id: "book_1",
      title: "The Harbour",
      visibility: "PUBLIC",
      publishedAt: "2026-10-11T09:00:00.000Z",
    })
    await server.call("set_visibility", { bookId: "book_1", visibility: "PUBLIC" })
    expect(fetchMock.calls).toHaveLength(1)
    const call = fetchMock.lastCall()!
    expect(call.method).toBe("POST")
    expect(call.url).toBe("https://test.creader.local/api/books/book_1/publish")
    expect(call.body).toEqual({ visibility: "PUBLIC" })
  })

  it("reports the visibility the server confirmed, with the first-published date", async () => {
    const server = await setup()
    fetchMock.mockSuccess({
      id: "book_1",
      title: "The Harbour",
      visibility: "LINK_ONLY",
      publishedAt: "2026-10-11T09:00:00.000Z",
    })
    const result = asToolResult(
      await server.call("set_visibility", { bookId: "book_1", visibility: "LINK_ONLY" })
    )
    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toBe(
      'Visibility set to LINK_ONLY: "The Harbour" (id:book_1). Every chapter now matches.\n' +
        "First published: 2026-10-11T09:00:00.000Z"
    )
  })

  it("omits the first-published line for a book that was never published", async () => {
    const server = await setup()
    fetchMock.mockSuccess({ id: "book_1", title: "The Harbour", visibility: "PRIVATE", publishedAt: null })
    const result = asToolResult(
      await server.call("set_visibility", { bookId: "book_1", visibility: "PRIVATE" })
    )
    expect(result.content[0].text).toBe(
      'Visibility set to PRIVATE: "The Harbour" (id:book_1). Every chapter now matches.'
    )
  })

  it("surfaces the missing 'publish' scope when the key is too narrow", async () => {
    const server = await setup()
    fetchMock.mockHttpError(403, {
      error: "Forbidden",
      type: "scope",
      message: "This API key lacks the 'publish' scope.",
    })
    const result = asToolResult(
      await server.call("set_visibility", { bookId: "book_1", visibility: "PUBLIC" })
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe("Error: This API key lacks the 'publish' scope.")
  })

  it("names the scope and the chapter cascade in its description", async () => {
    const server = await setup()
    const description = server.tools.get("set_visibility")!.description
    expect(description).toContain("'publish' scope")
    expect(description).toContain("Every chapter follows the book")
  })

  it("returns tool error when API fails", async () => {
    const server = await setup()
    fetchMock.mockApiError("X", "denied")
    const result = asToolResult(
      await server.call("set_visibility", { bookId: "book_1", visibility: "PRIVATE" })
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("denied")
  })
})
