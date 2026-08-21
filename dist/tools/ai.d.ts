/**
 * AI MCP tools: generate_outline, guardian_check, vector_check,
 * extract_facts, orchestrate
 *
 * `guardian_check` replaces the three tools that fronted the pre-v0.13
 * Guardian routes (consistency_check / analyze_book / proofread). Those
 * routes were deleted from the product on 2026-05-01 and collapsed into one
 * 5-layer dispatcher, so all three had been returning 404 to every caller
 * for months. One dispatcher route, one tool.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare function registerAITools(server: McpServer): void;
