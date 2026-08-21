import { describe, it, expect, beforeEach, vi } from "vitest"
import { installFetchMock, type FetchMock } from "../../helpers/mock-fetch.js"
import { FakeMcpServer, asToolResult } from "../../helpers/fake-mcp-server.js"
import { fxVolume, fxAct, fxScene } from "../../helpers/fixtures.js"

async function setup() {
  vi.resetModules()
  const { registerStructureTools } = await import("../../../src/tools/structure.js")
  const server = new FakeMcpServer()
  registerStructureTools(server as never)
  return server
}

describe("structure tools", () => {
  let fetchMock: FetchMock

  beforeEach(() => {
    fetchMock = installFetchMock()
  })

  it("registers the three structural read tools", async () => {
    const server = await setup()
    expect(server.names().sort()).toEqual(["list_acts", "list_scenes", "list_volumes"])
  })

  describe("list_volumes", () => {
    it("lists volumes with chapter counts", async () => {
      const server = await setup()
      fetchMock.mockSuccess([fxVolume, { ...fxVolume, id: "vol_2", title: "Volume Two", orderIndex: 1, _count: { chapters: 5 }, description: null }])
      const result = asToolResult(await server.call("list_volumes", { bookId: "book_1" }))
      expect(result.content[0].text).toContain("1. Volume One (2 chapters) id:vol_1: The beginning.")
      expect(result.content[0].text).toContain("2. Volume Two (5 chapters) id:vol_2")
      expect(fetchMock.lastCall()?.url).toBe("https://test.creader.local/api/books/book_1/volumes")
    })

    it("handles empty list", async () => {
      const server = await setup()
      fetchMock.mockSuccess([])
      const result = asToolResult(await server.call("list_volumes", { bookId: "book_1" }))
      expect(result.content[0].text).toBe("No volumes found.")
    })

    it("tolerates a missing _count", async () => {
      const server = await setup()
      fetchMock.mockSuccess([{ ...fxVolume, _count: undefined }])
      const result = asToolResult(await server.call("list_volumes", { bookId: "book_1" }))
      expect(result.content[0].text).toContain("(0 chapters)")
    })
  })

  describe("list_acts", () => {
    it("lists acts with their parent volume — the API field is `name`, not `title`", async () => {
      const server = await setup()
      fetchMock.mockSuccess([fxAct, { ...fxAct, id: "act_2", name: "Act Two", volumeId: null, orderIndex: 1, description: null }])
      const result = asToolResult(await server.call("list_acts", { bookId: "book_1" }))
      expect(result.content[0].text).toContain("- Act One id:act_1 volume:vol_1 order:0: Setup.")
      // An act outside any volume must still be visible, not rendered as broken.
      expect(result.content[0].text).toContain("- Act Two id:act_2 volume:none order:1")
      expect(fetchMock.lastCall()?.url).toBe("https://test.creader.local/api/books/book_1/acts")
    })

    it("handles empty list", async () => {
      const server = await setup()
      fetchMock.mockSuccess([])
      const result = asToolResult(await server.call("list_acts", { bookId: "book_1" }))
      expect(result.content[0].text).toBe("No acts found.")
    })
  })

  describe("list_scenes", () => {
    it("lists scenes with chapter/act parents and status", async () => {
      const server = await setup()
      fetchMock.mockSuccess([fxScene, { ...fxScene, id: "scene_2", title: "Chase", chapterId: null, actId: null, status: null, synopsis: null, orderIndex: 1 }])
      const result = asToolResult(await server.call("list_scenes", { bookId: "book_1" }))
      expect(result.content[0].text).toContain("- Opening (draft) id:scene_1 chapter:chap_1 act:act_1 order:0: Alice wakes.")
      expect(result.content[0].text).toContain("- Chase id:scene_2 chapter:none act:none order:1")
      expect(fetchMock.lastCall()?.url).toBe("https://test.creader.local/api/books/book_1/scenes")
    })

    it("handles empty list", async () => {
      const server = await setup()
      fetchMock.mockSuccess([])
      const result = asToolResult(await server.call("list_scenes", { bookId: "book_1" }))
      expect(result.content[0].text).toBe("No scenes found.")
    })
  })

  it("propagates API errors as tool errors", async () => {
    const server = await setup()
    fetchMock.mockApiError("NOT_FOUND", "no such book")
    const result = asToolResult(await server.call("list_volumes", { bookId: "nope" }))
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("no such book")
  })
})
