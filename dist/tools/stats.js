/**
 * Stats MCP tools: get_writing_stats, get_quota
 */
import { getClient } from "../lib/api-client.js";
import { toolError } from "../lib/errors.js";
export function registerStatsTools(server) {
    server.tool("get_writing_stats", "Get writing streak and word counts", {}, { readOnlyHint: true, openWorldHint: true }, async () => {
        try {
            const client = getClient();
            const s = await client.get("/api/user/writing-stats");
            return {
                content: [{
                        type: "text",
                        text: `Streak: ${s.currentStreak}/${s.longestStreak} | Today: ${s.todayWords} words | Total: ${s.totalWords} words`,
                    }],
            };
        }
        catch (error) {
            return toolError(error);
        }
    });
    server.tool("get_quota", "Check remaining AI token quota", {}, { readOnlyHint: true, openWorldHint: true }, async () => {
        try {
            const client = getClient();
            const q = await client.get("/api/user/quota");
            return {
                content: [{
                        type: "text",
                        text: `Quota: ${q.remaining}/${q.tokenQuota} tokens remaining (${q.tokenUsed} used, ${q.tokenBonus} bonus)`,
                    }],
            };
        }
        catch (error) {
            return toolError(error);
        }
    });
}
