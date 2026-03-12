/**
 * AI MCP tools: generate_outline, consistency_check
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { getClient } from "../lib/api-client.js"
import { toolError } from "../lib/errors.js"

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
}
