/**
 * AI MCP tools: generate_outline, guardian_check, vector_check, orchestrate
 *
 * `guardian_check` replaces the three tools that fronted the pre-v0.13
 * Guardian routes (consistency_check / analyze_book / proofread). Those
 * routes were deleted from the product on 2026-05-01 and collapsed into one
 * 5-layer dispatcher, so all three had been returning 404 to every caller
 * for months. One dispatcher route, one tool.
 *
 * `extract_facts` is gone for the same reason, one version later: the product
 * retired the whole fact-delta chain on 2026-08-27 (route, trigger, hook,
 * component, store slice) as work nothing reached, so the tool's only endpoint
 * stopped existing. Entity discovery from prose lives on as
 * POST /api/books/:bookId/entity-candidates, which proposes *new* entities and
 * field updates into a review queue — a different contract, not a rename, so it
 * gets its own tool when it gets one rather than inheriting this name.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare function registerAITools(server: McpServer): void;
