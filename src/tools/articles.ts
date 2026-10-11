/**
 * Article MCP tools: list_articles, get_article, create_article,
 * update_article, delete_article, set_article_visibility,
 * guardian_check_article, list_article_guardian_issues,
 * resolve_article_guardian_issue, list_article_notes, create_article_note
 *
 * An article is Creader's other kind of writing: one standalone piece — an
 * essay, a blog post, a student draft — that belongs to its writer rather than
 * to a book. No chapters, no knowledge base, no structure; just the prose, a
 * few notes, its own Guardian queue, and a public page when the writer wants
 * one.
 *
 * ## What is deliberately missing
 *
 * The product also has comments, comment invitations and AI prose proposals on
 * articles, but those routes accept a browser session only and refuse an API
 * key, so there is nothing for a tool to call.
 *
 * ## Why update_article checks for a conflict itself
 *
 * Same hazard as update_chapter: the editor, another tab and the offline replay
 * queue all write the same row. But the product guards chapter writes only —
 * the article PATCH is last-write-wins, and nothing the editor sends would let
 * it be otherwise. So the comparison the server makes for chapters is made
 * here: re-read the article immediately before writing and refuse if its prose
 * no longer matches the version the edit was based on. That shrinks the window
 * from "any time since you read it" to the instant between the re-read and the
 * write. It does not close it, and the tool description says so.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { getClient } from "../lib/api-client.js"
import { contentHash } from "../lib/content-hash.js"
import { ApiRequestError, toolError } from "../lib/errors.js"
import { stripHtmlForPositions } from "../lib/html-text.js"
import { summarizeGuardianRun } from "./ai.js"
import type {
  Article,
  ArticleGuardianIssue,
  ArticleNote,
  ArticlePublishResult,
  GuardianRunResponse,
} from "../lib/types.js"

/** Server-side zod cap on both plainContent and htmlContent of a Guardian run. */
const MAX_CONTENT_CHARS = 200_000

/**
 * articleId → fingerprint of the prose this process last saw on the server.
 * Written on every read/write that observes content; read by update_article.
 */
const baselines = new Map<string, string>()

function rememberBaseline(article: Article): string {
  const hash = contentHash(article.content || "")
  baselines.set(article.id, hash)
  return hash
}

/**
 * Most article routes turn a key that lacks the needed scope into the same bare
 * 401 "Unauthorized" a bad key gets (only the publish route says which scope is
 * missing). Name the likelier cause, or the caller rotates a key that was fine.
 */
function articleError(error: unknown, scope: "read" | "write" | "delete") {
  if (error instanceof ApiRequestError && error.status === 401) {
    return toolError(
      new Error(
        `${error.message}. Article routes answer a key that lacks the '${scope}' scope exactly as they answer an invalid key, so check the key's scopes before replacing it.`
      )
    )
  }
  return toolError(error)
}

function listLine(a: Article): string {
  const tags = [`${a.wordCount} words`]
  if (a.visibility !== "PRIVATE") tags.push(a.visibility)
  if (a.status === "archived") tags.push("archived")
  return `- ${a.title || "(untitled)"} (${tags.join(", ")}) updated:${a.updatedAt.slice(0, 10)} id:${a.id}`
}

export function registerArticleTools(server: McpServer) {
  server.tool(
    "list_articles",
    "List the writer's articles — standalone essays and posts, separate from books. Newest edit first, no content. Archived articles are hidden unless you ask for them.",
    {
      status: z
        .enum(["active", "archived", "all"])
        .optional()
        .describe("Which articles to list. Default 'active'."),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ status }) => {
      try {
        const client = getClient()
        const articles = await client.get<Article[]>(`/api/articles?status=${status ?? "active"}`)
        const text = articles.length
          ? articles.map(listLine).join("\n")
          : "No articles found."
        return { content: [{ type: "text" as const, text }] }
      } catch (error) {
        return articleError(error, "read")
      }
    }
  )

  server.tool(
    "get_article",
    "Read an article's full content (HTML). Also returns a baseContentHash — pass it back to update_article so a concurrent edit from the editor is reported as a conflict instead of being overwritten.",
    { articleId: z.string().describe("Article ID") },
    { readOnlyHint: true, openWorldHint: true },
    async ({ articleId }) => {
      try {
        const client = getClient()
        const a = await client.get<Article>(`/api/articles/${articleId}`)
        const hash = rememberBaseline(a)
        const meta = [`id:${a.id}`, `${a.wordCount} words`, a.visibility]
        if (a.status === "archived") meta.push("archived")
        meta.push(`baseContentHash:${hash}`)
        const lines = [`# ${a.title || "(untitled)"}`, meta.join(" | ")]
        if (a.visibility !== "PRIVATE") {
          lines.push(
            `Published${a.publishedAt ? ` since ${a.publishedAt.slice(0, 10)}` : ""}, slug: ${a.slug ?? "none (reachable by id)"}`
          )
        }
        if (a.viewer && !a.viewer.canEdit) {
          lines.push("Read-only: you were invited to comment on this article; only its owner can change it.")
        }
        return {
          content: [{
            type: "text" as const,
            text: `${lines.join("\n")}\n\n${a.content || "(empty)"}`,
          }],
        }
      } catch (error) {
        return articleError(error, "read")
      }
    }
  )

  server.tool(
    "create_article",
    "Create a new article — a standalone piece owned by the writer, not part of any book. It starts PRIVATE.",
    {
      title: z.string().max(300).optional().describe("Article title"),
      content: z.string().optional().describe("HTML content"),
    },
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ title, content }) => {
      try {
        const client = getClient()
        const a = await client.post<Article>("/api/articles", { title, content })
        // We know exactly what prose it starts with, so the caller can go
        // straight to update_article without a read first.
        rememberBaseline(a)
        return {
          content: [{ type: "text" as const, text: `Created article: ${a.title || "(untitled)"} (id:${a.id})` }],
        }
      } catch (error) {
        return articleError(error, "write")
      }
    }
  )

  server.tool(
    "update_article",
    [
      "Update an article's title, content, or status ('archived' takes it off the shelf",
      "without deleting it; 'active' brings it back). Writing content requires a",
      "baseContentHash — the one get_article returned for the version you edited. It is",
      "remembered automatically after get_article or create_article in this session; pass",
      "it explicitly otherwise. Unlike chapters, Creader does not check article writes for",
      "conflicts, so this tool does: it re-reads the article just before writing and",
      "refuses if the prose changed since your version. An edit that lands in the instant",
      "between that re-read and the write can still be overwritten. Owner only.",
    ].join(" "),
    {
      articleId: z.string().describe("Article ID"),
      title: z.string().max(300).optional(),
      content: z.string().optional().describe("HTML content — replaces the whole article"),
      status: z.enum(["active", "archived"]).optional(),
      baseContentHash: z
        .string()
        .optional()
        .describe("baseContentHash from get_article for the version this edit is based on"),
    },
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ articleId, title, content, status, baseContentHash }) => {
      // A title- or status-only edit cannot clobber prose, so it needs no baseline.
      const base = baseContentHash ?? baselines.get(articleId)
      if (content !== undefined && !base) {
        return toolError(
          new Error(
            `Refusing to write content to ${articleId} without a baseContentHash — the write would silently overwrite any edit made in the editor. Call get_article first and pass back the baseContentHash it returns.`
          )
        )
      }

      try {
        const client = getClient()
        const path = `/api/articles/${articleId}`

        if (content !== undefined) {
          // The server's half of update_chapter's guard, done client-side. A
          // cached copy would be exactly the stale pre-image this exists to
          // catch, so the read must reach the server.
          client.invalidate(path)
          const current = (await client.get<Article>(path)).content || ""
          if (current !== content && contentHash(current) !== base) {
            // The baseline is provably stale. The fresh read stays cached: it
            // is the version the caller has to merge into next.
            baselines.delete(articleId)
            return {
              content: [{
                type: "text" as const,
                text: `Conflict: article ${articleId} was changed by someone else (the editor, another device, or an offline replay) after the version you edited. Nothing was written and no words were lost. Call get_article to read the current text, merge your change into it, then update_article with the new baseContentHash.`,
              }],
              isError: true,
            }
          }
        }

        const a = await client.patch<Article>(path, { title, content, status })
        // Re-baseline so consecutive edits chain without another read.
        rememberBaseline(a)
        return {
          content: [{
            type: "text" as const,
            text: `Updated: ${a.title || "(untitled)"} (${a.wordCount} words${a.status === "archived" ? ", archived" : ""})`,
          }],
        }
      } catch (error) {
        return articleError(error, "write")
      }
    }
  )

  server.tool(
    "delete_article",
    "Permanently delete an article. Hard delete with no trash: its notes, Guardian issues, comments and comment invitations go with it, and a published article's public page disappears. To put an article away without losing it, use update_article with status 'archived' instead. Owner only; the API key needs the 'delete' scope.",
    { articleId: z.string().describe("Article ID") },
    { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async ({ articleId }) => {
      try {
        const client = getClient()
        await client.delete(`/api/articles/${articleId}`)
        baselines.delete(articleId)
        return {
          content: [{ type: "text" as const, text: `Deleted article ${articleId}, with its notes and Guardian issues.` }],
        }
      } catch (error) {
        return articleError(error, "delete")
      }
    }
  )

  server.tool(
    "set_article_visibility",
    [
      "Publish an article, change how it is shared, or take it down: PUBLIC (anyone can",
      "find it), LINK_ONLY (anyone with the link), PRIVATE (only the writer — unpublishes).",
      "This changes what the outside world can see, so do it when the writer asks, not as",
      "a step in a writing task. Making an article non-private also switches on the",
      "writer's public profile page if it was off, stamps publishedAt the first time, and",
      "derives a slug from the title if the article has none. Pass `slug` to choose one",
      "(3–60 characters: lowercase letters, digits, hyphens; unique among the writer's",
      "articles). allowSeoIndexing is separate consent for search engines; omit it to",
      "leave it unchanged. Needs the 'publish' API-key scope.",
    ].join(" "),
    {
      articleId: z.string().describe("Article ID"),
      visibility: z.enum(["PRIVATE", "LINK_ONLY", "PUBLIC"]),
      slug: z.string().max(60).optional().describe("URL slug for the public page"),
      allowSeoIndexing: z
        .boolean()
        .optional()
        .describe("Let search engines index the public page. Omit to leave unchanged."),
    },
    { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    async ({ articleId, visibility, slug, allowSeoIndexing }) => {
      try {
        const client = getClient()
        // Visibility goes through the publish route, never the article PATCH:
        // it is the route that holds an API key to the 'publish' scope.
        const a = await client.post<ArticlePublishResult>(`/api/articles/${articleId}/publish`, {
          visibility,
          ...(slug !== undefined ? { slug } : {}),
          ...(allowSeoIndexing !== undefined ? { allowSeoIndexing } : {}),
        })
        const text =
          a.visibility === "PRIVATE"
            ? `${a.title || "(untitled)"} is now PRIVATE.`
            : `${a.title || "(untitled)"} is now ${a.visibility} — slug: ${a.slug ?? "none (reachable by id)"}${a.publishedAt ? `, first published ${a.publishedAt.slice(0, 10)}` : ""}.`
        return { content: [{ type: "text" as const, text }] }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "guardian_check_article",
    [
      "Run Creader's Guardian over one article. On an article Guardian reads an essay or",
      "post, not fiction — claim consistency, prose hygiene, argument craft, the",
      "reflective arc, sourcing — so it does not run every detector it runs on a chapter,",
      "and a requested layer with nothing to run comes back in `deferredLayers` rather",
      "than as a clean result. Layers: 1=Consistency, 2=Style & Prose, 3=Analysis,",
      "4=Chapter & Suspense, 5=Structure. Omit `layers` to run all five.",
      "costBudget is an inclusive ceiling on detector cost and defaults to 'local': no",
      "model calls and no token quota, but only the rule-based detectors run. 'api-heavy'",
      "is the full pass; it spends the owner's token quota and needs the 'ai' scope.",
      "Findings carry char-offset textPosition into the article's plain text.",
      "Unlike guardian_check, there is no look-only mode: Creader saves every article",
      "run's findings to the writer's Guardian panel, so the run needs the 'write' scope.",
      "Owner only. Use list_article_guardian_issues for the saved rows and their ids.",
    ].join(" "),
    {
      articleId: z.string().describe("Article ID"),
      layers: z
        .array(z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]))
        .optional()
        .describe("Which narrative layers to run. Omit for all five."),
      costBudget: z
        .enum(["local", "api-light", "vector", "api-heavy"])
        .optional()
        .describe(
          "Inclusive cost ceiling. Default 'local' (free, no model calls). 'api-heavy' spends token quota."
        ),
      locale: z
        .enum(["en", "en-GB", "zh", "vi"])
        .optional()
        .describe("Language of the prose. Omit to let Creader infer it from the text."),
    },
    // Not read-only: the route writes GuardianIssue rows on every run.
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ articleId, layers, costBudget, locale }) => {
      try {
        const client = getClient()
        // The dispatcher scores offsets into plain text stripped the way the
        // editor strips it, not into the stored Tiptap HTML.
        const article = await client.get<Article>(`/api/articles/${articleId}`)
        const html = article.content || ""
        const plainContent = stripHtmlForPositions(html)
        if (!plainContent.trim()) {
          return toolError(new Error("Article has no content to check"))
        }
        if (plainContent.length > MAX_CONTENT_CHARS) {
          return toolError(
            new Error(
              `Article is ${plainContent.length} characters; the Guardian endpoint accepts at most ${MAX_CONTENT_CHARS}.`
            )
          )
        }

        const result = await client.postRaw<GuardianRunResponse>(
          `/api/articles/${articleId}/guardian/run`,
          {
            // The route keeps the book route's body shape; an article is its
            // own single "chapter", and the id is not used as a key.
            chapterId: articleId,
            plainContent,
            ...(html.length <= MAX_CONTENT_CHARS ? { htmlContent: html } : {}),
            ...(layers && layers.length ? { layers } : {}),
            costBudget: costBudget ?? "local",
            ...(locale ? { locale } : {}),
            // An MCP call is always an explicit ask, never a keystroke pass.
            trigger: "manual",
          }
        )

        // The route saves the run itself and says so only when that failed.
        const saved =
          result.persisted === false
            ? {
                persisted: false,
                reason: `${result.code ?? "GUARDIAN_PERSIST_FAILED"}: the run completed but its findings were not all saved, so the issues in this reply are the only full record of it.`,
              }
            : { persisted: true }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ ...summarizeGuardianRun(result), saved }, null, 2),
          }],
        }
      } catch (error) {
        return articleError(error, "write")
      }
    }
  )

  server.tool(
    "list_article_guardian_issues",
    [
      "List the Guardian issues currently OPEN on an article — the same notes the writer",
      "sees in its Guardian panel, whichever run produced them. Check this before",
      "spending quota on another guardian_check_article. Pass includeAccepted to also see",
      "ACCEPTED issues: ones the writer agreed with and still means to fix.",
      "Each issue's `id` is what resolve_article_guardian_issue takes.",
    ].join(" "),
    {
      articleId: z.string().describe("Article ID"),
      includeAccepted: z.boolean().optional().describe("Also list ACCEPTED issues"),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ articleId, includeAccepted }) => {
      try {
        const client = getClient()
        // Both paths spelled out in full: creader_editor's drift checker reads
        // route literals from this file, and a suffix glued onto a shared base
        // reaches it as a phantom segment.
        const path = includeAccepted
          ? `/api/articles/${articleId}/guardian/issues?include=accepted`
          : `/api/articles/${articleId}/guardian/issues`
        const { issues } = await client.get<{ issues: ArticleGuardianIssue[] }>(path)
        if (!issues.length) {
          return {
            content: [{
              type: "text" as const,
              text: includeAccepted ? "No open or accepted Guardian issues." : "No open Guardian issues.",
            }],
          }
        }
        const compact = issues.map((i) => ({
          id: i.id,
          status: i.status,
          severity: i.severity,
          title: i.title,
          ...(i.category ? { category: i.category } : {}),
          ...(i.detector ? { detector: i.detector } : {}),
          ...(i.description ? { description: i.description } : {}),
          ...(i.suggestion ? { suggestion: i.suggestion } : {}),
          ...(i.suggestedFix ? { suggestedFix: i.suggestedFix } : {}),
          ...(i.textPosition ? { textPosition: i.textPosition } : {}),
        }))
        return {
          content: [{ type: "text" as const, text: JSON.stringify(compact, null, 2) }],
        }
      } catch (error) {
        return articleError(error, "read")
      }
    }
  )

  server.tool(
    "resolve_article_guardian_issue",
    [
      "Close a Guardian issue on an article, or reopen one. RESOLVED means the prose was",
      "fixed; DISMISSED means the note was wrong, and also feeds detector confidence so",
      "the same false positive is less likely next time — so dismiss deliberately, not to",
      "tidy up. Takes the issue `id` from list_article_guardian_issues: article issues are",
      "addressed by id, unlike book issues, which resolve_guardian_issue takes by",
      "fingerprint. Owner only.",
    ].join(" "),
    {
      articleId: z.string().describe("Article ID"),
      issueId: z.string().describe("Issue id from list_article_guardian_issues"),
      status: z.enum(["OPEN", "RESOLVED", "DISMISSED"]),
    },
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ articleId, issueId, status }) => {
      try {
        const client = getClient()
        const { issue } = await client.patch<{ issue: { id: string; title: string; status: string } }>(
          `/api/articles/${articleId}/guardian/issues/${issueId}`,
          { status }
        )
        return {
          content: [{ type: "text" as const, text: `Issue ${issue.id} (${issue.title}) → ${issue.status}` }],
        }
      } catch (error) {
        return articleError(error, "write")
      }
    }
  )

  server.tool(
    "list_article_notes",
    "List the notes kept on an article — research, sources, reminders the writer keeps beside the piece. Owner only.",
    { articleId: z.string().describe("Article ID") },
    { readOnlyHint: true, openWorldHint: true },
    async ({ articleId }) => {
      try {
        const client = getClient()
        const notes = await client.get<ArticleNote[]>(`/api/articles/${articleId}/notes`)
        const text = notes.length
          ? notes
              .map(n => `- ${n.title} (${n.noteType}) id:${n.id}${n.content ? `: ${n.content}` : ""}`)
              .join("\n")
          : "No notes on this article."
        return { content: [{ type: "text" as const, text }] }
      } catch (error) {
        return articleError(error, "read")
      }
    }
  )

  server.tool(
    "create_article_note",
    "Add a note to an article — research, a source, a reminder to keep beside the piece. Change or remove it afterwards with update_note / delete_note, which take the note id and work on article notes too. Owner only.",
    {
      articleId: z.string().describe("Article ID"),
      title: z.string().min(1).max(300),
      content: z.string().max(50_000).optional(),
      noteType: z
        .enum(["research", "note", "general", "worldbuilding", "rule"])
        .optional()
        .describe("Default 'general'"),
      tags: z.array(z.string().max(50)).max(20).optional(),
    },
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ articleId, title, content, noteType, tags }) => {
      try {
        const client = getClient()
        const note = await client.post<ArticleNote>(`/api/articles/${articleId}/notes`, {
          title,
          content,
          noteType,
          tags,
        })
        return {
          content: [{ type: "text" as const, text: `Created note: ${note.title} (id:${note.id})` }],
        }
      } catch (error) {
        return articleError(error, "write")
      }
    }
  )
}
