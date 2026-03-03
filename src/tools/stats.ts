/**
 * Stats MCP tools: get_writing_stats, get_quota
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { getClient } from "../lib/api-client.js"
import type { WritingStats, QuotaInfo } from "../lib/types.js"

export function registerStatsTools(server: McpServer) {
  server.tool(
    "get_writing_stats",
    "Get the user's writing statistics (streak, total words, today's words)",
    {},
    async () => {
      const client = getClient()
      const stats = await client.get<WritingStats>("/api/user/writing-stats")
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(stats, null, 2),
          },
        ],
      }
    }
  )

  server.tool(
    "get_quota",
    "Get the user's AI token quota (remaining tokens, monthly limit)",
    {},
    async () => {
      const client = getClient()
      const quota = await client.get<QuotaInfo>("/api/user/quota")
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(quota, null, 2),
          },
        ],
      }
    }
  )
}
