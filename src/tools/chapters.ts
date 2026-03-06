/**
 * Chapter management MCP tools: list_chapters, get_chapter, update_chapter
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { getClient } from "../lib/api-client.js"
import { toolError } from "../lib/errors.js"
import type { Chapter } from "../lib/types.js"

export function registerChapterTools(server: McpServer) {
  server.tool(
    "list_chapters",
    "List chapters in a book (no content)",
    { bookId: z.string().describe("Book ID") },
    { readOnlyHint: true, openWorldHint: true },
    async ({ bookId }) => {
      try {
        const client = getClient()
        const chapters = await client.get<Chapter[]>(
          `/api/books/${bookId}/chapters`
        )
        const text = chapters.length
          ? chapters.map(c => `${c.orderIndex + 1}. ${c.title} (${c.wordCount} words) id:${c.id}`).join("\n")
          : "No chapters found."
        return { content: [{ type: "text" as const, text }] }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "get_chapter",
    "Get chapter content",
    { chapterId: z.string().describe("Chapter ID") },
    { readOnlyHint: true, openWorldHint: true },
    async ({ chapterId }) => {
      try {
        const client = getClient()
        const ch = await client.get<Chapter>(`/api/chapters/${chapterId}`)
        return {
          content: [{
            type: "text" as const,
            text: `# ${ch.title}\nid:${ch.id} | ${ch.wordCount} words\n\n${ch.content || "(empty)"}`,
          }],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "create_chapter",
    "Create a new chapter in a book",
    {
      bookId: z.string().describe("Book ID"),
      title: z.string().describe("Chapter title"),
      content: z.string().optional().describe("HTML content"),
      orderIndex: z.number().optional().describe("Position index (auto-assigned if omitted)"),
      volumeId: z.string().optional().describe("Volume ID if grouped"),
    },
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ bookId, title, content, orderIndex, volumeId }) => {
      try {
        const client = getClient()
        const ch = await client.post<Chapter>(`/api/books/${bookId}/chapters`, {
          title,
          content,
          orderIndex,
          volumeId,
        })
        return {
          content: [{ type: "text" as const, text: `Created chapter: ${ch.title} (id:${ch.id}, order:${ch.orderIndex})` }],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "update_chapter",
    "Update chapter title or content",
    {
      chapterId: z.string().describe("Chapter ID"),
      title: z.string().optional(),
      content: z.string().optional().describe("HTML content"),
    },
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ chapterId, title, content }) => {
      try {
        const client = getClient()
        const ch = await client.patch<Chapter>(`/api/chapters/${chapterId}`, {
          title,
          content,
        })
        return {
          content: [{ type: "text" as const, text: `Updated: ${ch.title} (${ch.wordCount} words)` }],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )
}
