/**
 * Chapter management MCP tools: list_chapters, get_chapter, update_chapter
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { getClient } from "../lib/api-client.js"
import type { Chapter } from "../lib/types.js"

export function registerChapterTools(server: McpServer) {
  server.tool(
    "list_chapters",
    "List all chapters in a book (titles and metadata, not full content)",
    { bookId: z.string().describe("The book ID") },
    async ({ bookId }) => {
      const client = getClient()
      const chapters = await client.get<Chapter[]>(
        `/api/books/${bookId}/chapters`
      )
      // Return without full content to save tokens
      const summary = chapters.map((c) => ({
        id: c.id,
        title: c.title,
        orderIndex: c.orderIndex,
        wordCount: c.wordCount,
      }))
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(summary, null, 2),
          },
        ],
      }
    }
  )

  server.tool(
    "get_chapter",
    "Get a chapter's full content and metadata",
    { chapterId: z.string().describe("The chapter ID") },
    async ({ chapterId }) => {
      const client = getClient()
      const chapter = await client.get<Chapter>(`/api/chapters/${chapterId}`)
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(chapter, null, 2),
          },
        ],
      }
    }
  )

  server.tool(
    "update_chapter",
    "Update a chapter's title or content. Word count is auto-calculated.",
    {
      chapterId: z.string().describe("The chapter ID"),
      title: z.string().optional().describe("New chapter title"),
      content: z
        .string()
        .optional()
        .describe("New chapter content (HTML format)"),
    },
    async ({ chapterId, title, content }) => {
      const client = getClient()
      const chapter = await client.patch<Chapter>(`/api/chapters/${chapterId}`, {
        title,
        content,
      })
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(chapter, null, 2),
          },
        ],
      }
    }
  )
}
