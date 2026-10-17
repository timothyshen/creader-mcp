/**
 * Article MCP tools: list_articles, get_article, create_article,
 * update_article, delete_article, set_article_visibility,
 * guardian_check_article, list_article_guardian_issues,
 * resolve_article_guardian_issue, list_article_notes, create_article_note
 *
 * An article is Creader's other kind of writing: one standalone piece — an
 * essay, a blog post, a student draft — that belongs to its writer rather than
 * to a book. No chapters, no knowledge base, no structure; just the prose, a
 * few notes, its own Guardian queue, and a public page when the writer wants
 * one.
 *
 * ## What is deliberately missing
 *
 * The product also has comments, comment invitations and AI prose proposals on
 * articles, but those routes accept a browser session only and refuse an API
 * key, so there is nothing for a tool to call.
 *
 * ## Why update_article guards a content write twice
 *
 * Same hazard as update_chapter: the editor, another tab and the offline replay
 * queue all write the same row. The article PATCH now has the chapter PATCH's
 * guard — send `baseContentHash` with `content` and the server compare-and-swaps
 * the write, 409ing with ARTICLE_CONTENT_CONFLICT if the prose moved. Where that
 * is deployed, it closes the race.
 *
 * A deployment that predates the guard strips the unknown field and writes
 * last-write-wins, and the tool cannot tell which kind it is talking to. So it
 * keeps the check it made before the guard existed: re-read the article
 * immediately before writing and refuse if its prose no longer matches the
 * version the edit was based on. Against an unguarded deployment that shrinks
 * the window to the instant between the re-read and the write without closing
 * it. The re-read can go once the guard is everywhere.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare function registerArticleTools(server: McpServer): void;
