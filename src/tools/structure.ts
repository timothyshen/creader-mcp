/**
 * Structural read MCP tools: list_volumes, list_acts, list_scenes
 *
 * Creader v1.0 organises a book as volume → act → chapter → scene, but until
 * now MCP clients could only see chapters — the rest of the spine was
 * invisible. These three tools close that gap. Read-only by design: structure
 * mutations stay in the editor until usage patterns justify write tools
 * (docs/UPGRADE_PLAN.md, v1.2.0).
 *
 * All three routes return the full set for the book, ordered by orderIndex,
 * with no query params. orderIndex is scoped to the parent (act order restarts
 * per volume, scene order per chapter), so lines carry the parent id rather
 * than a book-wide number.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { getClient } from "../lib/api-client.js"
import { toolError } from "../lib/errors.js"
import type { Act, Scene, Volume } from "../lib/types.js"

export function registerStructureTools(server: McpServer) {
  server.tool(
    "list_volumes",
    "List a book's volumes (top level of the volume → act → chapter → scene hierarchy)",
    { bookId: z.string().describe("Book ID") },
    { readOnlyHint: true, openWorldHint: true },
    async ({ bookId }) => {
      try {
        const client = getClient()
        const volumes = await client.get<Volume[]>(`/api/books/${bookId}/volumes`)
        const text = volumes.length
          ? volumes
              .map(
                v =>
                  `${v.orderIndex + 1}. ${v.title} (${v._count?.chapters ?? 0} chapters) id:${v.id}${v.description ? `: ${v.description}` : ""}`
              )
              .join("\n")
          : "No volumes found."
        return { content: [{ type: "text" as const, text }] }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "list_acts",
    "List a book's acts. Each act belongs to a volume (or none) and groups chapters.",
    { bookId: z.string().describe("Book ID") },
    { readOnlyHint: true, openWorldHint: true },
    async ({ bookId }) => {
      try {
        const client = getClient()
        const acts = await client.get<Act[]>(`/api/books/${bookId}/acts`)
        const text = acts.length
          ? acts
              .map(
                a =>
                  `- ${a.name} id:${a.id} volume:${a.volumeId ?? "none"} order:${a.orderIndex}${a.description ? `: ${a.description}` : ""}`
              )
              .join("\n")
          : "No acts found."
        return { content: [{ type: "text" as const, text }] }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "list_scenes",
    "List a book's scenes. Each scene hangs off a chapter and/or act; order is scoped to that parent.",
    { bookId: z.string().describe("Book ID") },
    { readOnlyHint: true, openWorldHint: true },
    async ({ bookId }) => {
      try {
        const client = getClient()
        const scenes = await client.get<Scene[]>(`/api/books/${bookId}/scenes`)
        const text = scenes.length
          ? scenes
              .map(
                s =>
                  `- ${s.title}${s.status ? ` (${s.status})` : ""} id:${s.id} chapter:${s.chapterId ?? "none"} act:${s.actId ?? "none"} order:${s.orderIndex}${s.synopsis ? `: ${s.synopsis}` : ""}`
              )
              .join("\n")
          : "No scenes found."
        return { content: [{ type: "text" as const, text }] }
      } catch (error) {
        return toolError(error)
      }
    }
  )
}
