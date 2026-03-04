/**
 * Knowledge base MCP tools: search, list_knowledge, create character/location/event/note
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { getClient } from "../lib/api-client.js"
import type {
  Character,
  Location,
  TimelineEvent,
  Note,
} from "../lib/types.js"

export function registerKnowledgeTools(server: McpServer) {
  // Search
  server.tool(
    "search_knowledge",
    "Full-text search across all knowledge entries (characters, locations, events, notes) in a book",
    {
      bookId: z.string().describe("The book ID"),
      query: z.string().describe("Search query (min 2 characters)"),
      type: z
        .enum(["character", "location", "event", "note"])
        .optional()
        .describe("Filter by entity type"),
    },
    async ({ bookId, query, type }) => {
      const client = getClient()
      let path = `/api/books/${bookId}/knowledge?q=${encodeURIComponent(query)}`
      if (type) path += `&type=${type}`
      const results = await client.get<unknown>(path)
      return {
        content: [{ type: "text" as const, text: JSON.stringify(results) }],
      }
    }
  )

  // Consolidated list tool
  server.tool(
    "list_knowledge",
    "List knowledge entries in a book — characters, locations, or events",
    {
      bookId: z.string().describe("The book ID"),
      type: z.enum(["characters", "locations", "events"]).describe("Type of knowledge to list"),
    },
    async ({ bookId, type }) => {
      const client = getClient()

      if (type === "characters") {
        const items = await client.get<Character[]>(`/api/books/${bookId}/characters`)
        const text = items.length
          ? items.map(c => `- ${c.name} (${c.role || "unset"}) id:${c.id}${c.description ? `: ${c.description}` : ""}`).join("\n")
          : "No characters found."
        return { content: [{ type: "text" as const, text }] }
      }

      if (type === "locations") {
        const items = await client.get<Location[]>(`/api/books/${bookId}/locations`)
        const text = items.length
          ? items.map(l => `- ${l.name} (${l.type || "unset"}) id:${l.id}${l.description ? `: ${l.description}` : ""}`).join("\n")
          : "No locations found."
        return { content: [{ type: "text" as const, text }] }
      }

      // events
      const items = await client.get<TimelineEvent[]>(`/api/books/${bookId}/timeline-events`)
      const text = items.length
        ? items.map(e => `- [${e.importance || "minor"}] ${e.title} (${e.eventType || "plot"}) id:${e.id}${e.description ? `: ${e.description}` : ""}`).join("\n")
        : "No events found."
      return { content: [{ type: "text" as const, text }] }
    }
  )

  // Create character
  server.tool(
    "create_character",
    "Create a new character in a book",
    {
      bookId: z.string().describe("The book ID"),
      name: z.string().describe("Character name"),
      role: z
        .enum(["protagonist", "antagonist", "supporting", "minor"])
        .describe("Character role"),
      description: z.string().optional().describe("Character description"),
      age: z.number().optional().describe("Character age"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Tags for categorization"),
    },
    async ({ bookId, name, role, description, age, tags }) => {
      const client = getClient()
      const char = await client.post<Character>(
        `/api/books/${bookId}/characters`,
        { name, role, description, age, tags }
      )
      return {
        content: [{ type: "text" as const, text: `Created character: ${char.name} (id:${char.id})` }],
      }
    }
  )

  // Create location
  server.tool(
    "create_location",
    "Create a new location in a book",
    {
      bookId: z.string().describe("The book ID"),
      name: z.string().describe("Location name"),
      type: z
        .string()
        .describe("Location type (e.g. city, forest, castle, country)"),
      description: z.string().optional().describe("Location description"),
      tags: z.array(z.string()).optional().describe("Tags"),
    },
    async ({ bookId, name, type, description, tags }) => {
      const client = getClient()
      const loc = await client.post<Location>(
        `/api/books/${bookId}/locations`,
        { name, type, description, tags }
      )
      return {
        content: [{ type: "text" as const, text: `Created location: ${loc.name} (id:${loc.id})` }],
      }
    }
  )

  // Create event
  server.tool(
    "create_event",
    "Create a new timeline event in a book",
    {
      bookId: z.string().describe("The book ID"),
      title: z.string().describe("Event title"),
      eventType: z
        .enum([
          "plot",
          "character",
          "world",
          "conflict",
          "resolution",
          "development",
        ])
        .describe("Event type"),
      description: z.string().optional().describe("Event description"),
      importance: z
        .enum(["major", "minor", "background"])
        .optional()
        .describe("Event importance (default: minor)"),
      timestamp: z
        .number()
        .describe("Event timestamp (use sequential integers for ordering)"),
      consequences: z
        .string()
        .optional()
        .describe("Consequences of this event"),
    },
    async ({ bookId, title, eventType, description, importance, timestamp, consequences }) => {
      const client = getClient()
      const event = await client.post<TimelineEvent>(
        `/api/books/${bookId}/timeline-events`,
        { title, eventType, description, importance, timestamp, consequences }
      )
      return {
        content: [{ type: "text" as const, text: `Created event: ${event.title} (id:${event.id})` }],
      }
    }
  )

  // Create note
  server.tool(
    "create_note",
    "Create a note in a book (for worldbuilding, research, or communication between agents)",
    {
      bookId: z.string().describe("The book ID"),
      title: z.string().describe("Note title"),
      content: z.string().optional().describe("Note content"),
      noteType: z
        .enum(["worldbuilding", "research", "note", "general"])
        .optional()
        .describe("Note type (default: general)"),
    },
    async ({ bookId, title, content, noteType }) => {
      const client = getClient()
      const note = await client.post<Note>(`/api/books/${bookId}/notes`, {
        title,
        content,
        noteType,
      })
      return {
        content: [{ type: "text" as const, text: `Created note: ${note.title} (id:${note.id})` }],
      }
    }
  )
}
