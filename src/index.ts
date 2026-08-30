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
  { name: "creader", version: "1.6.0" },
  {
    instructions: [
      "Use get_book_context to load full story context (book + chapters + characters + locations + events) in one call before writing or editing.",
      "Books must exist before creating chapters or knowledge entries.",
      "Structure: a book is organised volume → act → chapter → scene. list_volumes / list_acts / list_scenes expose the levels around chapters; acts carry their volumeId, scenes their chapterId/actId.",
      "Use list_chapters to see chapter IDs, then get_chapter to read content. Always get_chapter before update_chapter when writing prose — update_chapter needs the baseContentHash get_chapter returns, and rejects the write as a conflict if the editor changed the chapter meanwhile.",
      "delete_chapter is permanent and renumbers later chapters. reorder_chapters takes the COMPLETE list of chapter IDs in the new order.",
      "Two different searches, and picking the wrong one is the common mistake: search_book searches the PROSE and returns chapters with snippets — that is the only way to look inside the manuscript; search_knowledge searches entity RECORDS (character/location/event/note names and descriptions) — use its type filter to narrow. Reach for search_book before reading chapters in bulk.",
      "search_book has two modes. 'text' is exact substring and exhaustive, so nothing found means nothing is there. 'semantic' is meaning-based and only sees chapters that have been indexed — it returns an empty result rather than an error when they have not been, so never report an empty semantic search as proof the book lacks something.",
      "World constraints are notes: noteType 'rule' is a law the AI must obey, 'prohibition' is one it must never break. Creader force-injects both into every AI prompt for the book, unlike ordinary notes, so record hard world laws that way. Their count is capped per subscription tier.",
      "Deprecation notice: the 12 per-type knowledge CRUD tools (create/update/delete_ × character/location/event/note) will be consolidated into create_entity/update_entity/delete_entity with a type discriminator in v2.0.0. They remain fully functional throughout 1.x — keep using them for now.",
      "Use list_relations to see entity-to-entity relationships (e.g. character allies, location containment).",
      "AI checks: guardian_check runs the 5-layer narrative Guardian on one chapter — pick layers (1 Consistency, 2 Style & Prose, 3 Analysis, 4 Chapter & Suspense, 5 Plot Structure) and a costBudget; the default 'local' budget is free and makes no model calls, 'api-heavy' spends token quota. vector_check finds cross-book semantic conflicts in already-indexed content.",
      "Guardian findings persist: guardian_check saves what it finds to the book by default, so the author sees it in their Guardian panel and Story Health counts it. Call list_guardian_issues before re-running to see what is already open — including what the author flagged in the editor — and resolve_guardian_issue (addressed by fingerprint) to close one as RESOLVED once the prose is fixed, or DISMISSED if the note was wrong. Dismissal feeds detector confidence, so dismiss deliberately.",
      "AI writing aid (spends token quota, needs the 'ai' scope): orchestrate turns an intent into a structured generation plan to guide drafting.",
    ].join(" "),
  }
)

// Register all 41 tools
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
