import { describe, it, expect, beforeEach, vi } from "vitest"
import { installFetchMock, type FetchMock } from "../../helpers/mock-fetch.js"
import { FakeMcpServer, asToolResult } from "../../helpers/fake-mcp-server.js"
import { fxRelation } from "../../helpers/fixtures.js"

async function setup() {
  vi.resetModules()
  const { registerRelationTools } = await import("../../../src/tools/relations.js")
  const server = new FakeMcpServer()
  registerRelationTools(server as never)
  return server
}

describe("relation tools", () => {
  let fetchMock: FetchMock

  beforeEach(() => {
    fetchMock = installFetchMock()
  })

  it("registers all four relation tools", async () => {
    const server = await setup()
    expect(server.names().sort()).toEqual([
      "create_relation",
      "delete_relation",
      "list_relations",
      "update_relation",
    ])
  })

  describe("list_relations", () => {
    it("renders rich relation lines", async () => {
      const server = await setup()
      fetchMock.mockSuccess([{ ...fxRelation, description: "lives there" }])
      const result = asToolResult(await server.call("list_relations", { bookId: "book_1" }))
      const text = result.content[0].text
      expect(text).toContain("[character:char_1]")
      expect(text).toContain("--lives_in-->")
      expect(text).toContain("[location:loc_1]")
      expect(text).toContain("inverse: houses")
      expect(text).toContain("strength:1")
      expect(text).toContain("lives there")
    })

    it("returns 'No relations found.' when empty", async () => {
      const server = await setup()
      fetchMock.mockSuccess([])
      const result = asToolResult(await server.call("list_relations", { bookId: "book_1" }))
      expect(result.content[0].text).toBe("No relations found.")
    })

    it("omits inverse and description when missing", async () => {
      const server = await setup()
      fetchMock.mockSuccess([{ ...fxRelation, inverseType: null, description: null }])
      const result = asToolResult(await server.call("list_relations", { bookId: "book_1" }))
      expect(result.content[0].text).not.toContain("inverse:")
    })
  })

  describe("create_relation", () => {
    it("POSTs to /semantic-relations and reports the created edge", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxRelation)
      const result = asToolResult(
        await server.call("create_relation", {
          bookId: "book_1",
          sourceId: "char_1",
          sourceType: "character",
          targetId: "loc_1",
          targetType: "location",
          type: "lives_in",
        })
      )
      expect(result.content[0].text).toContain("Created relation")
      expect(result.content[0].text).toContain("--lives_in-->")
      expect(fetchMock.lastCall()!.url).toBe(
        "https://test.creader.local/api/books/book_1/semantic-relations"
      )
    })
  })

  describe("update_relation", () => {
    it("PATCHes /api/semantic-relations/:id", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ ...fxRelation, description: "updated" })
      await server.call("update_relation", { id: "rel_1", description: "updated" })
      const call = fetchMock.lastCall()!
      expect(call.method).toBe("PATCH")
      expect(call.url).toBe("https://test.creader.local/api/semantic-relations/rel_1")
      expect(call.body).toMatchObject({ description: "updated" })
    })
  })

  describe("delete_relation", () => {
    it("DELETEs /api/semantic-relations/:id", async () => {
      const server = await setup()
      fetchMock.mockSuccess(null)
      const result = asToolResult(await server.call("delete_relation", { id: "rel_1" }))
      expect(result.content[0].text).toBe("Deleted relation rel_1")
      expect(fetchMock.lastCall()!.method).toBe("DELETE")
    })

    it("returns tool error on failure", async () => {
      const server = await setup()
      fetchMock.mockApiError("X", "boom")
      const result = asToolResult(await server.call("delete_relation", { id: "rel_1" }))
      expect(result.isError).toBe(true)
    })
  })
})
