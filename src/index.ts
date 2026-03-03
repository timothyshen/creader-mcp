#!/usr/bin/env node

/**
 * Creader MCP Server
 *
 * Exposes Creader's writing platform as MCP tools:
 * books, chapters, knowledge base, AI, stats, and publishing.
 *
 * Requires CREADER_API_KEY environment variable.
 * Optionally set CREADER_API_URL (defaults to https://creader.io).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"

import { registerBookTools } from "./tools/books.js"
import { registerChapterTools } from "./tools/chapters.js"
import { registerKnowledgeTools } from "./tools/knowledge.js"
import { registerAITools } from "./tools/ai.js"
import { registerStatsTools } from "./tools/stats.js"
import { registerPublishingTools } from "./tools/publishing.js"

const server = new McpServer({
  name: "creader",
  version: "0.1.0",
})

// Register all 20 tools
registerBookTools(server)       // 3 tools: list_books, get_book, create_book
registerChapterTools(server)    // 3 tools: list_chapters, get_chapter, update_chapter
registerKnowledgeTools(server)  // 8 tools: search_knowledge, list/create characters, locations, events, create_note
registerAITools(server)         // 3 tools: chat, generate_outline, consistency_check
registerStatsTools(server)      // 2 tools: get_writing_stats, get_quota
registerPublishingTools(server) // 1 tool:  set_visibility

// Start stdio transport
const transport = new StdioServerTransport()
await server.connect(transport)
