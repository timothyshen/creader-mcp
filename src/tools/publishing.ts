/**
 * Publishing MCP tools: set_visibility
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { getClient } from "../lib/api-client.js"
import { toolError } from "../lib/errors.js"

/** What a publish echoes back: the book as it now stands. */
interface PublishedBook {
  id: string
  title: string
  visibility: string
  publishedAt: string | null
}

export function registerPublishingTools(server: McpServer) {
  server.tool(
    "set_visibility",
    [
      "Publish or unpublish a whole book by setting its visibility (PRIVATE, LINK_ONLY, PUBLIC).",
      "Every chapter follows the book and any per-chapter visibility is overwritten: PUBLIC or",
      "LINK_ONLY gives every chapter — drafts included — that visibility and stamps it published",
      "now; PRIVATE hides every chapter. Volumes are clamped down on a downgrade (PRIVATE hides",
      "them all, LINK_ONLY turns PUBLIC volumes LINK_ONLY) but never raised.",
      "A non-PRIVATE visibility also sets the book's first-published date (kept from then on)",
      "and switches on the author's public page if it was off.",
      "Only the book owner can do this, and the API key needs the 'publish' scope, which keys",
      "are not given by default.",
    ].join(" "),
    {
      bookId: z.string().describe("Book ID"),
      visibility: z.enum(["PRIVATE", "LINK_ONLY", "PUBLIC"]),
    },
    // Not idempotent: every non-PRIVATE call re-stamps each chapter's published date.
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    async ({ bookId, visibility }) => {
      try {
        const client = getClient()
        const book = await client.post<PublishedBook>(`/api/books/${bookId}/publish`, { visibility })
        const lines = [
          `Visibility set to ${book.visibility}: "${book.title}" (id:${book.id}). Every chapter now matches.`,
        ]
        if (book.publishedAt) lines.push(`First published: ${book.publishedAt}`)
        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )
}
