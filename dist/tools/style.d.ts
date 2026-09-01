/**
 * Style MCP tools: get_style, list_style_references, add_style_references,
 * delete_style_reference, set_style_learning
 *
 * Two different things share the word "style" in Creader, and conflating them
 * is the mistake this file exists to prevent:
 *
 *   fingerprint  — MEASURED. Sentence lengths, vocabulary diversity, tone, POV,
 *                  tense, commonest words, computed from the author's own prose
 *                  by the style analyzer and re-derived as the manuscript
 *                  changes. Read it to write in this author's voice.
 *   references   — AUTHORED. Passages the writer chose as exemplars of how they
 *                  want to sound. A corpus, not a measurement.
 *
 * ## Why there is no set_style
 *
 * `PUT /style` exists and takes an API key, so a `set_style` tool would have
 * been two lines. It is deliberately absent. The fingerprint is a measurement
 * of prose that exists — editor-v2 computes it with the analyzer and PUTs the
 * result. A model writing one by hand would be fabricating a measurement, and
 * every AI call on that book afterwards is steered by it: chat, inline, the
 * L2 detectors. A wrong fingerprint does not fail loudly, it quietly teaches
 * the book the wrong voice. Reading is the whole value here; writing is a
 * footgun with no use case behind it.
 *
 * ## Not wrapped
 *
 * The Twitter-archive import is a multipart file upload (tweet.js, 5MB cap).
 * There is no file to upload from an MCP client, and the same rows can be
 * created through add_style_references with source "archive_import".
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare function registerStyleTools(server: McpServer): void;
