/**
 * Chapter management MCP tools: list_chapters, get_chapter, create_chapter,
 * update_chapter, delete_chapter, reorder_chapters, search_book
 *
 * `search_book` lives here rather than with the book tools because what it
 * returns is chapters, and what the caller does next is get_chapter.
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
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare function registerChapterTools(server: McpServer): void;
