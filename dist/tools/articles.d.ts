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
 * ## Why update_article checks for a conflict itself
 *
 * Same hazard as update_chapter: the editor, another tab and the offline replay
 * queue all write the same row. But the product guards chapter writes only —
 * the article PATCH is last-write-wins, and nothing the editor sends would let
 * it be otherwise. So the comparison the server makes for chapters is made
 * here: re-read the article immediately before writing and refuse if its prose
 * no longer matches the version the edit was based on. That shrinks the window
 * from "any time since you read it" to the instant between the re-read and the
 * write. It does not close it, and the tool description says so.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare function registerArticleTools(server: McpServer): void;
