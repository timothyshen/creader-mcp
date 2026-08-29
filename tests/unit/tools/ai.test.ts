import { describe, it, expect, beforeEach, vi } from "vitest"
import { installFetchMock, type FetchMock } from "../../helpers/mock-fetch.js"
import { FakeMcpServer, asToolResult } from "../../helpers/fake-mcp-server.js"
import {
  fxChapter,
  fxCharacter,
  fxGuardianRun,
  fxPersist,
  fxPersistedIssue,
  fxLocation,
  fxPlan,
  fxVectorCheck,
} from "../../helpers/fixtures.js"

async function setup() {
  vi.resetModules()
  const { registerAITools } = await import("../../../src/tools/ai.js")
  const server = new FakeMcpServer()
  registerAITools(server as never)
  return server
}

describe("AI tools", () => {
  let fetchMock: FetchMock

  beforeEach(() => {
    fetchMock = installFetchMock()
  })

  it("registers the six live AI tools", async () => {
    const server = await setup()
    expect(server.names().sort()).toEqual([
      "generate_outline",
      "guardian_check",
      "list_guardian_issues",
      "orchestrate",
      "resolve_guardian_issue",
      "vector_check",
    ])
  })

  it("no longer exposes the tools whose routes the product deleted", async () => {
    const server = await setup()
    // consistency_check / analyze_book / proofread fronted /guardian/quick-check,
    // /analyze and /proofread. All three were deleted on 2026-05-01 and replaced
    // by the single /guardian/run dispatcher, so every call 404'd.
    expect(server.has("consistency_check")).toBe(false)
    expect(server.has("analyze_book")).toBe(false)
    expect(server.has("proofread")).toBe(false)
    // extract_facts fronted /api/ai/extract-facts, deleted 2026-08-27 with the
    // rest of the fact-delta chain. entity-candidates is a different contract,
    // so nothing here inherits the name.
    expect(server.has("extract_facts")).toBe(false)
  })

  describe("generate_outline", () => {
    it("POSTs to /api/onboarding/generate-outline with defaults", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ chapters: [{ title: "Ch 1" }] })
      const result = asToolResult(
        await server.call("generate_outline", {
          title: "X",
          premise: "y",
        })
      )
      expect(result.content[0].text).toContain("Ch 1")
      const call = fetchMock.lastCall()!
      expect(call.url).toBe("https://test.creader.local/api/onboarding/generate-outline")
      expect(call.body).toMatchObject({
        title: "X",
        description: "y",
        chapterCount: 10,
      })
    })

    it("respects an explicit chapterCount", async () => {
      const server = await setup()
      fetchMock.mockSuccess({})
      await server.call("generate_outline", { title: "X", premise: "y", chapterCount: 3 })
      expect(fetchMock.lastCall()!.body).toMatchObject({ chapterCount: 3 })
    })
  })

  describe("guardian_check", () => {
    it("reads the chapter, then POSTs plain text to the run dispatcher", async () => {
      const server = await setup()
      fetchMock
        .mockSuccess({ ...fxChapter, content: "<p>He had a <em>heart of gold</em>.</p>" })
        .mockRaw(fxGuardianRun)
        .mockSuccess(fxPersist)

      await server.call("guardian_check", { bookId: "book_1", chapterId: "chap_1" })

      expect(fetchMock.calls[0].method).toBe("GET")
      expect(fetchMock.calls[0].url).toBe("https://test.creader.local/api/chapters/chap_1")
      const call = fetchMock.calls[1]
      expect(call.method).toBe("POST")
      expect(call.url).toBe("https://test.creader.local/api/books/book_1/guardian/run")
      // Offsets in the response index into plainContent, so the tags must be
      // removed without spacers — anything else mislocates every finding.
      expect(call.body).toMatchObject({
        chapterId: "chap_1",
        plainContent: "He had a heart of gold.",
        htmlContent: "<p>He had a <em>heart of gold</em>.</p>",
        trigger: "manual",
      })
    })

    it("defaults to the local budget so a plain check spends no token quota", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxChapter).mockRaw(fxGuardianRun).mockSuccess(fxPersist)
      await server.call("guardian_check", { bookId: "book_1", chapterId: "chap_1" })
      expect(fetchMock.calls[1].body).toMatchObject({ costBudget: "local" })
    })

    it("passes through an explicit layer selection and budget", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxChapter).mockRaw(fxGuardianRun).mockSuccess(fxPersist)
      await server.call("guardian_check", {
        bookId: "book_1",
        chapterId: "chap_1",
        layers: [2, 5],
        costBudget: "api-heavy",
        locale: "zh",
      })
      expect(fetchMock.calls[1].body).toMatchObject({
        layers: [2, 5],
        costBudget: "api-heavy",
        locale: "zh",
      })
    })

    it("omits layers entirely when none are given, so the server runs all five", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxChapter).mockRaw(fxGuardianRun).mockSuccess(fxPersist)
      await server.call("guardian_check", { bookId: "book_1", chapterId: "chap_1" })
      expect(fetchMock.calls[1].body).not.toHaveProperty("layers")
    })

    it("surfaces detector errors and truncation, not just the issue list", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxChapter).mockRaw(fxGuardianRun).mockSuccess(fxPersist)
      const result = asToolResult(
        await server.call("guardian_check", { bookId: "book_1", chapterId: "chap_1" })
      )
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.issues).toHaveLength(1)
      expect(parsed.traceId).toBe("run-abc-1234")
      expect(parsed.tokensSpent).toBe(0)
      // A layer whose detector died covered less than the issue count implies.
      // Hiding that would report "clean" for prose nobody actually checked.
      const l2 = parsed.layers.find((l: { layer: number }) => l.layer === 2)
      expect(l2.errors).toEqual([{ detectorId: "l2.proofread", message: "provider timeout" }])
      expect(l2.truncation).toEqual({ analyzedChars: 6000, totalChars: 9000 })
    })

    it("returns a tool error when the chapter has no prose", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ ...fxChapter, content: "<p></p>" })
      const result = asToolResult(
        await server.call("guardian_check", { bookId: "book_1", chapterId: "chap_1" })
      )
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("no content")
    })

    it("saves the findings so the author's Guardian panel sees them", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxChapter).mockRaw(fxGuardianRun).mockSuccess(fxPersist)

      const result = asToolResult(
        await server.call("guardian_check", { bookId: "book_1", chapterId: "chap_1" })
      )

      // Third call, after the chapter read and the run itself.
      const save = fetchMock.calls[2]
      expect(save.method).toBe("POST")
      expect(save.url).toBe("https://test.creader.local/api/books/book_1/guardian/issues")
      const body = save.body as { chapterId: string; issues: Array<Record<string, unknown>> }
      expect(body.chapterId).toBe("chap_1")
      // Only the subset the persist route's schema accepts, and the fingerprint
      // above all — it is the key a re-run upserts on.
      expect(body.issues[0]).toMatchObject({
        fingerprint: fxGuardianRun.issues[0].fingerprint,
        title: fxGuardianRun.issues[0].title,
        severity: fxGuardianRun.issues[0].severity,
      })
      expect(JSON.parse(result.content[0].text).saved).toMatchObject({
        persisted: true,
        count: 1,
      })
    })

    it("leaves no trace when persist:false", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxChapter).mockRaw(fxGuardianRun)
      const result = asToolResult(
        await server.call("guardian_check", {
          bookId: "book_1",
          chapterId: "chap_1",
          persist: false,
        })
      )
      expect(fetchMock.calls).toHaveLength(2)
      expect(JSON.parse(result.content[0].text).saved.persisted).toBe(false)
    })

    it("keeps the findings when the save is refused", async () => {
      const server = await setup()
      fetchMock
        .mockSuccess(fxChapter)
        .mockRaw(fxGuardianRun)
        .mockHttpError(403, { error: "This API key lacks the 'write' scope." })

      const result = asToolResult(
        await server.call("guardian_check", { bookId: "book_1", chapterId: "chap_1" })
      )

      // The expensive half already happened and, on api-heavy, was already
      // billed. Throwing it away because the save failed is the worst trade
      // available, so the run is returned with the failure attached.
      expect(result.isError).toBeUndefined()
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.issues).toHaveLength(1)
      expect(parsed.saved.persisted).toBe(false)
      expect(parsed.saved.reason).toContain("'write' scope")
    })

    it("propagates dispatcher HTTP errors (e.g. a key without the ai scope)", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxChapter).mockHttpError(403, { error: "This API key lacks the 'ai' scope." })
      const result = asToolResult(
        await server.call("guardian_check", { bookId: "book_1", chapterId: "chap_1" })
      )
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("'ai' scope")
    })
  })

  describe("vector_check", () => {
    it("uses postRaw and returns the raw response JSON-stringified", async () => {
      const server = await setup()
      fetchMock.mockRaw(fxVectorCheck)
      const result = asToolResult(
        await server.call("vector_check", { bookId: "book_1" })
      )
      expect(result.content[0].text).toContain("durationMs")
      expect(fetchMock.lastCall()!.url).toBe(
        "https://test.creader.local/api/books/book_1/guardian/vector-check"
      )
    })

    it("propagates HTTP errors as tool errors", async () => {
      const server = await setup()
      fetchMock.mockHttpError(500, { error: "down" })
      const result = asToolResult(
        await server.call("vector_check", { bookId: "book_1" })
      )
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("down")
    })
  })

  describe("list_guardian_issues", () => {
    it("GETs the open issues and narrows by chapter", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ issues: [fxPersistedIssue] })
      const result = asToolResult(
        await server.call("list_guardian_issues", { bookId: "book_1", chapterId: "chap_1" })
      )
      expect(fetchMock.lastCall()!.url).toBe(
        "https://test.creader.local/api/books/book_1/guardian/issues?chapterId=chap_1"
      )
      expect(result.content[0].text).toContain("l2.cliche:heart-of-gold")
    })

    it("omits the query entirely when no chapter is given", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ issues: [] })
      const result = asToolResult(await server.call("list_guardian_issues", { bookId: "book_1" }))
      expect(fetchMock.lastCall()!.url).toBe(
        "https://test.creader.local/api/books/book_1/guardian/issues"
      )
      expect(result.content[0].text).toBe("No open Guardian issues.")
    })
  })

  describe("resolve_guardian_issue", () => {
    it("PATCHes the collection by fingerprint, not by row id", async () => {
      const server = await setup()
      fetchMock.mockSuccess({
        issue: { id: "gi_1", fingerprint: "l2.cliche:heart-of-gold", status: "DISMISSED" },
      })
      const result = asToolResult(
        await server.call("resolve_guardian_issue", {
          bookId: "book_1",
          fingerprint: "l2.cliche:heart-of-gold",
          status: "DISMISSED",
        })
      )
      const call = fetchMock.lastCall()!
      expect(call.method).toBe("PATCH")
      // Fingerprint-addressed on purpose: a run returns fingerprints, never the
      // persisted row ids, so the id-addressed route cannot close what it found.
      expect(call.url).toBe("https://test.creader.local/api/books/book_1/guardian/issues")
      expect(call.body).toEqual({
        fingerprint: "l2.cliche:heart-of-gold",
        status: "DISMISSED",
      })
      expect(result.content[0].text).toContain("DISMISSED")
    })

    it("rejects a status the route does not accept", async () => {
      const server = await setup()
      expect(
        server.validate("resolve_guardian_issue", {
          bookId: "book_1",
          fingerprint: "f",
          status: "IGNORED",
        }).success
      ).toBe(false)
    })
  })

  describe("orchestrate", () => {
    it("POSTs intent with an empty outline and no context packet by default", async () => {
      const server = await setup()
      fetchMock.mockRaw({ success: true, plan: fxPlan })
      const result = asToolResult(
        await server.call("orchestrate", { intent: "Alice confronts the Queen" })
      )
      expect(result.isError).toBeUndefined()
      const call = fetchMock.lastCall()!
      expect(call.url).toBe("https://test.creader.local/api/ai/orchestrate")
      // The route's schema requires `outline`, so an omitted one must go as "".
      expect(call.body).toEqual({ intent: "Alice confronts the Queen", outline: "" })
      // The plan itself is the payload, not the {success, plan} wrapper.
      expect(result.content[0].text).toContain("no longer remembers her")
      expect(result.content[0].text).not.toContain('"success"')
    })

    it("passes an explicit outline through", async () => {
      const server = await setup()
      fetchMock.mockRaw({ success: true, plan: fxPlan })
      await server.call("orchestrate", { intent: "x", outline: "1. beat one" })
      expect(fetchMock.lastCall()!.body).toMatchObject({ outline: "1. beat one" })
    })

    it("grounds the plan in the book's characters and locations when bookId is given", async () => {
      const server = await setup()
      fetchMock
        .mockSuccess([fxCharacter])
        .mockSuccess([fxLocation])
        .mockRaw({ success: true, plan: fxPlan })

      await server.call("orchestrate", { intent: "x", bookId: "book_1" })

      const body = fetchMock.lastCall()!.body as {
        contextPacket: { entities: unknown[] }
      }
      // Names and roles only — the server keeps just the first 1,000 chars of
      // this once stringified, so descriptions would crowd out the names.
      expect(body.contextPacket.entities).toEqual([
        { name: "Alice", type: "character", role: "protagonist" },
        { name: "Wonderland", type: "location" },
      ])
    })

    it("reports a missing 'ai' scope with the server's useful sentence", async () => {
      const server = await setup()
      fetchMock.mockHttpError(403, {
        error: "Forbidden",
        type: "scope",
        message: "This API key lacks the 'ai' scope.",
      })
      const result = asToolResult(await server.call("orchestrate", { intent: "x" }))
      expect(result.isError).toBe(true)
      // "Forbidden" alone tells the caller nothing actionable.
      expect(result.content[0].text).toContain("lacks the 'ai' scope")
    })
  })

})
