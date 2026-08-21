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
import { registerStructureTools } from "./tools/structure.js"
import { registerKnowledgeTools } from "./tools/knowledge.js"
import { registerStatsTools } from "./tools/stats.js"
import { registerPublishingTools } from "./tools/publishing.js"
import { registerRelationTools } from "./tools/relations.js"
import { registerAITools } from "./tools/ai.js"

const server = new McpServer(
  { name: "creader", version: "1.2.0" },
  {
    instructions: [
      "Use get_book_context to load full story context (book + chapters + characters + locations + events) in one call before writing or editing.",
      "Books must exist before creating chapters or knowledge entries.",
      "Structure: a book is organised volume → act → chapter → scene. list_volumes / list_acts / list_scenes expose the levels around chapters; acts carry their volumeId, scenes their chapterId/actId.",
      "Use list_chapters to see chapter IDs, then get_chapter to read content. Always get_chapter before update_chapter when writing prose — update_chapter needs the baseContentHash get_chapter returns, and rejects the write as a conflict if the editor changed the chapter meanwhile.",
      "delete_chapter is permanent and renumbers later chapters. reorder_chapters takes the COMPLETE list of chapter IDs in the new order.",
      "search_knowledge searches across all entity types — use the type filter to narrow results.",
      "Use list_relations to see entity-to-entity relationships (e.g. character allies, location containment).",
      "AI checks: guardian_check runs the 5-layer narrative Guardian on one chapter — pick layers (1 Consistency, 2 Style & Prose, 3 Analysis, 4 Chapter & Suspense, 5 Plot Structure) and a costBudget; the default 'local' budget is free and makes no model calls, 'api-heavy' spends token quota. vector_check finds cross-book semantic conflicts in already-indexed content.",
      "AI writing aids (both spend token quota, need the 'ai' scope): extract_facts proposes knowledge-base updates from a chapter's prose — apply accepted ones with update_* tools; orchestrate turns an intent into a structured generation plan to guide drafting.",
    ].join(" "),
  }
)

// Register all 39 tools
registerBookTools(server)
registerChapterTools(server)
registerStructureTools(server)
registerKnowledgeTools(server)
registerRelationTools(server)
registerAITools(server)
registerStatsTools(server)
registerPublishingTools(server)

// Start stdio transport
const transport = new StdioServerTransport()
await server.connect(transport)
