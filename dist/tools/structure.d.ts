/**
 * Structural read MCP tools: list_volumes, list_acts, list_scenes
 *
 * Creader v1.0 organises a book as volume → act → chapter → scene, but until
 * now MCP clients could only see chapters — the rest of the spine was
 * invisible. These three tools close that gap. Read-only by design: structure
 * mutations stay in the editor until usage patterns justify write tools
 * (docs/UPGRADE_PLAN.md, v1.2.0).
 *
 * All three routes return the full set for the book, ordered by orderIndex,
 * with no query params. orderIndex is scoped to the parent (act order restarts
 * per volume, scene order per chapter), so lines carry the parent id rather
 * than a book-wide number.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare function registerStructureTools(server: McpServer): void;
