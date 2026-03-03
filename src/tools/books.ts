/**
 * Book management MCP tools: list_books, get_book, create_book
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { getClient } from "../lib/api-client.js"
import type { Book } from "../lib/types.js"

export function registerBookTools(server: McpServer) {
  server.tool(
    "list_books",
    "List all books in the user's library",
    {},
    async () => {
      const client = getClient()
      const books = await client.get<Book[]>("/api/books")
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(books, null, 2),
          },
        ],
      }
    }
  )

  server.tool(
    "get_book",
    "Get detailed information about a specific book",
    { bookId: z.string().describe("The book ID") },
    async ({ bookId }) => {
      const client = getClient()
      const book = await client.get<Book>(`/api/books/${bookId}`)
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(book, null, 2),
          },
        ],
      }
    }
  )

  server.tool(
    "create_book",
    "Create a new book. Returns the created book with its ID.",
    {
      title: z.string().describe("Book title"),
      description: z.string().optional().describe("Book description"),
      genre: z.string().optional().describe("Book genre"),
      contentType: z
        .enum(["novel", "autobiography", "worldbook", "encyclopedia"])
        .optional()
        .describe("Content type (default: novel)"),
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
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(book, null, 2),
          },
        ],
      }
    }
  )
}
