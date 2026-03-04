/**
 * Book management MCP tools: list_books, get_book, create_book, get_book_context
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { getClient } from "../lib/api-client.js"
import type { Book, Chapter, Character, Location, TimelineEvent } from "../lib/types.js"

function formatBook(b: Book): string {
  const parts = [`Title: ${b.title}`, `ID: ${b.id}`, `Type: ${b.contentType}`]
  if (b.description) parts.push(`Description: ${b.description}`)
  if (b.visibility) parts.push(`Visibility: ${b.visibility}`)
  return parts.join(" | ")
}

export function registerBookTools(server: McpServer) {
  server.tool(
    "list_books",
    "List all books",
    {},
    async () => {
      const client = getClient()
      const books = await client.get<Book[]>("/api/books")
      const text = books.length
        ? books.map(b => `- ${b.title} (id:${b.id}, ${b.contentType})`).join("\n")
        : "No books found."
      return { content: [{ type: "text" as const, text }] }
    }
  )

  server.tool(
    "get_book",
    "Get book details",
    { bookId: z.string().describe("Book ID") },
    async ({ bookId }) => {
      const client = getClient()
      const book = await client.get<Book>(`/api/books/${bookId}`)
      return { content: [{ type: "text" as const, text: formatBook(book) }] }
    }
  )

  server.tool(
    "create_book",
    "Create a new book",
    {
      title: z.string(),
      description: z.string().optional(),
      genre: z.string().optional(),
      contentType: z.enum(["novel", "autobiography", "worldbook", "encyclopedia"]).optional(),
    },
    async ({ title, description, genre, contentType }) => {
      const client = getClient()
      const book = await client.post<Book>("/api/books", {
        title,
        description,
        genre,
        contentType,
      })
      return {
        content: [{ type: "text" as const, text: `Created: ${book.title} (id:${book.id})` }],
      }
    }
  )

  server.tool(
    "get_book_context",
    "Get full book context in one call: metadata, chapter list, characters, locations, and events. Use this before writing or editing.",
    { bookId: z.string().describe("Book ID") },
    async ({ bookId }) => {
      const client = getClient()

      const [book, chapters, characters, locations, events] = await Promise.all([
        client.get<Book>(`/api/books/${bookId}`),
        client.get<Chapter[]>(`/api/books/${bookId}/chapters`),
        client.get<Character[]>(`/api/books/${bookId}/characters`),
        client.get<Location[]>(`/api/books/${bookId}/locations`),
        client.get<TimelineEvent[]>(`/api/books/${bookId}/timeline-events`),
      ])

      const sections: string[] = []

      // Book
      sections.push(`## Book\n${formatBook(book)}`)

      // Chapters
      if (chapters.length) {
        sections.push(`## Chapters\n${chapters.map(c => `${c.orderIndex + 1}. ${c.title} (${c.wordCount} words) id:${c.id}`).join("\n")}`)
      }

      // Characters
      if (characters.length) {
        sections.push(`## Characters\n${characters.map(c => `- ${c.name} (${c.role || "unset"}) id:${c.id}${c.description ? `: ${c.description}` : ""}`).join("\n")}`)
      }

      // Locations
      if (locations.length) {
        sections.push(`## Locations\n${locations.map(l => `- ${l.name} (${l.type || "unset"}) id:${l.id}${l.description ? `: ${l.description}` : ""}`).join("\n")}`)
      }

      // Events
      if (events.length) {
        sections.push(`## Events\n${events.map(e => `- [${e.importance || "minor"}] ${e.title} (${e.eventType || "plot"}) id:${e.id}${e.description ? `: ${e.description}` : ""}`).join("\n")}`)
      }

      return { content: [{ type: "text" as const, text: sections.join("\n\n") }] }
    }
  )
}
