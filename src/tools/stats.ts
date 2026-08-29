/**
 * Stats MCP tools: get_writing_stats, get_quota
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { getClient } from "../lib/api-client.js"
import { toolError } from "../lib/errors.js"
import type { WritingStats, QuotaInfo } from "../lib/types.js"

export function registerStatsTools(server: McpServer) {
  server.tool(
    "get_writing_stats",
    "Get the writing streak, today's and this week's word progress against the account's goals, and the total number of days written. Account-wide, not per book.",
    {},
    { readOnlyHint: true, openWorldHint: true },
    async () => {
      try {
        const client = getClient()
        const s = await client.get<WritingStats>("/api/user/writing-stats")
        return {
          content: [{
            type: "text" as const,
            text: [
              `Streak: ${s.currentStreak} days (best ${s.longestStreak}, goal ${s.streakGoal})`,
              `Today: ${s.dailyWordProgress}/${s.dailyWordGoal} words`,
              `Yesterday: ${s.yesterdayWordProgress} words`,
              `This week: ${s.weeklyWordProgress}/${s.weeklyWordGoal} words`,
              `Days written: ${s.totalWritingDays}`,
            ].join(" | "),
          }],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "get_quota",
    "Check remaining AI token quota",
    {},
    { readOnlyHint: true, openWorldHint: true },
    async () => {
      try {
        const client = getClient()
        const q = await client.get<QuotaInfo>("/api/user/quota")
        return {
          content: [{
            type: "text" as const,
            text: `Quota: ${q.remaining}/${q.tokenQuota} tokens remaining (${q.tokenUsed} used, ${q.tokenBonus} bonus)`,
          }],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )
}
