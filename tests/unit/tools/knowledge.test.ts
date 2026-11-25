import { describe, it, expect, beforeEach, vi } from "vitest"
import { installFetchMock, type FetchMock } from "../../helpers/mock-fetch.js"
import { FakeMcpServer, asToolResult } from "../../helpers/fake-mcp-server.js"
import { fxCharacter, fxLocation, fxEvent, fxNote } from "../../helpers/fixtures.js"
import type { Note } from "../../../src/lib/types.js"

// One of each kind that matters to a filter, in the order the route sends them
// (most recently updated first).
const fxBookNotes: Note[] = [
  { id: "note_p", bookId: "book_1", title: "No resurrection", content: "The dead stay dead.", noteType: "prohibition" },
  { id: "note_g", bookId: "book_1", title: "Loose end", content: "", noteType: "general" },
  { id: "note_r2", bookId: "book_1", title: "Tides", content: "Two a day.", noteType: "rule" },
  { id: "note_w", bookId: "book_1", title: "The Guild", content: "Runs the harbour.", noteType: "worldbuilding" },
  { id: "note_r1", bookId: "book_1", title: "Magic costs blood", content: "Always the caster's own.", noteType: "rule" },
]

async function setup() {
  vi.resetModules()
  const { registerKnowledgeTools } = await import("../../../src/tools/knowledge.js")
  const server = new FakeMcpServer()
  registerKnowledgeTools(server as never)
  return server
}

/**
 * Call a tool with its args put through the registered shape first, the way the
 * SDK does. A key the shape does not declare is dropped on the way, so a plain
 * call() would let a handler that spreads its args pass for a tool that cannot
 * actually receive the field.
 */
async function callParsed(server: FakeMcpServer, name: string, args: Record<string, unknown>) {
  const parsed = server.validate(name, args)
  if (!parsed.success) throw parsed.error
  return asToolResult(await server.call(name, parsed.data))
}

describe("knowledge tools", () => {
  let fetchMock: FetchMock

  beforeEach(() => {
    fetchMock = installFetchMock()
  })

  it("registers all 16 knowledge tools", async () => {
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
      "get_character",
      "list_knowledge",
      "list_notes",
      "search_knowledge",
      "update_character",
      "update_event",
      "update_location",
      "update_note",
    ])
  })

  describe("v1.3.0 deprecation bridge", () => {
    const DEPRECATED: Record<string, string> = {
      create_character: `create_entity(type: "character")`,
      create_location: `create_entity(type: "location")`,
      create_event: `create_entity(type: "event")`,
      create_note: `create_entity(type: "note")`,
      update_character: `update_entity(type: "character")`,
      update_location: `update_entity(type: "location")`,
      update_event: `update_entity(type: "event")`,
      update_note: `update_entity(type: "note")`,
      delete_character: `delete_entity(type: "character")`,
      delete_location: `delete_entity(type: "location")`,
      delete_event: `delete_entity(type: "event")`,
      delete_note: `delete_entity(type: "note")`,
    }

    it("marks all 12 per-type CRUD tools deprecated, each naming its v2.0.0 replacement", async () => {
      const server = await setup()
      for (const [name, replacement] of Object.entries(DEPRECATED)) {
        const description = server.tools.get(name)!.description
        expect(description, name).toMatch(/^\[DEPRECATED — v2\.0\.0 will replace this with /)
        expect(description, name).toContain(replacement)
        // The replacements do not exist yet — the notice must not read as an
        // instruction to call them today, or an LLM client walks into a
        // tool-not-found error.
        expect(description, name).toContain("it still works today")
      }
    })

    it("leaves the surviving knowledge tools unmarked", async () => {
      const server = await setup()
      for (const name of ["search_knowledge", "list_knowledge", "list_notes", "get_character"]) {
        expect(server.tools.get(name)!.description).not.toContain("DEPRECATED")
      }
    })
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

  describe("get_character", () => {
    it("reads one character with the card list_knowledge leaves out", async () => {
      const server = await setup()
      fetchMock.mockSuccess({
        ...fxCharacter,
        age: 34,
        tags: ["family", "driver"],
        customFields: { goals: "Keep the Lexus", nested: { a: [1, 2] }, coverImageUrl: "https://x/1.png" },
      })
      const result = asToolResult(await server.call("get_character", { id: "char_1" }))
      const call = fetchMock.lastCall()!
      expect(call.method).toBe("GET")
      expect(call.url).toBe("https://test.creader.local/api/characters/char_1")
      expect(result.isError).toBeUndefined()
      expect(result.content[0].text).toBe(
        [
          "# Alice",
          "id:char_1 | protagonist | age 34 | tags: family, driver",
          "",
          "A curious heroine.",
          "",
          "customFields:",
          "{",
          '  "goals": "Keep the Lexus",',
          '  "nested": {',
          '    "a": [',
          "      1,",
          "      2",
          "    ]",
          "  },",
          '  "coverImageUrl": "https://x/1.png"',
          "}",
        ].join("\n")
      )
    })

    it("leaves out what the character does not have, and says the card is empty", async () => {
      // The route answers null for a column that was never written or has been
      // emptied, {} for one created without a card, and a 0 age is an age.
      for (const customFields of [null, {}, []]) {
        const server = await setup()
        fetchMock.mockSuccess({ ...fxCharacter, description: "", age: null, tags: [], customFields })
        const result = asToolResult(await server.call("get_character", { id: "char_1" }))
        expect(result.content[0].text, JSON.stringify(customFields)).toBe(
          "# Alice\nid:char_1 | protagonist\n\ncustomFields: none"
        )
      }
      const server = await setup()
      fetchMock.mockSuccess({ ...fxCharacter, description: "", age: 0, customFields: null })
      const newborn = asToolResult(await server.call("get_character", { id: "char_1" }))
      expect(newborn.content[0].text).toContain("| age 0")
    })

    it("prints chapter-aware storage whole, and says what update_character takes as the key", async () => {
      const server = await setup()
      const customFields = [
        {
          key: "status",
          label: "Life status",
          values: [
            { value: "alive", source: "user" },
            { value: "deceased", source: "ai", chapterId: "c9" },
          ],
        },
      ]
      fetchMock.mockSuccess({ ...fxCharacter, customFields })
      const { text } = asToolResult(await server.call("get_character", { id: "char_1" })).content[0]
      expect(text).toContain('update_character takes each entry\'s "key"')
      expect(JSON.parse(text.slice(text.indexOf("\n[") + 1))).toEqual(customFields)
    })

    it("shows a card just written, not the one cached before the write", async () => {
      const server = await setup()
      fetchMock
        .mockSuccess({ ...fxCharacter, customFields: { goals: "old", arc: "falls" } })
        .mockSuccess(fxCharacter)
        .mockSuccess({ ...fxCharacter, customFields: { goals: "new" } })
      await server.call("get_character", { id: "char_1" })
      await callParsed(server, "update_character", {
        id: "char_1",
        customFields: { goals: "new", arc: null },
      })
      const after = asToolResult(await server.call("get_character", { id: "char_1" }))
      expect(fetchMock.calls.map(c => c.method)).toEqual(["GET", "PATCH", "GET"])
      expect(after.content[0].text).toContain('"goals": "new"')
      expect(after.content[0].text).not.toContain("falls")
    })

    it("is marked read-only", async () => {
      const server = await setup()
      expect(server.tools.get("get_character")!.annotations).toEqual({
        readOnlyHint: true,
        openWorldHint: true,
      })
    })

    it("is where update_character sends you for the stored keys", async () => {
      const server = await setup()
      expect(server.tools.get("update_character")!.description).toContain("get_character")
    })

    it("returns tool error on API failure", async () => {
      const server = await setup()
      fetchMock.mockHttpError(404, {
        success: false,
        error: { code: "NOT_FOUND", message: "Character not found" },
      })
      const result = asToolResult(await server.call("get_character", { id: "nope" }))
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("Character not found")
    })
  })

  describe("list_notes", () => {
    it("lists every note with its id, type and full content", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxBookNotes)
      const result = asToolResult(await server.call("list_notes", { bookId: "book_1" }))
      const call = fetchMock.lastCall()!
      expect(call.method).toBe("GET")
      expect(call.url).toBe("https://test.creader.local/api/books/book_1/notes")
      expect(result.isError).toBeUndefined()
      expect(result.content[0].text).toBe(
        [
          "- No resurrection (prohibition) id:note_p: The dead stay dead.",
          "- Loose end (general) id:note_g",
          "- Tides (rule) id:note_r2: Two a day.",
          "- The Guild (worldbuilding) id:note_w: Runs the harbour.",
          "- Magic costs blood (rule) id:note_r1: Always the caster's own.",
        ].join("\n")
      )
    })

    it("filters by noteType on this side — the route ignores a query string", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxBookNotes)
      const result = asToolResult(
        await server.call("list_notes", { bookId: "book_1", noteType: "rule" })
      )
      // The server returns all of the book's notes whatever is asked for, so a
      // param on the URL would look like a filter and silently be none.
      expect(fetchMock.lastCall()!.url).toBe("https://test.creader.local/api/books/book_1/notes")
      expect(result.content[0].text).toBe(
        [
          "- Tides (rule) id:note_r2: Two a day.",
          "- Magic costs blood (rule) id:note_r1: Always the caster's own.",
        ].join("\n")
      )
    })

    it("keeps the two kinds of world constraint apart", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxBookNotes)
      const result = asToolResult(
        await server.call("list_notes", { bookId: "book_1", noteType: "prohibition" })
      )
      expect(result.content[0].text).toBe(
        "- No resurrection (prohibition) id:note_p: The dead stay dead."
      )
    })

    it("serves a second filter from the same cached read, still unfiltered", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxBookNotes)
      await server.call("list_notes", { bookId: "book_1", noteType: "rule" })
      const all = asToolResult(await server.call("list_notes", { bookId: "book_1" }))
      expect(fetchMock.calls).toHaveLength(1)
      expect(all.content[0].text.split("\n")).toHaveLength(fxBookNotes.length)
    })

    it("returns 'No notes found.' when the book has none", async () => {
      const server = await setup()
      fetchMock.mockSuccess([])
      const result = asToolResult(await server.call("list_notes", { bookId: "book_1" }))
      expect(result.content[0].text).toBe("No notes found.")
    })

    it("names the filter when nothing matches it, so it does not read as an empty book", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxBookNotes)
      const result = asToolResult(
        await server.call("list_notes", { bookId: "book_1", noteType: "research" })
      )
      expect(result.content[0].text).toBe("No research notes found.")
    })

    it("takes the six noteTypes create_note takes, and nothing else", async () => {
      const server = await setup()
      for (const noteType of ["worldbuilding", "research", "note", "general", "rule", "prohibition"]) {
        expect(server.validate("list_notes", { bookId: "b", noteType }).success, noteType).toBe(true)
        expect(
          server.validate("create_note", { bookId: "b", title: "T", noteType }).success,
          noteType
        ).toBe(true)
      }
      expect(server.validate("list_notes", { bookId: "b" }).success).toBe(true)
      expect(server.validate("list_notes", { bookId: "b", noteType: "law" }).success).toBe(false)
      expect(server.validate("list_notes", {}).success).toBe(false)
    })

    it("is marked read-only", async () => {
      const server = await setup()
      expect(server.tools.get("list_notes")!.annotations).toEqual({
        readOnlyHint: true,
        openWorldHint: true,
      })
    })

    it("returns tool error on API failure", async () => {
      const server = await setup()
      fetchMock.mockHttpError(404, {
        success: false,
        error: { code: "NOT_FOUND", message: "Project not found" },
      })
      const result = asToolResult(await server.call("list_notes", { bookId: "nope" }))
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("Project not found")
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

    it("create_character sends customFields — the character card — as given", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxCharacter)
      const customFields = {
        goals: "He wants the Lexus; he wants nobody to ask how",
        personality: "Cheerful until money comes up",
        chapterOfDebut: 3,
        nicknames: ["Al"],
      }
      await callParsed(server, "create_character", {
        bookId: "book_1",
        name: "Alice",
        role: "protagonist",
        customFields,
      })
      const call = fetchMock.lastCall()!
      expect(call.method).toBe("POST")
      expect(call.url).toBe("https://test.creader.local/api/books/book_1/characters")
      expect(call.body).toEqual({ name: "Alice", role: "protagonist", customFields })
    })

    it("create_character sends no customFields key when none are given", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxCharacter)
      await callParsed(server, "create_character", {
        bookId: "book_1",
        name: "Alice",
        role: "minor",
      })
      expect(fetchMock.lastCall()!.body).toEqual({ name: "Alice", role: "minor" })
    })

    it("create_character takes customFields as an object only", async () => {
      const server = await setup()
      const base = { bookId: "book_1", name: "Alice", role: "minor" }
      for (const customFields of [null, "goals: the Lexus", ["goals"], 3]) {
        expect(
          server.validate("create_character", { ...base, customFields }).success,
          JSON.stringify(customFields)
        ).toBe(false)
      }
    })

    it("create_character says a null is stored, not a removal", async () => {
      const server = await setup()
      const { description } = server.tools.get("create_character")!
      expect(description).toContain("customFields")
      expect(description).toMatch(/null is stored as null/)
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

    it("create_note accepts the world-constraint note types", async () => {
      const server = await setup()
      const base = { bookId: "book_1", title: "No resurrection" }
      // rule / prohibition are the two noteTypes Creader force-injects into
      // every AI prompt for the book. The enum here omitted them, so an MCP
      // client could write prose but not the laws the prose has to obey.
      expect(server.validate("create_note", { ...base, noteType: "rule" }).success).toBe(true)
      expect(server.validate("create_note", { ...base, noteType: "prohibition" }).success).toBe(true)
      expect(server.validate("create_note", { ...base, noteType: "general" }).success).toBe(true)
      // Still a closed set — the route's zod enum rejects anything else with a 400.
      expect(server.validate("create_note", { ...base, noteType: "law" }).success).toBe(false)
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

    it("update_character passes a customFields patch through, nulls included", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxCharacter)
      // null is how the server is told to remove a key. Dropping it on the way
      // would turn a removal into a no-op that still reports "Updated".
      const customFields = { goals: "Keep the secret", arc: null, coverImageUrl: null }
      await callParsed(server, "update_character", { id: "char_1", customFields })
      const call = fetchMock.lastCall()!
      expect(call.method).toBe("PATCH")
      expect(call.url).toBe("https://test.creader.local/api/characters/char_1")
      expect(call.body).toEqual({ customFields })
    })

    it("update_character sends no customFields key when none are given", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxCharacter)
      await callParsed(server, "update_character", { id: "char_1", name: "Al" })
      expect(fetchMock.lastCall()!.body).toEqual({ name: "Al" })
    })

    it("update_character refuses null for the whole customFields", async () => {
      const server = await setup()
      // The route reads that as "clear the column" — the cover image, the life
      // status and the whole card, in one call. Clients that fill an unused
      // optional argument with null would do it by accident.
      expect(server.validate("update_character", { id: "char_1", customFields: null }).success).toBe(
        false
      )
      expect(
        server.validate("update_character", { id: "char_1", customFields: ["goals"] }).success
      ).toBe(false)
      expect(server.validate("update_character", { id: "char_1", customFields: {} }).success).toBe(
        true
      )
    })

    it("update_character says customFields merges, and how a key is removed", async () => {
      const server = await setup()
      const { description } = server.tools.get("update_character")!
      expect(description).toMatch(/customFields is merged/)
      expect(description).toMatch(/keys you leave out are kept/)
      expect(description).toMatch(/null is removed/)
      expect(description).toMatch(/one level deep/)
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

    it("update_note can promote a plain note to a world constraint", async () => {
      const server = await setup()
      // The product's PATCH route takes the same 6-value enum as POST; create
      // and update must not drift apart on this list.
      expect(server.validate("update_note", { id: "note_1", noteType: "rule" }).success).toBe(true)
      expect(
        server.validate("update_note", { id: "note_1", noteType: "prohibition" }).success
      ).toBe(true)
      expect(server.validate("update_note", { id: "note_1", noteType: "law" }).success).toBe(false)
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
