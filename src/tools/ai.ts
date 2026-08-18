/**
 * AI MCP tools: generate_outline, guardian_check, vector_check
 *
 * `guardian_check` replaces the three tools that fronted the pre-v0.13
 * Guardian routes (consistency_check / analyze_book / proofread). Those
 * routes were deleted from the product on 2026-05-01 and collapsed into one
 * 5-layer dispatcher, so all three had been returning 404 to every caller
 * for months. One dispatcher route, one tool.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { getClient } from "../lib/api-client.js"
import { toolError } from "../lib/errors.js"
import { stripHtmlForPositions } from "../lib/html-text.js"
import type {
  Chapter,
  GuardianRunResponse,
  VectorCheckResponse,
} from "../lib/types.js"

/** Server-side zod cap on both plainContent and htmlContent. */
const MAX_CONTENT_CHARS = 200_000

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
      "Use 'api-heavy' for a full pass: it spends the owner's token quota and needs an",
      "API key with the 'ai' scope. Findings carry char-offset textPosition into the",
      "chapter's plain text; layer-2 proofreading findings also carry suggestedFix.",
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
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ bookId, chapterId, layers, costBudget, locale }) => {
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

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(summarize(result), null, 2) },
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
