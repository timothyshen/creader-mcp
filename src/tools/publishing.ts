/**
 * Publishing MCP tools: set_visibility
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { getClient } from "../lib/api-client.js"

export function registerPublishingTools(server: McpServer) {
  server.tool(
    "set_visibility",
    "Set a book's visibility level (private, link-only, or public)",
    {
      bookId: z.string().describe("The book ID"),
      visibility: z
        .enum(["PRIVATE", "LINK_ONLY", "PUBLIC"])
        .describe("Visibility level"),
    },
    async ({ bookId, visibility }) => {
      const client = getClient()
      const result = await client.patch<unknown>(`/api/books/${bookId}`, {
        visibility,
      })
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      }
    }
  )
}
