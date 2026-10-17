import { describe, it, expect, beforeEach, vi } from "vitest"
import { installFetchMock, type FetchMock } from "../../helpers/mock-fetch.js"
import { FakeMcpServer, asToolResult } from "../../helpers/fake-mcp-server.js"
import {
  fxArticle,
  fxArticleIssue,
  fxArticleNote,
  fxGuardianRun,
} from "../../helpers/fixtures.js"
import { contentHash } from "../../../src/lib/content-hash.js"

const BASE = "https://test.creader.local"

async function setup() {
  vi.resetModules()
  const { registerArticleTools } = await import("../../../src/tools/articles.js")
  const server = new FakeMcpServer()
  registerArticleTools(server as never)
  return server
}

describe("article tools", () => {
  let fetchMock: FetchMock

  beforeEach(() => {
    fetchMock = installFetchMock()
  })

  it("registers all eleven article tools", async () => {
    const server = await setup()
    expect(server.names().sort()).toEqual([
      "create_article",
      "create_article_note",
      "delete_article",
      "get_article",
      "guardian_check_article",
      "list_article_guardian_issues",
      "list_article_notes",
      "list_articles",
      "resolve_article_guardian_issue",
      "set_article_visibility",
      "update_article",
    ])
  })

  describe("list_articles", () => {
    it("asks for active articles by default and never prints their content", async () => {
      const server = await setup()
      fetchMock.mockSuccess([fxArticle])
      const result = asToolResult(await server.call("list_articles", {}))
      expect(fetchMock.lastCall()!.url).toBe(`${BASE}/api/articles?status=active`)
      expect(result.content[0].text).toBe(
        "- On Harbours (4 words) updated:2026-10-02 id:art_1"
      )
      expect(result.content[0].text).not.toContain("harbour was quiet")
    })

    it("marks published and archived articles, and names untitled ones", async () => {
      const server = await setup()
      fetchMock.mockSuccess([
        { ...fxArticle, visibility: "PUBLIC" },
        { ...fxArticle, id: "art_2", title: "", status: "archived" },
      ])
      const result = asToolResult(await server.call("list_articles", { status: "all" }))
      expect(fetchMock.lastCall()!.url).toBe(`${BASE}/api/articles?status=all`)
      expect(result.content[0].text).toContain("On Harbours (4 words, PUBLIC)")
      expect(result.content[0].text).toContain("(untitled) (4 words, archived)")
    })

    it("handles an empty list", async () => {
      const server = await setup()
      fetchMock.mockSuccess([])
      const result = asToolResult(await server.call("list_articles", {}))
      expect(result.content[0].text).toBe("No articles found.")
    })

    it("names the scope when the key is refused, since the route says only 'Unauthorized'", async () => {
      const server = await setup()
      fetchMock.mockHttpError(401, {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Unauthorized" },
      })
      const result = asToolResult(await server.call("list_articles", {}))
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("Unauthorized")
      expect(result.content[0].text).toContain("'read' scope")
    })
  })

  describe("get_article", () => {
    it("renders the article with the baseContentHash of the prose it read", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxArticle)
      const result = asToolResult(await server.call("get_article", { articleId: "art_1" }))
      const text = result.content[0].text
      expect(fetchMock.lastCall()!.url).toBe(`${BASE}/api/articles/art_1`)
      expect(text).toContain("# On Harbours")
      expect(text).toContain(`baseContentHash:${contentHash(fxArticle.content)}`)
      expect(text).toContain("<p>The harbour was quiet.</p>")
      expect(text).not.toContain("Published")
    })

    it("says where a published article lives", async () => {
      const server = await setup()
      fetchMock.mockSuccess({
        ...fxArticle,
        visibility: "LINK_ONLY",
        slug: "on-harbours",
        publishedAt: "2026-10-03T09:00:00Z",
      })
      const result = asToolResult(await server.call("get_article", { articleId: "art_1" }))
      expect(result.content[0].text).toContain("Published since 2026-10-03, slug: on-harbours")
    })

    it("warns an invited commenter that the article is read-only to them", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ ...fxArticle, viewer: { role: "commenter", canEdit: false } })
      const result = asToolResult(await server.call("get_article", { articleId: "art_1" }))
      expect(result.content[0].text).toContain("Read-only")
    })
  })

  describe("create_article", () => {
    it("POSTs title and content", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxArticle)
      const result = asToolResult(
        await server.call("create_article", { title: "On Harbours", content: fxArticle.content })
      )
      const call = fetchMock.lastCall()!
      expect(call.method).toBe("POST")
      expect(call.url).toBe(`${BASE}/api/articles`)
      expect(call.body).toEqual({ title: "On Harbours", content: fxArticle.content })
      expect(result.content[0].text).toBe("Created article: On Harbours (id:art_1)")
    })

    it("treats a create as a baseline, so a fresh article can be filled in directly", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxArticle)
      await server.call("create_article", { title: "On Harbours", content: fxArticle.content })

      fetchMock.mockSuccess(fxArticle).mockSuccess({ ...fxArticle, content: "<p>New.</p>" })
      const result = asToolResult(
        await server.call("update_article", { articleId: "art_1", content: "<p>New.</p>" })
      )
      expect(result.isError).toBeUndefined()
      expect(fetchMock.lastCall()!.method).toBe("PATCH")
    })
  })

  describe("update_article", () => {
    it("PATCHes a title-only edit without re-reading — a title cannot clobber prose", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ ...fxArticle, title: "Harbours" })
      const result = asToolResult(
        await server.call("update_article", { articleId: "art_1", title: "Harbours" })
      )
      expect(fetchMock.calls).toHaveLength(1)
      expect(fetchMock.calls[0].method).toBe("PATCH")
      expect(fetchMock.calls[0].body).toEqual({ title: "Harbours" })
      expect(result.content[0].text).toBe("Updated: Harbours (4 words)")
    })

    it("archives without a baseline", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ ...fxArticle, status: "archived" })
      const result = asToolResult(
        await server.call("update_article", { articleId: "art_1", status: "archived" })
      )
      expect(fetchMock.calls[0].body).toEqual({ status: "archived" })
      expect(result.content[0].text).toContain("archived")
    })

    it("sends no baseContentHash with a title or status edit, even when a baseline is held", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxArticle)
      await server.call("get_article", { articleId: "art_1" })

      // With no content in the body the server's guard is not armed, and a
      // hash riding along would only suggest that it was.
      fetchMock.mockSuccess({ ...fxArticle, title: "Harbours", status: "archived" })
      await server.call("update_article", { articleId: "art_1", title: "Harbours", status: "archived" })
      expect(fetchMock.lastCall()!.method).toBe("PATCH")
      expect(fetchMock.lastCall()!.body).toEqual({ title: "Harbours", status: "archived" })
    })

    it("refuses a blind content write rather than last-write-wins over the editor", async () => {
      const server = await setup()
      const result = asToolResult(
        await server.call("update_article", { articleId: "art_1", content: "<p>Mine.</p>" })
      )
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("get_article")
      expect(fetchMock.calls).toHaveLength(0)
    })

    it("re-reads past a fresh cached copy before writing, then PATCHes the content with its baseline", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxArticle)
      await server.call("get_article", { articleId: "art_1" })

      // Without the invalidate, this GET would be served from the 60s cache —
      // the very pre-image the check exists to look past.
      fetchMock.mockSuccess(fxArticle).mockSuccess({ ...fxArticle, content: "<p>Mine.</p>" })
      const result = asToolResult(
        await server.call("update_article", { articleId: "art_1", content: "<p>Mine.</p>" })
      )
      expect(result.isError).toBeUndefined()
      expect(fetchMock.calls.map(c => c.method)).toEqual(["GET", "GET", "PATCH"])
      // The hash of the prose the edit was based on, which arms the server's
      // compare-and-swap.
      expect(fetchMock.lastCall()!.body).toEqual({
        content: "<p>Mine.</p>",
        baseContentHash: contentHash(fxArticle.content),
      })
    })

    it("refuses when the prose changed since the read, and writes nothing", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxArticle)
      await server.call("get_article", { articleId: "art_1" })

      fetchMock.mockSuccess({ ...fxArticle, content: "<p>The editor typed this.</p>" })
      const result = asToolResult(
        await server.call("update_article", { articleId: "art_1", content: "<p>Mine.</p>" })
      )
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("Conflict")
      expect(result.content[0].text).toContain("no words were lost")
      expect(fetchMock.calls.map(c => c.method)).toEqual(["GET", "GET"])
    })

    it("drops the stale baseline on conflict, so the next blind write is refused", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxArticle)
      await server.call("get_article", { articleId: "art_1" })
      fetchMock.mockSuccess({ ...fxArticle, content: "<p>The editor typed this.</p>" })
      await server.call("update_article", { articleId: "art_1", content: "<p>Mine.</p>" })

      const callsBefore = fetchMock.calls.length
      const retry = asToolResult(
        await server.call("update_article", { articleId: "art_1", content: "<p>Mine.</p>" })
      )
      expect(retry.isError).toBe(true)
      expect(retry.content[0].text).toContain("without a baseContentHash")
      expect(fetchMock.calls.length).toBe(callsBefore)
    })

    it("lets a retry through when the server already holds exactly this content", async () => {
      const server = await setup()
      fetchMock
        .mockSuccess({ ...fxArticle, content: "<p>Mine.</p>" })
        .mockSuccess({ ...fxArticle, content: "<p>Mine.</p>" })
      const result = asToolResult(
        await server.call("update_article", {
          articleId: "art_1",
          content: "<p>Mine.</p>",
          baseContentHash: contentHash(fxArticle.content),
        })
      )
      expect(result.isError).toBeUndefined()
      expect(fetchMock.lastCall()!.method).toBe("PATCH")
    })

    it("accepts an explicit baseContentHash, which survives a server restart", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxArticle).mockSuccess({ ...fxArticle, content: "<p>Mine.</p>" })
      const result = asToolResult(
        await server.call("update_article", {
          articleId: "art_1",
          content: "<p>Mine.</p>",
          baseContentHash: contentHash(fxArticle.content),
        })
      )
      expect(result.isError).toBeUndefined()
      expect(fetchMock.calls.map(c => c.method)).toEqual(["GET", "PATCH"])
      expect(fetchMock.lastCall()!.body).toEqual({
        content: "<p>Mine.</p>",
        baseContentHash: contentHash(fxArticle.content),
      })
    })

    it("re-baselines after a successful write so consecutive edits chain", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxArticle)
      await server.call("get_article", { articleId: "art_1" })
      fetchMock.mockSuccess(fxArticle).mockSuccess({ ...fxArticle, content: "<p>One.</p>" })
      await server.call("update_article", { articleId: "art_1", content: "<p>One.</p>" })

      fetchMock
        .mockSuccess({ ...fxArticle, content: "<p>One.</p>" })
        .mockSuccess({ ...fxArticle, content: "<p>Two.</p>" })
      const second = asToolResult(
        await server.call("update_article", { articleId: "art_1", content: "<p>Two.</p>" })
      )
      expect(second.isError).toBeUndefined()
      // Based on what the first write left on the server, not on the first read.
      expect(fetchMock.lastCall()!.body).toEqual({
        content: "<p>Two.</p>",
        baseContentHash: contentHash("<p>One.</p>"),
      })
    })

    describe("when the server's guard rejects the write", () => {
      // get_article, then update_article's re-read — which passes — then a
      // PATCH the server refuses: the prose moved in the instant between.
      function racedWrite() {
        fetchMock.mockSuccess(fxArticle).mockSuccess(fxArticle).mockHttpError(409, {
          success: false,
          error: {
            code: "ARTICLE_CONTENT_CONFLICT",
            message: "Article content changed since this draft was made",
          },
        })
      }

      it("reports a conflict, with nothing written and no retry", async () => {
        const server = await setup()
        racedWrite()
        await server.call("get_article", { articleId: "art_1" })
        const result = asToolResult(
          await server.call("update_article", { articleId: "art_1", content: "<p>Mine.</p>" })
        )
        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain("Conflict")
        expect(result.content[0].text).toContain("no words were lost")
        expect(result.content[0].text).toContain("Article content changed since this draft was made")
        expect(fetchMock.calls.map(c => c.method)).toEqual(["GET", "GET", "PATCH"])
      })

      it("drops the stale baseline, so the next blind write is refused", async () => {
        const server = await setup()
        racedWrite()
        await server.call("get_article", { articleId: "art_1" })
        await server.call("update_article", { articleId: "art_1", content: "<p>Mine.</p>" })

        const callsBefore = fetchMock.calls.length
        const retry = asToolResult(
          await server.call("update_article", { articleId: "art_1", content: "<p>Mine.</p>" })
        )
        expect(retry.isError).toBe(true)
        expect(retry.content[0].text).toContain("without a baseContentHash")
        expect(fetchMock.calls.length).toBe(callsBefore)
      })

      it("drops the copy the re-read cached, so get_article fetches the version to merge into", async () => {
        const server = await setup()
        racedWrite()
        await server.call("get_article", { articleId: "art_1" })
        await server.call("update_article", { articleId: "art_1", content: "<p>Mine.</p>" })

        const theirs = { ...fxArticle, content: "<p>The editor typed this.</p>" }
        fetchMock.mockSuccess(theirs)
        const reread = asToolResult(await server.call("get_article", { articleId: "art_1" }))
        expect(fetchMock.calls.map(c => c.method)).toEqual(["GET", "GET", "PATCH", "GET"])
        expect(reread.content[0].text).toContain(`baseContentHash:${contentHash(theirs.content)}`)
      })
    })

    it("names the write scope when the PATCH is refused as unauthorized", async () => {
      const server = await setup()
      fetchMock.mockHttpError(401, { success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized" } })
      const result = asToolResult(
        await server.call("update_article", { articleId: "art_1", title: "X" })
      )
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("'write' scope")
    })
  })

  describe("delete_article", () => {
    it("DELETEs the article", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ message: "Article deleted successfully" })
      const result = asToolResult(await server.call("delete_article", { articleId: "art_1" }))
      const call = fetchMock.lastCall()!
      expect(call.method).toBe("DELETE")
      expect(call.url).toBe(`${BASE}/api/articles/art_1`)
      expect(result.content[0].text).toContain("Deleted article art_1")
    })

    it("drops the article's content baseline along with it", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxArticle)
      await server.call("get_article", { articleId: "art_1" })
      fetchMock.mockSuccess({ message: "ok" })
      await server.call("delete_article", { articleId: "art_1" })

      const result = asToolResult(
        await server.call("update_article", { articleId: "art_1", content: "<p>x</p>" })
      )
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("without a baseContentHash")
    })

    it("names the delete scope when refused as unauthorized", async () => {
      const server = await setup()
      fetchMock.mockHttpError(401, { success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized" } })
      const result = asToolResult(await server.call("delete_article", { articleId: "art_1" }))
      expect(result.content[0].text).toContain("'delete' scope")
    })
  })

  describe("set_article_visibility", () => {
    it("POSTs to the publish route, never the article PATCH", async () => {
      const server = await setup()
      fetchMock.mockSuccess({
        id: "art_1",
        title: "On Harbours",
        visibility: "PUBLIC",
        publishedAt: "2026-10-11T08:00:00Z",
        slug: "on-harbours",
        ogImageUrl: null,
      })
      const result = asToolResult(
        await server.call("set_article_visibility", {
          articleId: "art_1",
          visibility: "PUBLIC",
          slug: "on-harbours",
          allowSeoIndexing: true,
        })
      )
      const call = fetchMock.lastCall()!
      expect(call.method).toBe("POST")
      expect(call.url).toBe(`${BASE}/api/articles/art_1/publish`)
      expect(call.body).toEqual({ visibility: "PUBLIC", slug: "on-harbours", allowSeoIndexing: true })
      expect(result.content[0].text).toBe(
        "On Harbours is now PUBLIC — slug: on-harbours, first published 2026-10-11."
      )
    })

    it("sends only visibility when nothing else is asked, leaving slug and SEO consent alone", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ ...fxArticle, visibility: "PRIVATE" })
      const result = asToolResult(
        await server.call("set_article_visibility", { articleId: "art_1", visibility: "PRIVATE" })
      )
      expect(fetchMock.lastCall()!.body).toEqual({ visibility: "PRIVATE" })
      expect(result.content[0].text).toBe("On Harbours is now PRIVATE.")
    })

    it("surfaces the publish route's own scope denial", async () => {
      const server = await setup()
      fetchMock.mockHttpError(403, {
        error: "Forbidden",
        type: "scope",
        message: "This API key lacks the 'publish' scope.",
      })
      const result = asToolResult(
        await server.call("set_article_visibility", { articleId: "art_1", visibility: "PUBLIC" })
      )
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("lacks the 'publish' scope")
    })
  })

  describe("guardian_check_article", () => {
    it("reads the article, then POSTs its plain text to the article run route", async () => {
      const server = await setup()
      fetchMock
        .mockSuccess({ ...fxArticle, content: "<p>He had a <em>heart of gold</em>.</p>" })
        .mockRaw(fxGuardianRun)

      await server.call("guardian_check_article", { articleId: "art_1" })

      expect(fetchMock.calls[0].url).toBe(`${BASE}/api/articles/art_1`)
      const call = fetchMock.calls[1]
      expect(call.method).toBe("POST")
      expect(call.url).toBe(`${BASE}/api/articles/art_1/guardian/run`)
      expect(call.body).toEqual({
        chapterId: "art_1",
        plainContent: "He had a heart of gold.",
        htmlContent: "<p>He had a <em>heart of gold</em>.</p>",
        costBudget: "local",
        trigger: "manual",
      })
    })

    it("does not re-POST the findings — the article route saves them itself", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxArticle).mockRaw(fxGuardianRun)
      const result = asToolResult(await server.call("guardian_check_article", { articleId: "art_1" }))
      expect(fetchMock.calls).toHaveLength(2)
      const body = JSON.parse(result.content[0].text)
      expect(body.saved).toEqual({ persisted: true })
      expect(body.issues).toHaveLength(1)
    })

    it("passes layers, budget and locale through", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxArticle).mockRaw(fxGuardianRun)
      await server.call("guardian_check_article", {
        articleId: "art_1",
        layers: [1, 3],
        costBudget: "api-heavy",
        locale: "vi",
      })
      expect(fetchMock.calls[1].body).toMatchObject({
        layers: [1, 3],
        costBudget: "api-heavy",
        locale: "vi",
      })
    })

    it("names the layers the article profile did not run instead of reporting them clean", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxArticle).mockRaw({ ...fxGuardianRun, deferredLayers: [4] })
      const result = asToolResult(await server.call("guardian_check_article", { articleId: "art_1" }))
      expect(JSON.parse(result.content[0].text).deferredLayers).toEqual([4])
    })

    it("says so when the run's findings were not saved", async () => {
      const server = await setup()
      fetchMock
        .mockSuccess(fxArticle)
        .mockRaw({ ...fxGuardianRun, persisted: false, code: "GUARDIAN_PERSIST_FAILED" })
      const result = asToolResult(await server.call("guardian_check_article", { articleId: "art_1" }))
      const body = JSON.parse(result.content[0].text)
      expect(body.saved.persisted).toBe(false)
      expect(body.saved.reason).toContain("GUARDIAN_PERSIST_FAILED")
      expect(body.issues).toHaveLength(1)
    })

    it("refuses an empty article without spending a run", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ ...fxArticle, content: "<p></p>" })
      const result = asToolResult(await server.call("guardian_check_article", { articleId: "art_1" }))
      expect(result.isError).toBe(true)
      expect(fetchMock.calls).toHaveLength(1)
    })
  })

  describe("list_article_guardian_issues", () => {
    it("lists OPEN issues compactly, keyed by the id resolve takes", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ issues: [fxArticleIssue] })
      const result = asToolResult(
        await server.call("list_article_guardian_issues", { articleId: "art_1" })
      )
      expect(fetchMock.lastCall()!.url).toBe(`${BASE}/api/articles/art_1/guardian/issues`)
      const [issue] = JSON.parse(result.content[0].text)
      expect(issue.id).toBe("gi_1")
      expect(issue.textPosition).toEqual({ start: 4, end: 11 })
      // Nulls and the fingerprint (useless here — article issues resolve by id) are dropped.
      expect(issue).not.toHaveProperty("suggestion")
      expect(issue).not.toHaveProperty("fingerprint")
    })

    it("asks for ACCEPTED issues too when told to", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ issues: [] })
      const result = asToolResult(
        await server.call("list_article_guardian_issues", { articleId: "art_1", includeAccepted: true })
      )
      expect(fetchMock.lastCall()!.url).toBe(
        `${BASE}/api/articles/art_1/guardian/issues?include=accepted`
      )
      expect(result.content[0].text).toBe("No open or accepted Guardian issues.")
    })
  })

  describe("resolve_article_guardian_issue", () => {
    it("PATCHes the issue by id", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ issue: { ...fxArticleIssue, status: "RESOLVED" } })
      const result = asToolResult(
        await server.call("resolve_article_guardian_issue", {
          articleId: "art_1",
          issueId: "gi_1",
          status: "RESOLVED",
        })
      )
      const call = fetchMock.lastCall()!
      expect(call.method).toBe("PATCH")
      expect(call.url).toBe(`${BASE}/api/articles/art_1/guardian/issues/gi_1`)
      expect(call.body).toEqual({ status: "RESOLVED" })
      expect(result.content[0].text).toBe("Issue gi_1 (Unsupported claim) → RESOLVED")
    })

    it("does not offer ACCEPTED — that verdict is the writer's", async () => {
      const server = await setup()
      const check = server.validate("resolve_article_guardian_issue", {
        articleId: "art_1",
        issueId: "gi_1",
        status: "ACCEPTED",
      })
      expect(check.success).toBe(false)
    })
  })

  describe("article notes", () => {
    it("lists an article's notes", async () => {
      const server = await setup()
      fetchMock.mockSuccess([fxArticleNote])
      const result = asToolResult(await server.call("list_article_notes", { articleId: "art_1" }))
      expect(fetchMock.lastCall()!.url).toBe(`${BASE}/api/articles/art_1/notes`)
      expect(result.content[0].text).toBe(
        "- Port authority figures (research) id:note_a1: Tonnage by year, 1990-2020."
      )
    })

    it("creates a note on the article", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxArticleNote)
      const result = asToolResult(
        await server.call("create_article_note", {
          articleId: "art_1",
          title: "Port authority figures",
          content: "Tonnage by year, 1990-2020.",
          noteType: "research",
        })
      )
      const call = fetchMock.lastCall()!
      expect(call.method).toBe("POST")
      expect(call.url).toBe(`${BASE}/api/articles/art_1/notes`)
      expect(call.body).toEqual({
        title: "Port authority figures",
        content: "Tonnage by year, 1990-2020.",
        noteType: "research",
      })
      expect(result.content[0].text).toBe("Created note: Port authority figures (id:note_a1)")
    })
  })
})
