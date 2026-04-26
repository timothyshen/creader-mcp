#!/usr/bin/env node

/**
 * Creader MCP Server
 *
 * Exposes Creader's writing platform as MCP tools:
 * books, chapters, knowledge base, stats, and publishing.
 *
 * Requires CREADER_API_KEY environment variable.
 * Optionally set CREADER_API_URL (defaults to https://creader.io).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"

import { registerBookTools } from "./tools/books.js"
import { registerChapterTools } from "./tools/chapters.js"
import { registerKnowledgeTools } from "./tools/knowledge.js"
import { registerStatsTools } from "./tools/stats.js"
import { registerPublishingTools } from "./tools/publishing.js"
import { registerRelationTools } from "./tools/relations.js"
import { registerAITools } from "./tools/ai.js"

const server = new McpServer(
  { name: "creader", version: "1.1.0" },
  {
    instructions: [
      "Use get_book_context to load full story context (book + chapters + characters + locations + events) in one call before writing or editing.",
      "Books must exist before creating chapters or knowledge entries.",
      "Use list_chapters to see chapter IDs, then get_chapter to read content.",
      "search_knowledge searches across all entity types — use the type filter to narrow results.",
      "Use list_relations to see entity-to-entity relationships (e.g. character allies, location containment).",
      "AI checks: consistency_check for fast quota-cheap scan; analyze_book for deep vector-aware analysis of a single chapter; vector_check for cross-book semantic conflict detection; proofread for publishing-grade grammar/typo pass.",
    ].join(" "),
  }
)

// Register all 32 tools
registerBookTools(server)
registerChapterTools(server)
registerKnowledgeTools(server)
registerRelationTools(server)
registerAITools(server)
registerStatsTools(server)
registerPublishingTools(server)

// Start stdio transport
const transport = new StdioServerTransport()
await server.connect(transport)
