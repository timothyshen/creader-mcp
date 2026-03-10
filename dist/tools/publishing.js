/**
 * Publishing MCP tools: set_visibility
 */
import { z } from "zod";
import { getClient } from "../lib/api-client.js";
import { toolError } from "../lib/errors.js";
export function registerPublishingTools(server) {
    server.tool("set_visibility", "Set book visibility", {
        bookId: z.string().describe("Book ID"),
        visibility: z.enum(["PRIVATE", "LINK_ONLY", "PUBLIC"]),
    }, { readOnlyHint: false, idempotentHint: true, openWorldHint: true }, async ({ bookId, visibility }) => {
        try {
            const client = getClient();
            await client.patch(`/api/books/${bookId}`, { visibility });
            return {
                content: [{ type: "text", text: `Visibility set to ${visibility}` }],
            };
        }
        catch (error) {
            return toolError(error);
        }
    });
}
