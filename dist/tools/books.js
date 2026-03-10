/**
 * Book management MCP tools: list_books, get_book, create_book, get_book_context
 */
import { z } from "zod";
import { getClient } from "../lib/api-client.js";
import { toolError } from "../lib/errors.js";
function formatBook(b) {
    const parts = [`Title: ${b.title}`, `ID: ${b.id}`, `Type: ${b.contentType}`];
    if (b.description)
        parts.push(`Description: ${b.description}`);
    if (b.visibility)
        parts.push(`Visibility: ${b.visibility}`);
    return parts.join(" | ");
}
export function registerBookTools(server) {
    server.tool("list_books", "List all books", {}, { readOnlyHint: true, openWorldHint: true }, async () => {
        try {
            const client = getClient();
            const books = await client.get("/api/books");
            const text = books.length
                ? books.map(b => `- ${b.title} (id:${b.id}, ${b.contentType})`).join("\n")
                : "No books found.";
            return { content: [{ type: "text", text }] };
        }
        catch (error) {
            return toolError(error);
        }
    });
    server.tool("get_book", "Get book details", { bookId: z.string().describe("Book ID") }, { readOnlyHint: true, openWorldHint: true }, async ({ bookId }) => {
        try {
            const client = getClient();
            const book = await client.get(`/api/books/${bookId}`);
            return { content: [{ type: "text", text: formatBook(book) }] };
        }
        catch (error) {
            return toolError(error);
        }
    });
    server.tool("create_book", "Create a new book", {
        title: z.string(),
        description: z.string().optional(),
        genre: z.string().optional(),
        contentType: z.enum(["novel", "autobiography", "worldbook", "encyclopedia"]).optional(),
    }, { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, async ({ title, description, genre, contentType }) => {
        try {
            const client = getClient();
            const book = await client.post("/api/books", {
                title,
                description,
                genre,
                contentType,
            });
            return {
                content: [{ type: "text", text: `Created: ${book.title} (id:${book.id})` }],
            };
        }
        catch (error) {
            return toolError(error);
        }
    });
    server.tool("get_book_context", "Get full book context in one call: metadata, chapter list, characters, locations, and events. Use this before writing or editing.", { bookId: z.string().describe("Book ID") }, { readOnlyHint: true, openWorldHint: true }, async ({ bookId }) => {
        try {
            const client = getClient();
            const [book, chapters, characters, locations, events] = await Promise.all([
                client.get(`/api/books/${bookId}`),
                client.get(`/api/books/${bookId}/chapters`),
                client.get(`/api/books/${bookId}/characters`),
                client.get(`/api/books/${bookId}/locations`),
                client.get(`/api/books/${bookId}/timeline-events`),
            ]);
            const sections = [];
            sections.push(`## Book\n${formatBook(book)}`);
            if (chapters.length) {
                sections.push(`## Chapters\n${chapters.map(c => `${c.orderIndex + 1}. ${c.title} (${c.wordCount} words) id:${c.id}`).join("\n")}`);
            }
            if (characters.length) {
                sections.push(`## Characters\n${characters.map(c => `- ${c.name} (${c.role || "unset"}) id:${c.id}${c.description ? `: ${c.description}` : ""}`).join("\n")}`);
            }
            if (locations.length) {
                sections.push(`## Locations\n${locations.map(l => `- ${l.name} (${l.type || "unset"}) id:${l.id}${l.description ? `: ${l.description}` : ""}`).join("\n")}`);
            }
            if (events.length) {
                sections.push(`## Events\n${events.map(e => `- [${e.importance || "minor"}] ${e.title} (${e.eventType || "plot"}) id:${e.id}${e.description ? `: ${e.description}` : ""}`).join("\n")}`);
            }
            return { content: [{ type: "text", text: sections.join("\n\n") }] };
        }
        catch (error) {
            return toolError(error);
        }
    });
}
