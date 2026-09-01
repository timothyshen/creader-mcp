/**
 * Structure MCP tools: list / create / update / delete for volumes, acts and
 * scenes — the volume → act → chapter → scene spine around the prose.
 *
 * The reads shipped in v1.2.0 and the writes did not, which left the surface
 * lopsided in a way that showed: an MCP client could create chapter 14 but not
 * the act it belongs to. v1.7.0 closes it. Nothing in the product changed —
 * these routes have accepted API keys the whole time.
 *
 * All three list routes return the full set for the book, ordered by
 * orderIndex, with no query params. orderIndex is scoped to the parent (act
 * order restarts per volume, scene order per chapter), so lines carry the
 * parent id rather than a book-wide number.
 *
 * ## Why the two container deletes ask you to count first
 *
 * DELETE on a volume or an act is not a delete of that row. The server walks
 * down and removes the chapters underneath — with their prose — and those
 * chapters' scenes, in one transaction. A volume delete takes the chapters
 * attached to it *and* the chapters under each of its acts.
 *
 * That is the correct product behaviour (a bare delete would orphan chapters
 * into an unreachable state) and a terrible thing to hand an autonomous
 * caller unguarded: "tidy up the empty volume" is one plausible sentence away
 * from destroying a book. So the tool computes the real blast radius first and
 * refuses unless the caller passes that exact number back. A container with
 * nothing under it deletes with no ceremony.
 *
 * Passing a number you were told is not a rubber stamp the way `confirm: true`
 * is — it cannot be satisfied without having seen what dies. Same discipline as
 * update_chapter's baseContentHash: prove you observed the state you are
 * acting on.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare function registerStructureTools(server: McpServer): void;
