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
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare function registerKnowledgeTools(server: McpServer): void;
