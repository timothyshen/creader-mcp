import { describe, it, expect, beforeEach, vi } from "vitest"
import { installFetchMock, type FetchMock } from "../../helpers/mock-fetch.js"
import { FakeMcpServer, asToolResult } from "../../helpers/fake-mcp-server.js"
import { fxVolume, fxAct, fxScene, fxChapter } from "../../helpers/fixtures.js"

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

  it("registers reads and writes for all three levels", async () => {
    const server = await setup()
    expect(server.names().sort()).toEqual([
      "create_act",
      "create_scene",
      "create_volume",
      "delete_act",
      "delete_scene",
      "delete_volume",
      "list_acts",
      "list_scenes",
      "list_volumes",
      "update_act",
      "update_scene",
      "update_volume",
    ])
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

  describe("creates", () => {
    it("create_volume POSTs to the book's volume collection", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ ...fxVolume, title: "Volume Three", orderIndex: 2 })
      const result = asToolResult(
        await server.call("create_volume", { bookId: "book_1", title: "Volume Three" })
      )
      const call = fetchMock.lastCall()!
      expect(call.method).toBe("POST")
      expect(call.url).toBe("https://test.creader.local/api/books/book_1/volumes")
      // bookId travels in the path, never in the body.
      expect(call.body).toEqual({ title: "Volume Three" })
      expect(result.content[0].text).toContain("Created volume: Volume Three (order 2)")
    })

    it("create_act uses `name`, not `title`", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ ...fxAct, name: "Act Two", volumeId: "vol_1" })
      await server.call("create_act", { bookId: "book_1", name: "Act Two", volumeId: "vol_1" })
      expect(fetchMock.lastCall()!.body).toEqual({ name: "Act Two", volumeId: "vol_1" })
      // The one field name that differs across the three levels; getting it
      // wrong is a 400 the model cannot diagnose from the message.
      expect(server.validate("create_act", { bookId: "b", title: "x" }).success).toBe(false)
    })

    it("create_scene links to a chapter and act", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ ...fxScene, title: "The confrontation", chapterId: "chap_4" })
      await server.call("create_scene", {
        bookId: "book_1",
        title: "The confrontation",
        chapterId: "chap_4",
        actId: "act_1",
        pov: "Alice",
      })
      expect(fetchMock.lastCall()!.body).toEqual({
        title: "The confrontation",
        chapterId: "chap_4",
        actId: "act_1",
        pov: "Alice",
      })
    })

    it("omits orderIndex when not given, so the server appends", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxVolume)
      await server.call("create_volume", { bookId: "book_1", title: "X" })
      expect(fetchMock.lastCall()!.body).not.toHaveProperty("orderIndex")
    })
  })

  describe("updates", () => {
    it("update_volume PATCHes the item route with only what changed", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ ...fxVolume, title: "Renamed" })
      await server.call("update_volume", { id: "vol_1", title: "Renamed" })
      const call = fetchMock.lastCall()!
      expect(call.method).toBe("PATCH")
      expect(call.url).toBe("https://test.creader.local/api/volumes/vol_1")
      expect(call.body).toEqual({ title: "Renamed" })
    })

    it("update_act can detach from a volume with an explicit null", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ ...fxAct, volumeId: null })
      await server.call("update_act", { id: "act_1", volumeId: null })
      // null must survive as null — dropping it would silently keep the link.
      expect(fetchMock.lastCall()!.body).toEqual({ volumeId: null })
    })

    it("update_scene PATCHes /api/scenes/:id", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ ...fxScene, status: "written" })
      await server.call("update_scene", { id: "scene_1", status: "written" })
      expect(fetchMock.lastCall()!.url).toBe("https://test.creader.local/api/scenes/scene_1")
    })
  })

  describe("container deletes guard the prose underneath", () => {
    /** Chapters as the list route returns them, with their parent ids. */
    const chapters = [
      { ...fxChapter, id: "c1", title: "One", wordCount: 1200, volumeId: "vol_1", actId: null },
      { ...fxChapter, id: "c2", title: "Two", wordCount: 900, volumeId: null, actId: "act_1" },
      { ...fxChapter, id: "c3", title: "Three", wordCount: 50, volumeId: null, actId: "act_9" },
    ]
    const acts = [
      { ...fxAct, id: "act_1", volumeId: "vol_1" },
      { ...fxAct, id: "act_9", volumeId: "vol_9" },
    ]

    it("refuses a volume delete that would take prose with it", async () => {
      const server = await setup()
      fetchMock.mockSuccess(chapters).mockSuccess(acts)

      const result = asToolResult(
        await server.call("delete_volume", { bookId: "book_1", id: "vol_1" })
      )

      expect(result.isError).toBe(true)
      // Chapters reached BOTH ways count: c1 hangs off the volume, c2 off one
      // of its acts. Counting only the direct children would understate the
      // damage and let the caller confirm a number smaller than reality.
      expect(result.content[0].text).toContain("deletes 2 chapter(s)")
      expect(result.content[0].text).toContain("One (1200 words)")
      expect(result.content[0].text).toContain("Two (900 words)")
      expect(result.content[0].text).toContain("confirmChapterCount:2")
      // c3 lives under another volume and must not appear.
      expect(result.content[0].text).not.toContain("Three")
      // Nothing was sent.
      expect(fetchMock.calls.every(c => c.method === "GET")).toBe(true)
    })

    it("refuses a confirmation that does not match the real count", async () => {
      const server = await setup()
      fetchMock.mockSuccess(chapters).mockSuccess(acts)
      const result = asToolResult(
        await server.call("delete_volume", {
          bookId: "book_1",
          id: "vol_1",
          confirmChapterCount: 1,
        })
      )
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("You passed confirmChapterCount:1")
      expect(fetchMock.calls.every(c => c.method === "GET")).toBe(true)
    })

    it("proceeds when the confirmed number matches", async () => {
      const server = await setup()
      fetchMock.mockSuccess(chapters).mockSuccess(acts).mockSuccess(null)
      const result = asToolResult(
        await server.call("delete_volume", {
          bookId: "book_1",
          id: "vol_1",
          confirmChapterCount: 2,
        })
      )
      expect(result.isError).toBeUndefined()
      const del = fetchMock.lastCall()!
      expect(del.method).toBe("DELETE")
      expect(del.url).toBe("https://test.creader.local/api/volumes/vol_1")
      expect(result.content[0].text).toContain("along with 2 chapter(s)")
    })

    it("deletes an empty container without asking", async () => {
      const server = await setup()
      fetchMock.mockSuccess(chapters).mockSuccess(acts).mockSuccess(null)
      const result = asToolResult(
        await server.call("delete_volume", { bookId: "book_1", id: "vol_empty" })
      )
      expect(result.isError).toBeUndefined()
      expect(result.content[0].text).toContain("held no chapters")
      expect(fetchMock.lastCall()!.method).toBe("DELETE")
    })

    it("delete_act counts only its own chapters", async () => {
      const server = await setup()
      fetchMock.mockSuccess(chapters)
      const result = asToolResult(
        await server.call("delete_act", { bookId: "book_1", id: "act_1" })
      )
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("deletes 1 chapter(s)")
      expect(result.content[0].text).toContain("Two (900 words)")
      // An act delete does not reach across to the volume's other chapters.
      expect(result.content[0].text).not.toContain("One (1200 words)")
    })

    it("delete_scene needs no confirmation — it takes nothing with it", async () => {
      const server = await setup()
      fetchMock.mockSuccess(null)
      const result = asToolResult(await server.call("delete_scene", { id: "scene_1" }))
      expect(result.isError).toBeUndefined()
      expect(fetchMock.calls).toHaveLength(1)
      expect(fetchMock.lastCall()!.method).toBe("DELETE")
    })
  })
})
