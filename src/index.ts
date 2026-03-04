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

const server = new McpServer({
  name: "creader",
  version: "0.1.0",
})

// Register all 16 tools
registerBookTools(server)       // 4 tools: list_books, get_book, create_book, get_book_context
registerChapterTools(server)    // 3 tools: list_chapters, get_chapter, update_chapter
registerKnowledgeTools(server)  // 6 tools: search_knowledge, list_knowledge, create_character/location/event, create_note
registerStatsTools(server)      // 2 tools: get_writing_stats, get_quota
registerPublishingTools(server) // 1 tool:  set_visibility

// Start stdio transport
const transport = new StdioServerTransport()
await server.connect(transport)
