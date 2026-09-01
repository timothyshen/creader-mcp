import { describe, it, expect, beforeEach, vi } from "vitest"
import { installFetchMock, type FetchMock } from "../../helpers/mock-fetch.js"
import { FakeMcpServer, asToolResult } from "../../helpers/fake-mcp-server.js"
import { fxChapter, fxEntityCandidate, fxEntityFact } from "../../helpers/fixtures.js"

async function setup() {
  vi.resetModules()
  const { registerEntityReviewTools } = await import("../../../src/tools/entities.js")
  const server = new FakeMcpServer()
  registerEntityReviewTools(server as never)
  return server
}

describe("entity review tools", () => {
  let fetchMock: FetchMock

  beforeEach(() => {
    fetchMock = installFetchMock()
  })

  it("registers the five entity review tools", async () => {
    const server = await setup()
    expect(server.names().sort()).toEqual([
      "extract_entity_candidates",
      "list_entity_candidates",
      "list_entity_facts",
      "triage_entity_candidate",
      "triage_entity_fact",
    ])
  })

  it("does not resurrect extract_facts", async () => {
    const server = await setup()
    // The old tool proposed a fact delta and handed it back for the caller to
    // apply. What replaced it is a review queue the writer owns. Reusing the
    // name would promise the old contract.
    expect(server.has("extract_facts")).toBe(false)
  })

  describe("extract_entity_candidates", () => {
    it("reads the chapter itself and POSTs stripped prose", async () => {
      const server = await setup()
      fetchMock
        .mockSuccess({ ...fxChapter, content: "<p>Mira met the <em>harbourmaster</em>.</p>" })
        .mockSuccess({ candidates: [fxEntityCandidate] })

      const result = asToolResult(
        await server.call("extract_entity_candidates", {
          bookId: "book_1",
          chapterId: "chap_1",
        })
      )

      expect(fetchMock.calls[0].url).toBe("https://test.creader.local/api/chapters/chap_1")
      const post = fetchMock.calls[1]
      expect(post.method).toBe("POST")
      expect(post.url).toBe("https://test.creader.local/api/books/book_1/entity-candidates")
      expect(post.body).toEqual({
        chapterId: "chap_1",
        content: "Mira met the harbourmaster.",
      })
      expect(result.content[0].text).toContain("harbourmaster")
    })

    it("does not claim the reply is what this run found", async () => {
      const server = await setup()
      fetchMock
        .mockSuccess(fxChapter)
        .mockSuccess({ candidates: [fxEntityCandidate] })
      const result = asToolResult(
        await server.call("extract_entity_candidates", {
          bookId: "book_1",
          chapterId: "chap_1",
        })
      )
      // The route returns every PENDING row on the book, including ones from
      // earlier chapters and earlier runs. "Found 1 new entity" would be false
      // on the second call and every call after it.
      expect(result.content[0].text).toContain("not only this run")
    })

    it("always points at the other queue the same call paid for", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxChapter).mockSuccess({ candidates: [] })
      const result = asToolResult(
        await server.call("extract_entity_candidates", {
          bookId: "book_1",
          chapterId: "chap_1",
        })
      )
      // The maintain leg bills the writer and writes EntityFact rows, which are
      // invisible here. Staying silent would report half a paid-for result as
      // the whole of it.
      expect(result.content[0].text).toContain("list_entity_facts")
    })

    it("says when only part of the chapter was examined", async () => {
      const server = await setup()
      fetchMock
        .mockSuccess({ ...fxChapter, content: `<p>${"word ".repeat(6000)}</p>` })
        .mockSuccess({ candidates: [] })
      const result = asToolResult(
        await server.call("extract_entity_candidates", {
          bookId: "book_1",
          chapterId: "chap_1",
        })
      )
      // The server slices to 24k and says nothing. Silence reads as "the whole
      // chapter was examined", which turns an unseen entity into one the
      // extractor supposedly judged unworthy.
      expect(result.content[0].text).toContain("only the first 24000")
    })

    it("refuses an empty chapter without spending quota", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ ...fxChapter, content: "<p></p>" })
      const result = asToolResult(
        await server.call("extract_entity_candidates", {
          bookId: "book_1",
          chapterId: "chap_1",
        })
      )
      expect(result.isError).toBe(true)
      expect(fetchMock.calls).toHaveLength(1)
    })

    it("surfaces a quota refusal as written", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxChapter).mockHttpError(429, {
        success: false,
        error: { code: "QUOTA_EXCEEDED", message: "Monthly token quota exhausted" },
      })
      const result = asToolResult(
        await server.call("extract_entity_candidates", {
          bookId: "book_1",
          chapterId: "chap_1",
        })
      )
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("quota exhausted")
    })
  })

  describe("list_entity_candidates", () => {
    it("lists the pending queue with triage ids", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ candidates: [fxEntityCandidate] })
      const result = asToolResult(
        await server.call("list_entity_candidates", { bookId: "book_1" })
      )
      expect(fetchMock.lastCall()!.method).toBe("GET")
      expect(result.content[0].text).toContain("[character] harbourmaster")
      expect(result.content[0].text).toContain("id:ec_1")
    })

    it("reports an empty queue plainly", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ candidates: [] })
      const result = asToolResult(
        await server.call("list_entity_candidates", { bookId: "book_1" })
      )
      expect(result.content[0].text).toBe("No entity candidates pending review.")
    })
  })

  describe("triage_entity_candidate", () => {
    it("names the consequence of accepting", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ ok: true })
      const result = asToolResult(
        await server.call("triage_entity_candidate", {
          bookId: "book_1",
          id: "ec_1",
          status: "ACCEPTED",
        })
      )
      const call = fetchMock.lastCall()!
      expect(call.method).toBe("PATCH")
      expect(call.url).toBe(
        "https://test.creader.local/api/books/book_1/entity-candidates/ec_1"
      )
      expect(call.body).toEqual({ status: "ACCEPTED" })
      expect(result.content[0].text).toContain("confirmed entity")
    })

    it("names the consequence of dismissing, which is not undoable", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ ok: true })
      const result = asToolResult(
        await server.call("triage_entity_candidate", {
          bookId: "book_1",
          id: "ec_1",
          status: "DISMISSED",
        })
      )
      // Dismissing deletes the draft row AND keeps the name out of every future
      // extraction. A caller told only "dismissed" would not know the second half.
      expect(result.content[0].text).toContain("draft record is deleted")
      expect(result.content[0].text).toContain("not be proposed again")
    })

    it("takes only the two statuses the route accepts", async () => {
      const server = await setup()
      expect(
        server.validate("triage_entity_candidate", {
          bookId: "b",
          id: "i",
          status: "PENDING",
        }).success
      ).toBe(false)
    })
  })

  describe("list_entity_facts", () => {
    it("defaults to the pending queue and anchors each fact to its chapter", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ facts: [fxEntityFact] })
      const result = asToolResult(await server.call("list_entity_facts", { bookId: "book_1" }))
      expect(fetchMock.lastCall()!.url).toBe(
        "https://test.creader.local/api/books/book_1/entity-facts"
      )
      expect(result.content[0].text).toContain("Mira keeps the letter unopened")
      // Chapter order is 0-based on the wire, 1-based to a reader.
      expect(result.content[0].text).toContain('Ch 4 "The Long Way Down"')
      expect(result.content[0].text).toContain("id:ef_1")
    })

    it("passes an explicit status through", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ facts: [] })
      const result = asToolResult(
        await server.call("list_entity_facts", { bookId: "book_1", status: "ACCEPTED" })
      )
      expect(fetchMock.lastCall()!.url).toBe(
        "https://test.creader.local/api/books/book_1/entity-facts?status=ACCEPTED"
      )
      expect(result.content[0].text).toBe("No accepted entity facts.")
    })
  })

  describe("triage_entity_fact", () => {
    it("says accepting does not rewrite the author's card", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ ok: true })
      const result = asToolResult(
        await server.call("triage_entity_fact", {
          bookId: "book_1",
          id: "ef_1",
          status: "ACCEPTED",
        })
      )
      expect(fetchMock.lastCall()!.url).toBe(
        "https://test.creader.local/api/books/book_1/entity-facts/ef_1"
      )
      // The whole design of the fact log is that accepting appends rather than
      // overwrites. A caller that believes otherwise will accept far less.
      expect(result.content[0].text).toContain("card is unchanged")
    })
  })
})
