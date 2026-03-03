/**
 * AI MCP tools: chat, generate_outline, consistency_check
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { getClient } from "../lib/api-client.js"
import type { ChatResponse } from "../lib/types.js"

export function registerAITools(server: McpServer) {
  server.tool(
    "chat",
    "Chat with AI assistant about a story. Uses sync mode (non-streaming). The AI has access to the book's knowledge base for context-aware responses.",
    {
      message: z.string().describe("Your message to the AI assistant"),
      bookId: z.string().optional().describe("Book ID for story context"),
      sessionId: z
        .string()
        .optional()
        .describe("Chat session ID (omit to create new session)"),
    },
    async ({ message, bookId, sessionId }) => {
      const client = getClient()
      const response = await client.post<ChatResponse>(
        "/api/chat?sync=true",
        {
          messages: [{ role: "user", content: message }],
          bookId,
          sessionId,
        }
      )
      return {
        content: [
          {
            type: "text" as const,
            text: response.text,
          },
        ],
      }
    }
  )

  server.tool(
    "generate_outline",
    "Generate a story outline based on a premise. Returns structured chapter suggestions.",
    {
      title: z.string().describe("Book/story title"),
      premise: z.string().describe("Story premise or synopsis"),
      genre: z.string().optional().describe("Genre"),
      chapterCount: z
        .number()
        .optional()
        .describe("Target number of chapters (default: 10)"),
    },
    async ({ title, premise, genre, chapterCount }) => {
      const client = getClient()
      const outline = await client.post<unknown>(
        "/api/onboarding/generate-outline",
        {
          title,
          description: premise,
          genre,
          chapterCount: chapterCount || 10,
        }
      )
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(outline, null, 2),
          },
        ],
      }
    }
  )

  server.tool(
    "consistency_check",
    "Run a quick consistency check on a book's content. Detects contradictions, timeline issues, and character inconsistencies.",
    {
      bookId: z.string().describe("The book ID to check"),
    },
    async ({ bookId }) => {
      const client = getClient()
      const result = await client.post<unknown>(
        `/api/books/${bookId}/guardian/quick-check`,
        {}
      )
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      }
    }
  )
}
