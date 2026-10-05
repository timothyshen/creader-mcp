/**
 * AI MCP tools: generate_outline, guardian_check, vector_check, orchestrate
 *
 * `guardian_check` replaces the three tools that fronted the pre-v0.13
 * Guardian routes (consistency_check / analyze_book / proofread). Those
 * routes were deleted from the product on 2026-05-01 and collapsed into one
 * 5-layer dispatcher, so all three had been returning 404 to every caller
 * for months. One dispatcher route, one tool.
 *
 * `extract_facts` is gone for the same reason, one version later: the product
 * retired the whole fact-delta chain on 2026-08-27 (route, trigger, hook,
 * component, store slice) as work nothing reached, so the tool's only endpoint
 * stopped existing. Entity discovery from prose lives on as
 * POST /api/books/:bookId/entity-candidates, which proposes *new* entities and
 * field updates into a review queue — a different contract, not a rename, so it
 * gets its own tool when it gets one rather than inheriting this name.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { getClient } from "../lib/api-client.js"
import { toolError } from "../lib/errors.js"
import { stripHtmlForPositions } from "../lib/html-text.js"
import type {
  Chapter,
  Character,
  GuardianRunResponse,
  Location,
  OrchestrateResponse,
  PersistedGuardianIssue,
  VectorCheckResponse,
} from "../lib/types.js"

/** Server-side zod cap on both plainContent and htmlContent. */
const MAX_CONTENT_CHARS = 200_000

/** Rides a 200 from the run route when every requested layer was filtered away. */
const NO_RUNNABLE_LAYERS = "GUARDIAN_NO_RUNNABLE_LAYERS"

export function registerAITools(server: McpServer) {
  server.tool(
    "generate_outline",
    "Generate a story outline based on a premise. Returns structured chapter suggestions.",
    {
      title: z.string().describe("Book/story title"),
      premise: z.string().describe("Story premise or synopsis"),
      genre: z.string().optional().describe("Genre"),
      chapterCount: z
        .number()
        .optional()
        .describe("Target number of chapters (default: 10)"),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ title, premise, genre, chapterCount }) => {
      try {
        const client = getClient()
        const outline = await client.post<unknown>(
          "/api/onboarding/generate-outline",
          {
            title,
            description: premise,
            genre,
            chapterCount: chapterCount || 10,
          }
        )
        return {
          content: [{ type: "text" as const, text: JSON.stringify(outline, null, 2) }],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "guardian_check",
    [
      "Run Creader's Guardian over ONE chapter. Guardian is a 5-layer narrative model;",
      "pick layers and a cost budget rather than a preset check.",
      "Layers: 1=Consistency (dead characters, name typos, timeline/entity contradictions),",
      "2=Style & Prose (cliche, weak verbs, dialogue tags, POV leak, proofreading),",
      "3=Analysis (character arcs, causal chains, literary quality),",
      "4=Chapter & Suspense (opening quality, suspense, thread coverage, cliffhangers),",
      "5=Plot Structure (three-act shape, inciting incident, midpoint, foreshadowing).",
      "Omit `layers` to run all five.",
      "costBudget is an inclusive ceiling on detector cost and defaults to 'local':",
      "'local' makes NO model calls, spends no token quota, and is the right default —",
      "but it only reaches the rule-based detectors, so layer 3 returns nothing under it",
      "and layers 1/2/4/5 return only their local subset (this includes cliche and",
      "repetition, but NOT proofreading or POV leak, which are model detectors).",
      "Use 'api-heavy' for a full pass: it spends the owner's token quota.",
      "Every run, 'local' included, needs an API key with both the 'ai' and 'write' scopes:",
      "the server saves what a run finds, so it refuses a key that cannot write.",
      "Findings carry char-offset textPosition into the",
      "chapter's plain text; layer-2 proofreading findings also carry suggestedFix.",
      "Every run's findings are SAVED to the book by the server, which is what makes them",
      "appear in the author's Guardian panel and count toward Story Health; open notes on the",
      "chapter that the detectors which ran no longer raise are closed in the same step.",
      "There is currently no way to run without saving — `persist` is accepted but not",
      "honoured. `saved` in the result reports whether the server wrote the rows, and a",
      "run is never discarded because its save failed.",
    ].join(" "),
    {
      bookId: z.string().describe("Book ID"),
      chapterId: z.string().describe("Chapter ID to check"),
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
        .enum(["en", "en-GB", "zh"])
        .optional()
        .describe("Language of the prose. Defaults to the account locale."),
      persist: z
        .boolean()
        .optional()
        .describe(
          "Currently not honoured: the server saves every run's findings to the book whatever this is set to, and `saved` in the result says so."
        ),
    },
    // Not read-only: every run writes GuardianIssue rows, server-side. `persist`
    // is still in the schema only so existing callers keep validating — the run
    // route has no opt-out, so false has never meant anything. Whether it is
    // removed here or given a meaning there is the owner's call, not this file's.
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ bookId, chapterId, layers, costBudget, locale, persist }) => {
      try {
        const client = getClient()
        // The dispatcher scores offsets into plain text, so it wants the prose
        // stripped the same way the editor strips it — not the Tiptap HTML the
        // chapter is stored as.
        const chapter = await client.get<Chapter>(`/api/chapters/${chapterId}`)
        const html = chapter.content || ""
        const plainContent = stripHtmlForPositions(html)
        if (!plainContent.trim()) {
          return toolError(new Error("Chapter has no content to check"))
        }
        if (plainContent.length > MAX_CONTENT_CHARS) {
          return toolError(
            new Error(
              `Chapter is ${plainContent.length} characters; the Guardian endpoint accepts at most ${MAX_CONTENT_CHARS}. Split the chapter and check the parts separately.`
            )
          )
        }

        const result = await client.postRaw<GuardianRunResponse>(
          `/api/books/${bookId}/guardian/run`,
          {
            chapterId,
            plainContent,
            // Optional, and capped separately — omit rather than 400 the whole
            // run when the markup alone blows the limit.
            ...(html.length <= MAX_CONTENT_CHARS ? { htmlContent: html } : {}),
            ...(layers && layers.length ? { layers } : {}),
            costBudget: costBudget ?? "local",
            ...(locale ? { locale } : {}),
            // An MCP call is always an explicit ask, never a keystroke pass —
            // "manual" is what lifts the automatic-trigger detector filter.
            trigger: "manual",
          }
        )

        const saved = savedByRun(result, persist)

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ ...summarize(result), saved }, null, 2),
            },
          ],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "vector_check",
    "Run vector-based conflict detection across a book. Finds semantic duplicates, character contradictions, timeline inconsistencies, and location mismatches using embeddings. Does not require chapter input — operates on already-indexed content.",
    {
      bookId: z.string().describe("Book ID"),
      changedSourceId: z
        .string()
        .optional()
        .describe("If provided, restrict check to content related to this source"),
      sourceTypes: z
        .array(z.string())
        .optional()
        .describe("Optional filter: e.g. ['character', 'location', 'chapter']"),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ bookId, changedSourceId, sourceTypes }) => {
      try {
        const client = getClient()
        // vector-check returns raw JSON (no ApiResponse envelope) — use postRaw.
        const result = await client.postRaw<VectorCheckResponse>(
          `/api/books/${bookId}/guardian/vector-check`,
          { changedSourceId, sourceTypes }
        )
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "list_guardian_issues",
    [
      "List the Guardian issues currently OPEN on a book — the same notes the author",
      "sees in the Guardian panel. These persist across runs and across clients, so",
      "this is how you find out what a previous check (yours or the author's own)",
      "already flagged before spending quota on another pass.",
      "Each issue carries a `fingerprint`; pass that to resolve_guardian_issue.",
    ].join(" "),
    {
      bookId: z.string().describe("Book ID"),
      chapterId: z.string().optional().describe("Narrow to one chapter"),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ bookId, chapterId }) => {
      try {
        const client = getClient()
        // Both branches spell the path out in full rather than concatenating a
        // suffix onto a shared base. creader_editor's satellite-drift checker
        // reads route literals straight out of this file, and an interpolation
        // glued to the end of a path reaches it as a phantom extra segment —
        // reported as a dead route that was never dead. (It reads comments too,
        // which is why this one names no path.)
        const path = chapterId
          ? `/api/books/${bookId}/guardian/issues?chapterId=${encodeURIComponent(chapterId)}`
          : `/api/books/${bookId}/guardian/issues`
        const { issues } = await client.get<{ issues: PersistedGuardianIssue[] }>(path)
        if (!issues.length) {
          return {
            content: [{ type: "text" as const, text: "No open Guardian issues." }],
          }
        }
        return {
          content: [{ type: "text" as const, text: JSON.stringify(issues, null, 2) }],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "resolve_guardian_issue",
    [
      "Close a Guardian issue, or reopen one. RESOLVED means the prose was fixed;",
      "DISMISSED means the note was wrong, and also feeds detector confidence so the",
      "same false positive is less likely next time — so dismiss deliberately, not to",
      "tidy up. Addressed by `fingerprint` (from list_guardian_issues or a",
      "guardian_check run), because that is the key that survives a re-run.",
      "Only the issue's own author may transition it.",
    ].join(" "),
    {
      bookId: z.string().describe("Book ID"),
      fingerprint: z.string().describe("Issue fingerprint"),
      status: z.enum(["OPEN", "RESOLVED", "DISMISSED"]),
    },
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ bookId, fingerprint, status }) => {
      try {
        const client = getClient()
        const { issue } = await client.patch<{
          issue: { id: string; fingerprint: string; status: string }
        }>(`/api/books/${bookId}/guardian/issues`, { fingerprint, status })
        return {
          content: [
            { type: "text" as const, text: `Issue ${issue.fingerprint} → ${issue.status}` },
          ],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "orchestrate",
    [
      "Turn a writing intent into a structured generation plan: a 2–6 scene breakdown",
      "(purpose, required entities, emotional beat), consistency constraints, style",
      "directives, a word target, and a creative prompt. This is the planning half of",
      "Creader's two-stage generation — use the plan to structure your own drafting,",
      "then write the prose with update_chapter.",
      "Pass bookId to ground the plan in the book's characters and locations.",
      "Spends AI token quota and needs an API key with the 'ai' scope.",
    ].join(" "),
    {
      intent: z.string().min(1).max(2000).describe("What the passage should accomplish"),
      outline: z.string().max(10_000).optional().describe("Optional outline or beats to honour"),
      bookId: z
        .string()
        .optional()
        .describe("If set, the book's characters and locations are sent as planning context"),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ intent, outline, bookId }) => {
      try {
        const client = getClient()

        let contextPacket: { entities: unknown[] } | undefined
        if (bookId) {
          const [characters, locations] = await Promise.all([
            client.get<Character[]>(`/api/books/${bookId}/characters`),
            client.get<Location[]>(`/api/books/${bookId}/locations`),
          ])
          // The server JSON-stringifies this and keeps only the first 1,000
          // characters — send names and roles, not descriptions.
          const entities = [
            ...characters.map(c => ({
              name: c.name,
              type: "character",
              ...(c.role ? { role: c.role } : {}),
            })),
            ...locations.map(l => ({ name: l.name, type: "location" })),
          ]
          if (entities.length) contextPacket = { entities }
        }

        const response = await client.postRaw<OrchestrateResponse>("/api/ai/orchestrate", {
          intent,
          // Required by the route's schema, so an omitted outline goes as "".
          outline: outline ?? "",
          ...(contextPacket ? { contextPacket } : {}),
        })
        return {
          content: [{ type: "text" as const, text: JSON.stringify(response.plan, null, 2) }],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )
}

/**
 * What became of the run's findings in the book, read off the run response.
 *
 * The run route persists every run itself — in full, retiring only the notes
 * of the detectors that ran. This tool used to follow it with a POST of the
 * findings to the issues collection, and that second write was worse than
 * redundant: its schema carries a narrow subset, so it blanked detector,
 * evidence, description, lane and sources on the rows the run had just
 * written; it named no detectors, so its reconcile was chapter-wide and a
 * `local` check resolved every deep-run note on the chapter; and it is capped
 * at 200 issues, so a bigger run resolved its own overflow. There is nothing
 * left for this side to write — only a verdict to report.
 *
 * `count` is the number of issues the run returned, which is what the route
 * hands to its persist step; the response carries no separate row count.
 */
function savedByRun(
  result: GuardianRunResponse,
  persist: boolean | undefined
): { persisted: boolean; count?: number; reason?: string } {
  if (result.code === NO_RUNNABLE_LAYERS) {
    // The route answers before dispatching or persisting anything. "Saved, 0
    // rows" next to an empty issue list would read as a clean chapter.
    return {
      persisted: false,
      reason: `No requested layer could run on this book (${NO_RUNNABLE_LAYERS}) — typically layer 3 on a book with coherence analysis switched off. Nothing was checked and nothing was saved; this is not a clean result.`,
    }
  }
  if (result.persisted === false) {
    return {
      persisted: false,
      reason: `The run completed but the server could not save its findings (${result.code ?? "no code given"}): some or all of these issues are missing from the book. Run the check again to retry the save.`,
    }
  }
  return {
    persisted: true,
    count: result.issues?.length ?? 0,
    ...(persist === false
      ? {
          reason:
            "persist:false could not be honoured: the Guardian run route saves every run and has no opt-out, so these findings are in the book.",
        }
      : {}),
  }
}

/**
 * Project the dispatcher's response down to what a caller can act on.
 *
 * `issues` is the payload. The per-layer roll-up is not decoration: a
 * detector that errored, or a layer that only analysed a prefix of the
 * chapter, means the coverage is narrower than the empty issue list implies —
 * reporting "no issues" while hiding that would be a lie. Everything dropped
 * (per-detector wall-clock timings) is product-UI telemetry.
 */
function summarize(result: GuardianRunResponse) {
  return {
    issues: result.issues ?? [],
    layers: (result.reports ?? []).map((r) => ({
      layer: r.layer,
      issueCount: r.issues?.length ?? 0,
      ...(r.errors && r.errors.length ? { errors: r.errors } : {}),
      ...(r.truncation ? { truncation: r.truncation } : {}),
    })),
    ...(result.techniques && result.techniques.length
      ? { techniques: result.techniques }
      : {}),
    durationMs: result.durationMs,
    traceId: result.traceId,
    tokensSpent: result.usage?.totalTokens ?? 0,
  }
}
