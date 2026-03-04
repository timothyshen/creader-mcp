/**
 * Stats MCP tools: get_writing_stats, get_quota
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { getClient } from "../lib/api-client.js"
import type { WritingStats, QuotaInfo } from "../lib/types.js"

export function registerStatsTools(server: McpServer) {
  server.tool(
    "get_writing_stats",
    "Get writing streak and word counts",
    {},
    async () => {
      const client = getClient()
      const s = await client.get<WritingStats>("/api/user/writing-stats")
      return {
        content: [{
          type: "text" as const,
          text: `Streak: ${s.currentStreak}/${s.longestStreak} | Today: ${s.todayWords} words | Total: ${s.totalWords} words`,
        }],
      }
    }
  )

  server.tool(
    "get_quota",
    "Check remaining AI token quota",
    {},
    async () => {
      const client = getClient()
      const q = await client.get<QuotaInfo>("/api/user/quota")
      return {
        content: [{
          type: "text" as const,
          text: `Quota: ${q.remaining}/${q.tokenQuota} tokens remaining (${q.tokenUsed} used, ${q.tokenBonus} bonus)`,
        }],
      }
    }
  )
}
