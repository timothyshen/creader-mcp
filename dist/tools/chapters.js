/**
 * Chapter management MCP tools: list_chapters, get_chapter, create_chapter, update_chapter
 *
 * ## Why update_chapter tracks a content baseline
 *
 * A chapter is the writer's actual words, and the MCP server is not the only
 * thing writing them — the editor, another tab, and the offline replay queue
 * all PATCH the same row. The product's PATCH has a compare-and-swap guard
 * for exactly this: send `baseContentHash` (the fingerprint of the prose your
 * edit diverged from) and the server 409s instead of burying whatever landed
 * in the meantime. Send nothing and you get last-write-wins, which is what
 * this tool did — silently destroying concurrent edits.
 *
 * The guard only means something if the hash describes the prose the edit was
 * BASED on. Re-reading the chapter at write time and hashing that would
 * satisfy the server every time while protecting nothing. So every read that
 * hands prose to the caller records its fingerprint here, and the write sends
 * that. The caller can also pass `baseContentHash` explicitly — get_chapter
 * prints it — which is what survives an MCP server restart.
 */
import { z } from "zod";
import { getClient } from "../lib/api-client.js";
import { contentHash } from "../lib/content-hash.js";
import { ApiRequestError, toolError } from "../lib/errors.js";
/** Server's code for "your edit diverged from prose that has since changed". */
const CHAPTER_CONTENT_CONFLICT = "CHAPTER_CONTENT_CONFLICT";
/**
 * chapterId → fingerprint of the prose this process last saw on the server.
 * Written on every read/write that observes content; read by update_chapter.
 */
const baselines = new Map();
function rememberBaseline(chapter) {
    const hash = contentHash(chapter.content || "");
    baselines.set(chapter.id, hash);
    return hash;
}
export function registerChapterTools(server) {
    server.tool("list_chapters", "List chapters in a book (no content)", { bookId: z.string().describe("Book ID") }, { readOnlyHint: true, openWorldHint: true }, async ({ bookId }) => {
        try {
            const client = getClient();
            const chapters = await client.get(`/api/books/${bookId}/chapters`);
            const text = chapters.length
                ? chapters.map(c => `${c.orderIndex + 1}. ${c.title} (${c.wordCount} words) id:${c.id}`).join("\n")
                : "No chapters found.";
            return { content: [{ type: "text", text }] };
        }
        catch (error) {
            return toolError(error);
        }
    });
    server.tool("get_chapter", "Get chapter content. Also returns a baseContentHash — pass it back to update_chapter so a concurrent edit from the editor is reported as a conflict instead of being overwritten.", { chapterId: z.string().describe("Chapter ID") }, { readOnlyHint: true, openWorldHint: true }, async ({ chapterId }) => {
        try {
            const client = getClient();
            const ch = await client.get(`/api/chapters/${chapterId}`);
            const hash = rememberBaseline(ch);
            return {
                content: [{
                        type: "text",
                        text: `# ${ch.title}\nid:${ch.id} | ${ch.wordCount} words | baseContentHash:${hash}\n\n${ch.content || "(empty)"}`,
                    }],
            };
        }
        catch (error) {
            return toolError(error);
        }
    });
    server.tool("create_chapter", "Create a new chapter in a book", {
        bookId: z.string().describe("Book ID"),
        title: z.string().describe("Chapter title"),
        content: z.string().optional().describe("HTML content"),
        orderIndex: z.number().optional().describe("Position index (auto-assigned if omitted)"),
        volumeId: z.string().optional().describe("Volume ID if grouped"),
    }, { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, async ({ bookId, title, content, orderIndex, volumeId }) => {
        try {
            const client = getClient();
            const ch = await client.post(`/api/books/${bookId}/chapters`, {
                title,
                content,
                orderIndex,
                volumeId,
            });
            // We know exactly what prose this chapter starts with, so the caller
            // can go straight to update_chapter without a read first.
            rememberBaseline(ch);
            return {
                content: [{ type: "text", text: `Created chapter: ${ch.title} (id:${ch.id}, order:${ch.orderIndex})` }],
            };
        }
        catch (error) {
            return toolError(error);
        }
    });
    server.tool("update_chapter", "Update chapter title or content. Writing content requires a baseContentHash — the one get_chapter returned for the version you edited. It is remembered automatically after get_chapter or create_chapter in this session; pass it explicitly otherwise. If someone else changed the chapter meanwhile, the write is rejected as a conflict rather than overwriting their words.", {
        chapterId: z.string().describe("Chapter ID"),
        title: z.string().optional(),
        content: z.string().optional().describe("HTML content"),
        baseContentHash: z
            .string()
            .optional()
            .describe("baseContentHash from get_chapter for the version this edit is based on"),
    }, { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, async ({ chapterId, title, content, baseContentHash }) => {
        // A title-only edit has no divergence guard on the server and cannot
        // clobber prose, so it needs no baseline.
        const base = baseContentHash ?? baselines.get(chapterId);
        if (content !== undefined && !base) {
            return toolError(new Error(`Refusing to write content to ${chapterId} without a baseContentHash — the write would silently overwrite any edit made in the editor. Call get_chapter first and pass back the baseContentHash it returns.`));
        }
        try {
            const client = getClient();
            const ch = await client.patch(`/api/chapters/${chapterId}`, {
                title,
                content,
                ...(content !== undefined ? { baseContentHash: base } : {}),
            });
            // Re-baseline so consecutive edits chain without another read.
            rememberBaseline(ch);
            return {
                content: [{ type: "text", text: `Updated: ${ch.title} (${ch.wordCount} words)` }],
            };
        }
        catch (error) {
            if (error instanceof ApiRequestError &&
                (error.status === 409 || error.code === CHAPTER_CONTENT_CONFLICT)) {
                // The baseline we held is provably stale, and so is any cached copy
                // of the chapter — drop both, or the caller re-reads the same dead
                // pre-image and loops.
                baselines.delete(chapterId);
                getClient().invalidate(`/api/chapters/${chapterId}`);
                return {
                    content: [{
                            type: "text",
                            text: `Conflict: chapter ${chapterId} was changed by someone else (the editor, another device, or an offline replay) after the version you edited. Nothing was written and no words were lost. Call get_chapter to read the current text, merge your change into it, then update_chapter with the new baseContentHash. Server said: ${error.message}`,
                        }],
                    isError: true,
                };
            }
            return toolError(error);
        }
    });
}
