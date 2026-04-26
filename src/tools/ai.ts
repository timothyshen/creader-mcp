/**
 * AI MCP tools: generate_outline, consistency_check, analyze_book, vector_check, proofread
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { getClient } from "../lib/api-client.js"
import { toolError } from "../lib/errors.js"
import type {
  Chapter,
  GuardianIssue,
  VectorCheckResponse,
} from "../lib/types.js"

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
    "consistency_check",
    "Run a quick consistency check on a book's content. Detects contradictions, timeline issues, and character inconsistencies.",
    {
      bookId: z.string().describe("Book ID to check"),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ bookId }) => {
      try {
        const client = getClient()
        const result = await client.post<unknown>(
          `/api/books/${bookId}/guardian/quick-check`,
          {}
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
    "analyze_book",
    "Deep Guardian analysis on a chapter. Uses vector-retrieved context to find character, plot, timeline, and worldbuilding inconsistencies. Returns up to 10 GuardianIssues with severity, category, evidence, and suggestion.",
    {
      bookId: z.string().describe("Book ID"),
      chapterId: z.string().describe("Chapter ID to analyze"),
      focusAreas: z
        .array(z.string())
        .optional()
        .describe("Optional focus areas to narrow the analysis"),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ bookId, chapterId, focusAreas }) => {
      try {
        const client = getClient()
        // Editor endpoint requires chapterContent in body — fetch it first.
        const chapter = await client.get<Chapter>(`/api/chapters/${chapterId}`)
        const chapterContent = chapter.content || ""
        if (!chapterContent) {
          return toolError(new Error("Chapter has no content to analyze"))
        }
        const issues = await client.post<GuardianIssue[]>(
          `/api/books/${bookId}/guardian/analyze`,
          { chapterId, chapterContent, focusAreas }
        )
        return {
          content: [
            {
              type: "text" as const,
              text: issues.length
                ? JSON.stringify(issues, null, 2)
                : "No issues found.",
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
    "proofread",
    "Publishing-standard proofread of a chapter. Returns punctuation, typo, grammar, and formatting issues with char-offset textPosition and suggestedFix for each issue.",
    {
      bookId: z.string().describe("Book ID"),
      chapterId: z.string().describe("Chapter ID to proofread"),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ bookId, chapterId }) => {
      try {
        const client = getClient()
        const chapter = await client.get<Chapter>(`/api/chapters/${chapterId}`)
        const chapterContent = chapter.content || ""
        if (!chapterContent) {
          return toolError(new Error("Chapter has no content to proofread"))
        }
        const issues = await client.post<GuardianIssue[]>(
          `/api/books/${bookId}/guardian/proofread`,
          { chapterId, chapterContent }
        )
        return {
          content: [
            {
              type: "text" as const,
              text: issues.length
                ? JSON.stringify(issues, null, 2)
                : "No proofreading issues found.",
            },
          ],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )
}
