/**
 * Publishing MCP tools: set_visibility
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { getClient } from "../lib/api-client.js"

export function registerPublishingTools(server: McpServer) {
  server.tool(
    "set_visibility",
    "Set book visibility",
    {
      bookId: z.string().describe("Book ID"),
      visibility: z.enum(["PRIVATE", "LINK_ONLY", "PUBLIC"]),
    },
    async ({ bookId, visibility }) => {
      const client = getClient()
      await client.patch<unknown>(`/api/books/${bookId}`, { visibility })
      return {
        content: [{ type: "text" as const, text: `Visibility set to ${visibility}` }],
      }
    }
  )
}
