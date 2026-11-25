/**
 * Knowledge base MCP tools: search, list_knowledge, list_notes, get_character,
 * CRUD for character/location/event/note
 *
 * ## The v1.3.0 deprecation bridge
 *
 * v2.0.0 collapses the 12 per-type CRUD tools below into create_entity /
 * update_entity / delete_entity with a `type` discriminator
 * (docs/UPGRADE_PLAN.md). v1.3.0 only warns: descriptions carry a deprecation
 * notice, behaviour is untouched, so existing clients get one version of
 * warning before the break. The notice is future tense on purpose — the
 * replacement tools do not exist yet, and "use create_entity" phrasing would
 * send an LLM client straight into a tool-not-found error today.
 *
 * ## customFields: create stores, update merges
 *
 * POST writes the object as sent. PATCH folds it into the stored one
 * (creader_editor lib/knowledge/merge-custom-fields.ts, RFC 7386 one level
 * deep): a key present overwrites, a key sent as null is removed, every other
 * key stays. Neither lets a body set or clear the server's own draft marker, so
 * a draft is confirmed through triage and not from here.
 *
 * The PATCH route takes two more shapes that update_character deliberately
 * does not. A bare `null` clears the whole column — card, cover image and life
 * status at once — and some clients fill an unused optional argument with
 * null. An `EntityField[]` carries chapter anchors and provenance that belong
 * to the editor. A flat object works on a row stored that way too: it sets the
 * field's unanchored value (a non-string is stored as JSON text), and null
 * removes the field with its anchored values.
 */
import { z } from "zod";
import { getClient } from "../lib/api-client.js";
import { toolError } from "../lib/errors.js";
/** Uniform deprecation prefix — see the file header for why it is future tense. */
const deprecated = (replacement, description) => `[DEPRECATED — v2.0.0 will replace this with ${replacement}; it still works today] ${description}`;
/** The product's six note types. One list, so the note tools cannot drift apart on it. */
const NOTE_TYPES = ["worldbuilding", "research", "note", "general", "rule", "prohibition"];
const customFieldsSchema = z
    .record(z.string(), z.unknown())
    .describe('One flat object, e.g. { "goals": "...", "personality": "..." }. This is where the character card lives: Creader reads goals, personality, background, arc, appearance, gender and occupation from it, and only where the value is a plain string. Any other key is stored too.');
/** The card as JSON: the keys have to survive exactly, since update_character addresses them. */
function formatCustomFields(customFields) {
    if (!customFields || Object.keys(customFields).length === 0)
        return "customFields: none";
    const heading = Array.isArray(customFields)
        ? `customFields (chapter-aware values; update_character takes each entry's "key"):`
        : "customFields:";
    return `${heading}\n${JSON.stringify(customFields, null, 2)}`;
}
export function registerKnowledgeTools(server) {
    server.tool("search_knowledge", "Search a book's knowledge base (characters, locations, timeline events, notes) by substring. Case-insensitive and character-agnostic, so CJK works the same as English. Queries shorter than 2 characters are rejected by the server.", {
        bookId: z.string().describe("Book ID"),
        query: z
            .string()
            .min(2)
            .describe("Search query — at least 2 characters (server returns nothing below that)"),
        type: z.enum(["character", "location", "event", "note"]).optional(),
        limit: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe("Max results (default 50, server caps at 100)"),
    }, { readOnlyHint: true, openWorldHint: true }, async ({ bookId, query, type, limit }) => {
        try {
            const client = getClient();
            // The route is /knowledge/search, and it replies with bare JSON
            // ({ results, total, query }) rather than the { success, data }
            // envelope — hence getRaw. Both facts were wrong here for months:
            // building the URL into a variable first hid the dead path from
            // every reviewer and from the drift detector's first draft.
            let path = `/api/books/${bookId}/knowledge/search?q=${encodeURIComponent(query)}`;
            if (type)
                path += `&type=${type}`;
            if (limit)
                path += `&limit=${limit}`;
            const results = await client.getRaw(path);
            return {
                content: [{ type: "text", text: JSON.stringify(results) }],
            };
        }
        catch (error) {
            return toolError(error);
        }
    });
    server.tool("list_knowledge", "List characters, locations, or events in a book", {
        bookId: z.string().describe("Book ID"),
        type: z.enum(["characters", "locations", "events"]),
    }, { readOnlyHint: true, openWorldHint: true }, async ({ bookId, type }) => {
        try {
            const client = getClient();
            if (type === "characters") {
                const items = await client.get(`/api/books/${bookId}/characters`);
                const text = items.length
                    ? items.map(c => `- ${c.name} (${c.role || "unset"}) id:${c.id}${c.description ? `: ${c.description}` : ""}`).join("\n")
                    : "No characters found.";
                return { content: [{ type: "text", text }] };
            }
            if (type === "locations") {
                const items = await client.get(`/api/books/${bookId}/locations`);
                const text = items.length
                    ? items.map(l => `- ${l.name} (${l.type || "unset"}) id:${l.id}${l.description ? `: ${l.description}` : ""}`).join("\n")
                    : "No locations found.";
                return { content: [{ type: "text", text }] };
            }
            // events
            const items = await client.get(`/api/books/${bookId}/timeline-events`);
            const text = items.length
                ? items.map(e => `- [${e.importance || "minor"}] ${e.title} (${e.eventType || "plot"}) id:${e.id}${e.description ? `: ${e.description}` : ""}`).join("\n")
                : "No events found.";
            return { content: [{ type: "text", text }] };
        }
        catch (error) {
            return toolError(error);
        }
    });
    server.tool("get_character", "Read one character in full: role, age, tags, description, and customFields (the character card) as JSON. list_knowledge and get_book_context leave age, tags and customFields out, so read this before relying on a card or removing one of its keys. Owner or organization editor only: anyone else gets a not-found error, including a collaborator who can read the book.", { id: z.string().describe("Character ID") }, { readOnlyHint: true, openWorldHint: true }, async ({ id }) => {
        try {
            const client = getClient();
            const c = await client.get(`/api/characters/${id}`);
            const meta = [`id:${c.id}`, c.role || "unset"];
            if (c.age != null)
                meta.push(`age ${c.age}`);
            if (c.tags?.length)
                meta.push(`tags: ${c.tags.join(", ")}`);
            const sections = [`# ${c.name}\n${meta.join(" | ")}`];
            if (c.description)
                sections.push(c.description);
            sections.push(formatCustomFields(c.customFields));
            return { content: [{ type: "text", text: sections.join("\n\n") }] };
        }
        catch (error) {
            return toolError(error);
        }
    });
    server.tool("list_notes", "List a book's notes with their full text, most recently updated first. Use noteType 'rule' or 'prohibition' to read the book's world constraints; get_book_context and list_knowledge do not include notes. Items from the World panel are stored as 'general' notes, so they appear here too. Owner or organization editor only: anyone else gets a not-found error, including a collaborator who can read the book.", {
        bookId: z.string().describe("Book ID"),
        noteType: z.enum(NOTE_TYPES).optional().describe("Only notes of this type; omit for all of them"),
    }, { readOnlyHint: true, openWorldHint: true }, async ({ bookId, noteType }) => {
        try {
            const client = getClient();
            // The route returns every note and reads no query string, so the
            // filter has to happen here.
            const all = await client.get(`/api/books/${bookId}/notes`);
            const notes = noteType ? all.filter(n => n.noteType === noteType) : all;
            const text = notes.length
                ? notes.map(n => `- ${n.title} (${n.noteType || "unset"}) id:${n.id}${n.content ? `: ${n.content}` : ""}`).join("\n")
                : `No ${noteType ? `${noteType} ` : ""}notes found.`;
            return { content: [{ type: "text", text }] };
        }
        catch (error) {
            return toolError(error);
        }
    });
    server.tool("create_character", deprecated(`create_entity(type: "character")`, "Create a character. customFields holds the character card and is stored as sent: a key whose value is null is stored as null, so leave out keys you have no value for."), {
        bookId: z.string().describe("Book ID"),
        name: z.string(),
        role: z.enum(["protagonist", "antagonist", "supporting", "minor"]),
        description: z.string().optional(),
        age: z.number().optional(),
        tags: z.array(z.string()).optional(),
        customFields: customFieldsSchema.optional(),
    }, { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, async ({ bookId, name, role, description, age, tags, customFields }) => {
        try {
            const client = getClient();
            const char = await client.post(`/api/books/${bookId}/characters`, { name, role, description, age, tags, customFields });
            return {
                content: [{ type: "text", text: `Created character: ${char.name} (id:${char.id})` }],
            };
        }
        catch (error) {
            return toolError(error);
        }
    });
    server.tool("create_location", deprecated(`create_entity(type: "location")`, "Create a location"), {
        bookId: z.string().describe("Book ID"),
        name: z.string(),
        type: z.string().describe("e.g. city, forest, castle"),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
    }, { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, async ({ bookId, name, type, description, tags }) => {
        try {
            const client = getClient();
            const loc = await client.post(`/api/books/${bookId}/locations`, { name, type, description, tags });
            return {
                content: [{ type: "text", text: `Created location: ${loc.name} (id:${loc.id})` }],
            };
        }
        catch (error) {
            return toolError(error);
        }
    });
    server.tool("create_event", deprecated(`create_entity(type: "event")`, "Create a timeline event"), {
        bookId: z.string().describe("Book ID"),
        title: z.string(),
        eventType: z.enum(["plot", "character", "world", "conflict", "resolution", "development"]),
        description: z.string().optional(),
        importance: z.enum(["major", "minor", "background"]).optional(),
        timestamp: z.number().describe("Ordering position"),
        consequences: z.string().optional(),
    }, { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, async ({ bookId, title, eventType, description, importance, timestamp, consequences }) => {
        try {
            const client = getClient();
            const event = await client.post(`/api/books/${bookId}/timeline-events`, { title, eventType, description, importance, timestamp, consequences });
            return {
                content: [{ type: "text", text: `Created event: ${event.title} (id:${event.id})` }],
            };
        }
        catch (error) {
            return toolError(error);
        }
    });
    server.tool("create_note", deprecated(`create_entity(type: "note")`, "Create a note"), {
        bookId: z.string().describe("Book ID"),
        title: z.string(),
        content: z.string().optional(),
        noteType: z
            .enum(NOTE_TYPES)
            .optional()
            .describe("'rule' and 'prohibition' are world constraints — force-injected into every AI prompt for this book as MUST OBEY / NEVER DO, and capped per subscription tier (a 403 CONSTRAINT_LIMIT_REACHED means the plan's limit is reached). The other four are ordinary notes."),
    }, { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, async ({ bookId, title, content, noteType }) => {
        try {
            const client = getClient();
            const note = await client.post(`/api/books/${bookId}/notes`, {
                title,
                content,
                noteType,
            });
            return {
                content: [{ type: "text", text: `Created note: ${note.title} (id:${note.id})` }],
            };
        }
        catch (error) {
            return toolError(error);
        }
    });
    // ── Update tools ──────────────────────────────────────────────────
    server.tool("update_character", deprecated(`update_entity(type: "character")`, "Update a character; fields you omit are unchanged. customFields is merged into what is stored, never a replacement: keys you send overwrite, keys you leave out are kept, and a key sent as null is removed, with any per-chapter values it has. The merge is one level deep, so a nested object or array replaces the stored value whole. get_character shows the keys a character has."), {
        id: z.string().describe("Character ID"),
        name: z.string().optional(),
        description: z.string().optional(),
        role: z.enum(["protagonist", "antagonist", "supporting", "minor"]).optional(),
        age: z.number().optional(),
        tags: z.array(z.string()).optional(),
        customFields: customFieldsSchema.optional(),
    }, { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, async ({ id, ...fields }) => {
        try {
            const client = getClient();
            const char = await client.patch(`/api/characters/${id}`, fields);
            return {
                content: [{ type: "text", text: `Updated character: ${char.name} (id:${char.id})` }],
            };
        }
        catch (error) {
            return toolError(error);
        }
    });
    server.tool("update_location", deprecated(`update_entity(type: "location")`, "Update a location"), {
        id: z.string().describe("Location ID"),
        name: z.string().optional(),
        description: z.string().optional(),
        type: z.string().describe("e.g. city, forest, castle").optional(),
        tags: z.array(z.string()).optional(),
    }, { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, async ({ id, ...fields }) => {
        try {
            const client = getClient();
            const loc = await client.patch(`/api/locations/${id}`, fields);
            return {
                content: [{ type: "text", text: `Updated location: ${loc.name} (id:${loc.id})` }],
            };
        }
        catch (error) {
            return toolError(error);
        }
    });
    server.tool("update_event", deprecated(`update_entity(type: "event")`, "Update a timeline event"), {
        id: z.string().describe("Event ID"),
        title: z.string().optional(),
        description: z.string().optional(),
        eventType: z.enum(["plot", "character", "world", "conflict", "resolution", "development"]).optional(),
        importance: z.enum(["major", "minor", "background"]).optional(),
        timestamp: z.number().describe("Ordering position").optional(),
        consequences: z.string().optional(),
    }, { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, async ({ id, ...fields }) => {
        try {
            const client = getClient();
            const event = await client.patch(`/api/timeline-events/${id}`, fields);
            return {
                content: [{ type: "text", text: `Updated event: ${event.title} (id:${event.id})` }],
            };
        }
        catch (error) {
            return toolError(error);
        }
    });
    server.tool("update_note", deprecated(`update_entity(type: "note")`, "Update a note"), {
        id: z.string().describe("Note ID"),
        title: z.string().optional(),
        content: z.string().optional(),
        noteType: z
            .enum(NOTE_TYPES)
            .optional()
            .describe("'rule' and 'prohibition' are world constraints — force-injected into every AI prompt for this book as MUST OBEY / NEVER DO, and capped per subscription tier (a 403 CONSTRAINT_LIMIT_REACHED means the plan's limit is reached). The other four are ordinary notes."),
    }, { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, async ({ id, ...fields }) => {
        try {
            const client = getClient();
            const note = await client.patch(`/api/notes/${id}`, fields);
            return {
                content: [{ type: "text", text: `Updated note: ${note.title} (id:${note.id})` }],
            };
        }
        catch (error) {
            return toolError(error);
        }
    });
    // ── Delete tools ──────────────────────────────────────────────────
    server.tool("delete_character", deprecated(`delete_entity(type: "character")`, "Delete a character"), {
        id: z.string().describe("Character ID"),
    }, { readOnlyHint: false, destructiveHint: true, openWorldHint: true }, async ({ id }) => {
        try {
            const client = getClient();
            await client.delete(`/api/characters/${id}`);
            return {
                content: [{ type: "text", text: `Deleted character ${id}` }],
            };
        }
        catch (error) {
            return toolError(error);
        }
    });
    server.tool("delete_location", deprecated(`delete_entity(type: "location")`, "Delete a location"), {
        id: z.string().describe("Location ID"),
    }, { readOnlyHint: false, destructiveHint: true, openWorldHint: true }, async ({ id }) => {
        try {
            const client = getClient();
            await client.delete(`/api/locations/${id}`);
            return {
                content: [{ type: "text", text: `Deleted location ${id}` }],
            };
        }
        catch (error) {
            return toolError(error);
        }
    });
    server.tool("delete_event", deprecated(`delete_entity(type: "event")`, "Delete a timeline event"), {
        id: z.string().describe("Event ID"),
    }, { readOnlyHint: false, destructiveHint: true, openWorldHint: true }, async ({ id }) => {
        try {
            const client = getClient();
            await client.delete(`/api/timeline-events/${id}`);
            return {
                content: [{ type: "text", text: `Deleted event ${id}` }],
            };
        }
        catch (error) {
            return toolError(error);
        }
    });
    server.tool("delete_note", deprecated(`delete_entity(type: "note")`, "Delete a note"), {
        id: z.string().describe("Note ID"),
    }, { readOnlyHint: false, destructiveHint: true, openWorldHint: true }, async ({ id }) => {
        try {
            const client = getClient();
            await client.delete(`/api/notes/${id}`);
            return {
                content: [{ type: "text", text: `Deleted note ${id}` }],
            };
        }
        catch (error) {
            return toolError(error);
        }
    });
}
