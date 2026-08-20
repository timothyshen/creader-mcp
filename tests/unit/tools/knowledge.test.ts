import { describe, it, expect, beforeEach, vi } from "vitest"
import { installFetchMock, type FetchMock } from "../../helpers/mock-fetch.js"
import { FakeMcpServer, asToolResult } from "../../helpers/fake-mcp-server.js"
import { fxCharacter, fxLocation, fxEvent, fxNote } from "../../helpers/fixtures.js"

async function setup() {
  vi.resetModules()
  const { registerKnowledgeTools } = await import("../../../src/tools/knowledge.js")
  const server = new FakeMcpServer()
  registerKnowledgeTools(server as never)
  return server
}

describe("knowledge tools", () => {
  let fetchMock: FetchMock

  beforeEach(() => {
    fetchMock = installFetchMock()
  })

  it("registers all 14 knowledge tools", async () => {
    const server = await setup()
    expect(server.names().sort()).toEqual([
      "create_character",
      "create_event",
      "create_location",
      "create_note",
      "delete_character",
      "delete_event",
      "delete_location",
      "delete_note",
      "list_knowledge",
      "search_knowledge",
      "update_character",
      "update_event",
      "update_location",
      "update_note",
    ])
  })

  describe("search_knowledge", () => {
    it("hits /knowledge/search — the bare /knowledge URL never existed", async () => {
      const server = await setup()
      fetchMock.mockRaw({ results: [], total: 0, query: "magic sword" })
      await server.call("search_knowledge", {
        bookId: "book_1",
        query: "magic sword",
        type: "character",
      })
      const url = fetchMock.lastCall()!.url
      expect(url).toBe(
        "https://test.creader.local/api/books/book_1/knowledge/search?q=magic%20sword&type=character"
      )
    })

    it("reads the bare-JSON body — this route has no { success, data } envelope", async () => {
      const server = await setup()
      // Sent through the enveloped client this 200 would throw "API error: 200",
      // so pointing the URL at the right route is only half the fix.
      fetchMock.mockRaw({
        results: [{ id: "char_1", type: "character", title: "Alice", content: "", tags: [], rank: 5, createdAt: "", updatedAt: "" }],
        total: 1,
        query: "Alice",
      })
      const result = asToolResult(
        await server.call("search_knowledge", { bookId: "book_1", query: "Alice" })
      )
      expect(result.isError).toBeUndefined()
      expect(JSON.parse(result.content[0].text).results[0].title).toBe("Alice")
    })

    it("omits the type and limit params when not provided", async () => {
      const server = await setup()
      fetchMock.mockRaw({ results: [], total: 0, query: "xy" })
      await server.call("search_knowledge", { bookId: "book_1", query: "xy" })
      expect(fetchMock.lastCall()!.url).not.toContain("type=")
      expect(fetchMock.lastCall()!.url).not.toContain("limit=")
    })

    it("passes an explicit limit through", async () => {
      const server = await setup()
      fetchMock.mockRaw({ results: [], total: 0, query: "xy" })
      await server.call("search_knowledge", { bookId: "book_1", query: "xy", limit: 5 })
      expect(fetchMock.lastCall()!.url).toContain("limit=5")
    })

    it("returns tool error on API failure", async () => {
      const server = await setup()
      fetchMock.mockHttpError(404, { error: "Book not found" })
      const result = asToolResult(
        await server.call("search_knowledge", { bookId: "book_1", query: "xy" })
      )
      expect(result.isError).toBe(true)
    })
  })

  describe("list_knowledge", () => {
    it("lists characters", async () => {
      const server = await setup()
      fetchMock.mockSuccess([fxCharacter])
      const result = asToolResult(
        await server.call("list_knowledge", { bookId: "book_1", type: "characters" })
      )
      expect(result.content[0].text).toContain("Alice")
      expect(fetchMock.lastCall()!.url).toContain("/characters")
    })

    it("lists locations", async () => {
      const server = await setup()
      fetchMock.mockSuccess([fxLocation])
      const result = asToolResult(
        await server.call("list_knowledge", { bookId: "book_1", type: "locations" })
      )
      expect(result.content[0].text).toContain("Wonderland")
      expect(fetchMock.lastCall()!.url).toContain("/locations")
    })

    it("lists events", async () => {
      const server = await setup()
      fetchMock.mockSuccess([fxEvent])
      const result = asToolResult(
        await server.call("list_knowledge", { bookId: "book_1", type: "events" })
      )
      expect(result.content[0].text).toContain("The Fall")
      expect(fetchMock.lastCall()!.url).toContain("/timeline-events")
    })

    it("returns 'No characters found.' when empty", async () => {
      const server = await setup()
      fetchMock.mockSuccess([])
      const result = asToolResult(
        await server.call("list_knowledge", { bookId: "book_1", type: "characters" })
      )
      expect(result.content[0].text).toBe("No characters found.")
    })

    it("returns 'No locations found.' when empty", async () => {
      const server = await setup()
      fetchMock.mockSuccess([])
      const result = asToolResult(
        await server.call("list_knowledge", { bookId: "book_1", type: "locations" })
      )
      expect(result.content[0].text).toBe("No locations found.")
    })

    it("returns 'No events found.' when empty", async () => {
      const server = await setup()
      fetchMock.mockSuccess([])
      const result = asToolResult(
        await server.call("list_knowledge", { bookId: "book_1", type: "events" })
      )
      expect(result.content[0].text).toBe("No events found.")
    })
  })

  describe("create operations", () => {
    it("create_character POSTs and reports created entity", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxCharacter)
      const result = asToolResult(
        await server.call("create_character", {
          bookId: "book_1",
          name: "Alice",
          role: "protagonist",
        })
      )
      expect(result.content[0].text).toContain("Created character: Alice")
      expect(fetchMock.lastCall()!.method).toBe("POST")
    })

    it("create_location POSTs", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxLocation)
      const result = asToolResult(
        await server.call("create_location", {
          bookId: "book_1",
          name: "Wonderland",
          type: "realm",
        })
      )
      expect(result.content[0].text).toContain("Created location: Wonderland")
    })

    it("create_event POSTs", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxEvent)
      const result = asToolResult(
        await server.call("create_event", {
          bookId: "book_1",
          title: "The Fall",
          eventType: "plot",
          timestamp: 1,
        })
      )
      expect(result.content[0].text).toContain("Created event: The Fall")
    })

    it("create_note POSTs", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxNote)
      const result = asToolResult(
        await server.call("create_note", {
          bookId: "book_1",
          title: "Theme idea",
        })
      )
      expect(result.content[0].text).toContain("Created note: Theme idea")
    })
  })

  describe("update operations", () => {
    it("update_character PATCHes /api/characters/:id", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxCharacter)
      await server.call("update_character", { id: "char_1", description: "new" })
      const call = fetchMock.lastCall()!
      expect(call.method).toBe("PATCH")
      expect(call.url).toBe("https://test.creader.local/api/characters/char_1")
      expect(call.body).toMatchObject({ description: "new" })
    })

    it("update_location PATCHes /api/locations/:id", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxLocation)
      await server.call("update_location", { id: "loc_1", name: "X" })
      expect(fetchMock.lastCall()!.url).toBe("https://test.creader.local/api/locations/loc_1")
    })

    it("update_event PATCHes /api/timeline-events/:id", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxEvent)
      await server.call("update_event", { id: "evt_1", title: "X" })
      expect(fetchMock.lastCall()!.url).toBe("https://test.creader.local/api/timeline-events/evt_1")
    })

    it("update_note PATCHes /api/notes/:id", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxNote)
      await server.call("update_note", { id: "note_1", title: "X" })
      expect(fetchMock.lastCall()!.url).toBe("https://test.creader.local/api/notes/note_1")
    })
  })

  describe("delete operations", () => {
    it("delete_character DELETEs", async () => {
      const server = await setup()
      fetchMock.mockSuccess(null)
      const result = asToolResult(await server.call("delete_character", { id: "char_1" }))
      expect(result.content[0].text).toContain("Deleted character char_1")
      expect(fetchMock.lastCall()!.method).toBe("DELETE")
    })

    it("delete_location DELETEs", async () => {
      const server = await setup()
      fetchMock.mockSuccess(null)
      await server.call("delete_location", { id: "loc_1" })
      expect(fetchMock.lastCall()!.url).toContain("/api/locations/loc_1")
    })

    it("delete_event DELETEs", async () => {
      const server = await setup()
      fetchMock.mockSuccess(null)
      await server.call("delete_event", { id: "evt_1" })
      expect(fetchMock.lastCall()!.url).toContain("/api/timeline-events/evt_1")
    })

    it("delete_note DELETEs", async () => {
      const server = await setup()
      fetchMock.mockSuccess(null)
      await server.call("delete_note", { id: "note_1" })
      expect(fetchMock.lastCall()!.url).toContain("/api/notes/note_1")
    })

    it("returns tool error when delete fails", async () => {
      const server = await setup()
      fetchMock.mockApiError("FORBIDDEN", "no")
      const result = asToolResult(await server.call("delete_character", { id: "char_1" }))
      expect(result.isError).toBe(true)
    })
  })
})
