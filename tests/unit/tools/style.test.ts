import { describe, it, expect, beforeEach, vi } from "vitest"
import { installFetchMock, type FetchMock } from "../../helpers/mock-fetch.js"
import { FakeMcpServer, asToolResult } from "../../helpers/fake-mcp-server.js"
import { fxStyleFingerprint, fxStyleReference } from "../../helpers/fixtures.js"

async function setup() {
  vi.resetModules()
  const { registerStyleTools } = await import("../../../src/tools/style.js")
  const server = new FakeMcpServer()
  registerStyleTools(server as never)
  return server
}

describe("style tools", () => {
  let fetchMock: FetchMock

  beforeEach(() => {
    fetchMock = installFetchMock()
  })

  it("registers the five style tools", async () => {
    const server = await setup()
    expect(server.names().sort()).toEqual([
      "add_style_references",
      "delete_style_reference",
      "get_style",
      "list_style_references",
      "set_style_learning",
    ])
  })

  it("exposes no way to write the fingerprint", async () => {
    const server = await setup()
    // PUT /style exists and takes an API key, so this absence is a decision,
    // not an oversight. The fingerprint is a MEASUREMENT of prose that exists;
    // a model authoring one fabricates the measurement, and every AI call on
    // the book afterwards is steered by it — quietly, in the wrong voice.
    expect(server.has("set_style")).toBe(false)
    expect(server.has("update_style")).toBe(false)
    expect(server.has("set_style_fingerprint")).toBe(false)
  })

  describe("get_style", () => {
    it("returns the measured fingerprint", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ styleFingerprint: fxStyleFingerprint })
      const result = asToolResult(await server.call("get_style", { bookId: "book_1" }))
      expect(fetchMock.lastCall()!.url).toBe("https://test.creader.local/api/books/book_1/style")
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed).toMatchObject({ tone: "formal", pov: "third", tense: "past" })
    })

    it("says null means not-yet-computed, not styleless", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ styleFingerprint: null })
      const result = asToolResult(await server.call("get_style", { bookId: "book_1" }))
      // "null" printed bare invites the model to conclude the author has no
      // particular voice and to write in its own.
      expect(result.content[0].text).toContain("derived from the manuscript")
      expect(result.content[0].text).not.toBe("null")
    })
  })

  describe("list_style_references", () => {
    it("reports the passages and whether learning is on", async () => {
      const server = await setup()
      fetchMock.mockSuccess({
        styleEnabled: true,
        references: [fxStyleReference],
        count: 1,
      })
      const result = asToolResult(
        await server.call("list_style_references", { bookId: "book_1" })
      )
      expect(fetchMock.lastCall()!.url).toBe(
        "https://test.creader.local/api/books/book_1/style-references"
      )
      expect(result.content[0].text).toContain("1 style reference; style learning is on.")
      expect(result.content[0].text).toContain("id:sr_1")
    })

    it("reports the toggle even when the corpus is empty", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ styleEnabled: false, references: [], count: 0 })
      const result = asToolResult(
        await server.call("list_style_references", { bookId: "book_1" })
      )
      // Empty corpus and learning-off are different facts, and the second one
      // explains why the author's voice is not reaching Creader's own AI calls.
      expect(result.content[0].text).toBe(
        "No style references on this book. Style learning is off."
      )
    })
  })

  describe("add_style_references", () => {
    it("POSTs the batch", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ count: 2 })
      const result = asToolResult(
        await server.call("add_style_references", {
          bookId: "book_1",
          references: [{ content: "A" }, { content: "B" }],
        })
      )
      const call = fetchMock.lastCall()!
      expect(call.method).toBe("POST")
      expect(call.body).toEqual({ references: [{ content: "A" }, { content: "B" }] })
      expect(result.content[0].text).toBe("Added 2 style references.")
    })

    it("reports a batch the server silently trimmed", async () => {
      const server = await setup()
      // The route trims to fit the 500-per-book cap and replies with only what
      // it created. Sent 3, stored 1 — printing "added" would report a partial
      // write as a whole one, and the two dropped passages would never be missed.
      fetchMock.mockSuccess({ count: 1 })
      const result = asToolResult(
        await server.call("add_style_references", {
          bookId: "book_1",
          references: [{ content: "A" }, { content: "B" }, { content: "C" }],
        })
      )
      expect(result.content[0].text).toContain("Added 1 of 3")
      expect(result.content[0].text).toContain("500-reference cap")
    })

    it("surfaces the plan gate as written", async () => {
      const server = await setup()
      fetchMock.mockHttpError(403, {
        success: false,
        error: { code: "FORBIDDEN", message: "Style references require Creator plan" },
      })
      const result = asToolResult(
        await server.call("add_style_references", {
          bookId: "book_1",
          references: [{ content: "A" }],
        })
      )
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("Creator plan")
    })

    it("enforces the server's bounds before spending a round trip", async () => {
      const server = await setup()
      const base = { bookId: "book_1" }
      expect(server.validate("add_style_references", { ...base, references: [] }).success).toBe(
        false
      )
      expect(
        server.validate("add_style_references", {
          ...base,
          references: Array.from({ length: 51 }, () => ({ content: "x" })),
        }).success
      ).toBe(false)
      expect(
        server.validate("add_style_references", {
          ...base,
          references: [{ content: "x".repeat(2001) }],
        }).success
      ).toBe(false)
      expect(
        server.validate("add_style_references", {
          ...base,
          references: [{ content: "x".repeat(2000), source: "archive_import" }],
        }).success
      ).toBe(true)
    })
  })

  describe("delete_style_reference", () => {
    it("DELETEs under the book, and tolerates a reply with no data", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ message: "Style reference deleted" })
      const result = asToolResult(
        await server.call("delete_style_reference", { bookId: "book_1", id: "sr_1" })
      )
      const call = fetchMock.lastCall()!
      expect(call.method).toBe("DELETE")
      expect(call.url).toBe(
        "https://test.creader.local/api/books/book_1/style-references/sr_1"
      )
      expect(result.content[0].text).toBe("Deleted style reference sr_1")
    })
  })

  describe("set_style_learning", () => {
    it("PATCHes the collection route and reports the resulting state", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ styleEnabled: false })
      const result = asToolResult(
        await server.call("set_style_learning", { bookId: "book_1", styleEnabled: false })
      )
      const call = fetchMock.lastCall()!
      expect(call.method).toBe("PATCH")
      // The toggle lives on the collection, not on a /style-learning route.
      expect(call.url).toBe(
        "https://test.creader.local/api/books/book_1/style-references"
      )
      expect(call.body).toEqual({ styleEnabled: false })
      // Reports what the server confirmed, not what was asked for.
      expect(result.content[0].text).toBe("Style learning is now off for this book.")
    })
  })
})
