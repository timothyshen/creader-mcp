/**
 * Semantic relation MCP tools: list, create, update, delete entity relationships
 */
import { z } from "zod";
import { getClient } from "../lib/api-client.js";
import { toolError } from "../lib/errors.js";
const entityTypes = ["character", "location", "event", "note"];
export function registerRelationTools(server) {
    server.tool("list_relations", "List semantic relations (entity-to-entity relationships) in a book", {
        bookId: z.string().describe("Book ID"),
    }, { readOnlyHint: true, openWorldHint: true }, async ({ bookId }) => {
        try {
            const client = getClient();
            const items = await client.get(`/api/books/${bookId}/semantic-relations`);
            if (!items.length) {
                return { content: [{ type: "text", text: "No relations found." }] };
            }
            const text = items
                .map((r) => `- [${r.sourceType}:${r.sourceId}] --${r.type}--> [${r.targetType}:${r.targetId}]` +
                (r.inverseType ? ` (inverse: ${r.inverseType})` : "") +
                ` strength:${r.strength}` +
                (r.description ? ` — ${r.description}` : "") +
                ` id:${r.id}`)
                .join("\n");
            return { content: [{ type: "text", text }] };
        }
        catch (error) {
            return toolError(error);
        }
    });
    server.tool("create_relation", "Create a semantic relation between two entities", {
        bookId: z.string().describe("Book ID"),
        sourceId: z.string().describe("Source entity ID"),
        sourceType: z.enum(entityTypes),
        targetId: z.string().describe("Target entity ID"),
        targetType: z.enum(entityTypes),
        type: z.string().describe("Relation type, e.g. 'allies_with', 'located_in', 'caused'"),
        inverseType: z.string().optional().describe("Inverse relation type, e.g. 'has_ally', 'contains'"),
        description: z.string().optional(),
        strength: z.number().min(1).max(10).optional().describe("Relation strength 1-10, default 5"),
    }, { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, async ({ bookId, sourceId, sourceType, targetId, targetType, type, inverseType, description, strength }) => {
        try {
            const client = getClient();
            const rel = await client.post(`/api/books/${bookId}/semantic-relations`, { sourceId, sourceType, targetId, targetType, type, inverseType, description, strength });
            return {
                content: [
                    {
                        type: "text",
                        text: `Created relation: [${rel.sourceType}:${rel.sourceId}] --${rel.type}--> [${rel.targetType}:${rel.targetId}] (id:${rel.id})`,
                    },
                ],
            };
        }
        catch (error) {
            return toolError(error);
        }
    });
    server.tool("update_relation", "Update a semantic relation", {
        id: z.string().describe("Relation ID"),
        type: z.string().optional(),
        inverseType: z.string().optional(),
        description: z.string().optional(),
        strength: z.number().min(1).max(10).optional(),
    }, { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, async ({ id, ...fields }) => {
        try {
            const client = getClient();
            const rel = await client.patch(`/api/semantic-relations/${id}`, fields);
            return {
                content: [
                    {
                        type: "text",
                        text: `Updated relation: [${rel.sourceType}:${rel.sourceId}] --${rel.type}--> [${rel.targetType}:${rel.targetId}] (id:${rel.id})`,
                    },
                ],
            };
        }
        catch (error) {
            return toolError(error);
        }
    });
    server.tool("delete_relation", "Delete a semantic relation", {
        id: z.string().describe("Relation ID"),
    }, { readOnlyHint: false, destructiveHint: true, openWorldHint: true }, async ({ id }) => {
        try {
            const client = getClient();
            await client.delete(`/api/semantic-relations/${id}`);
            return {
                content: [{ type: "text", text: `Deleted relation ${id}` }],
            };
        }
        catch (error) {
            return toolError(error);
        }
    });
}
//# sourceMappingURL=relations.js.map