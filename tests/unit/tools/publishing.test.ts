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

  it("PATCHes /api/books/:id with the visibility field", async () => {
    const server = await setup()
    fetchMock.mockSuccess({})
    const result = asToolResult(
      await server.call("set_visibility", { bookId: "book_1", visibility: "PUBLIC" })
    )
    expect(result.content[0].text).toBe("Visibility set to PUBLIC")
    const call = fetchMock.lastCall()!
    expect(call.method).toBe("PATCH")
    expect(call.url).toBe("https://test.creader.local/api/books/book_1")
    expect(call.body).toEqual({ visibility: "PUBLIC" })
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
