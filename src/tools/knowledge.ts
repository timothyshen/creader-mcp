/**
 * Knowledge base MCP tools: search, list_knowledge, CRUD for character/location/event/note
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { getClient } from "../lib/api-client.js"
import { toolError } from "../lib/errors.js"
import type {
  Character,
  Location,
  TimelineEvent,
  Note,
} from "../lib/types.js"

export function registerKnowledgeTools(server: McpServer) {
  server.tool(
    "search_knowledge",
    "Search knowledge base",
    {
      bookId: z.string().describe("Book ID"),
      query: z.string().describe("Search query"),
      type: z.enum(["character", "location", "event", "note"]).optional(),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ bookId, query, type }) => {
      try {
        const client = getClient()
        let path = `/api/books/${bookId}/knowledge?q=${encodeURIComponent(query)}`
        if (type) path += `&type=${type}`
        const results = await client.get<unknown>(path)
        return {
          content: [{ type: "text" as const, text: JSON.stringify(results) }],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "list_knowledge",
    "List characters, locations, or events in a book",
    {
      bookId: z.string().describe("Book ID"),
      type: z.enum(["characters", "locations", "events"]),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ bookId, type }) => {
      try {
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
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "create_character",
    "Create a character",
    {
      bookId: z.string().describe("Book ID"),
      name: z.string(),
      role: z.enum(["protagonist", "antagonist", "supporting", "minor"]),
      description: z.string().optional(),
      age: z.number().optional(),
      tags: z.array(z.string()).optional(),
    },
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ bookId, name, role, description, age, tags }) => {
      try {
        const client = getClient()
        const char = await client.post<Character>(
          `/api/books/${bookId}/characters`,
          { name, role, description, age, tags }
        )
        return {
          content: [{ type: "text" as const, text: `Created character: ${char.name} (id:${char.id})` }],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "create_location",
    "Create a location",
    {
      bookId: z.string().describe("Book ID"),
      name: z.string(),
      type: z.string().describe("e.g. city, forest, castle"),
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ bookId, name, type, description, tags }) => {
      try {
        const client = getClient()
        const loc = await client.post<Location>(
          `/api/books/${bookId}/locations`,
          { name, type, description, tags }
        )
        return {
          content: [{ type: "text" as const, text: `Created location: ${loc.name} (id:${loc.id})` }],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "create_event",
    "Create a timeline event",
    {
      bookId: z.string().describe("Book ID"),
      title: z.string(),
      eventType: z.enum(["plot", "character", "world", "conflict", "resolution", "development"]),
      description: z.string().optional(),
      importance: z.enum(["major", "minor", "background"]).optional(),
      timestamp: z.number().describe("Ordering position"),
      consequences: z.string().optional(),
    },
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ bookId, title, eventType, description, importance, timestamp, consequences }) => {
      try {
        const client = getClient()
        const event = await client.post<TimelineEvent>(
          `/api/books/${bookId}/timeline-events`,
          { title, eventType, description, importance, timestamp, consequences }
        )
        return {
          content: [{ type: "text" as const, text: `Created event: ${event.title} (id:${event.id})` }],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "create_note",
    "Create a note",
    {
      bookId: z.string().describe("Book ID"),
      title: z.string(),
      content: z.string().optional(),
      noteType: z.enum(["worldbuilding", "research", "note", "general"]).optional(),
    },
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ bookId, title, content, noteType }) => {
      try {
        const client = getClient()
        const note = await client.post<Note>(`/api/books/${bookId}/notes`, {
          title,
          content,
          noteType,
        })
        return {
          content: [{ type: "text" as const, text: `Created note: ${note.title} (id:${note.id})` }],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  // ── Update tools ──────────────────────────────────────────────────

  server.tool(
    "update_character",
    "Update a character",
    {
      id: z.string().describe("Character ID"),
      name: z.string().optional(),
      description: z.string().optional(),
      role: z.enum(["protagonist", "antagonist", "supporting", "minor"]).optional(),
      age: z.number().optional(),
      tags: z.array(z.string()).optional(),
    },
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ id, ...fields }) => {
      try {
        const client = getClient()
        const char = await client.patch<Character>(`/api/characters/${id}`, fields)
        return {
          content: [{ type: "text" as const, text: `Updated character: ${char.name} (id:${char.id})` }],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "update_location",
    "Update a location",
    {
      id: z.string().describe("Location ID"),
      name: z.string().optional(),
      description: z.string().optional(),
      type: z.string().describe("e.g. city, forest, castle").optional(),
      tags: z.array(z.string()).optional(),
    },
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ id, ...fields }) => {
      try {
        const client = getClient()
        const loc = await client.patch<Location>(`/api/locations/${id}`, fields)
        return {
          content: [{ type: "text" as const, text: `Updated location: ${loc.name} (id:${loc.id})` }],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "update_event",
    "Update a timeline event",
    {
      id: z.string().describe("Event ID"),
      title: z.string().optional(),
      description: z.string().optional(),
      eventType: z.enum(["plot", "character", "world", "conflict", "resolution", "development"]).optional(),
      importance: z.enum(["major", "minor", "background"]).optional(),
      timestamp: z.number().describe("Ordering position").optional(),
      consequences: z.string().optional(),
    },
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ id, ...fields }) => {
      try {
        const client = getClient()
        const event = await client.patch<TimelineEvent>(`/api/timeline-events/${id}`, fields)
        return {
          content: [{ type: "text" as const, text: `Updated event: ${event.title} (id:${event.id})` }],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "update_note",
    "Update a note",
    {
      id: z.string().describe("Note ID"),
      title: z.string().optional(),
      content: z.string().optional(),
      noteType: z.enum(["worldbuilding", "research", "note", "general"]).optional(),
    },
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ id, ...fields }) => {
      try {
        const client = getClient()
        const note = await client.patch<Note>(`/api/notes/${id}`, fields)
        return {
          content: [{ type: "text" as const, text: `Updated note: ${note.title} (id:${note.id})` }],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  // ── Delete tools ──────────────────────────────────────────────────

  server.tool(
    "delete_character",
    "Delete a character",
    {
      id: z.string().describe("Character ID"),
    },
    { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async ({ id }) => {
      try {
        const client = getClient()
        await client.delete(`/api/characters/${id}`)
        return {
          content: [{ type: "text" as const, text: `Deleted character ${id}` }],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "delete_location",
    "Delete a location",
    {
      id: z.string().describe("Location ID"),
    },
    { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async ({ id }) => {
      try {
        const client = getClient()
        await client.delete(`/api/locations/${id}`)
        return {
          content: [{ type: "text" as const, text: `Deleted location ${id}` }],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "delete_event",
    "Delete a timeline event",
    {
      id: z.string().describe("Event ID"),
    },
    { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async ({ id }) => {
      try {
        const client = getClient()
        await client.delete(`/api/timeline-events/${id}`)
        return {
          content: [{ type: "text" as const, text: `Deleted event ${id}` }],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "delete_note",
    "Delete a note",
    {
      id: z.string().describe("Note ID"),
    },
    { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async ({ id }) => {
      try {
        const client = getClient()
        await client.delete(`/api/notes/${id}`)
        return {
          content: [{ type: "text" as const, text: `Deleted note ${id}` }],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )
}
