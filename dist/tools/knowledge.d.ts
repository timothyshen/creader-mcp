/**
 * Knowledge base MCP tools: search, list_knowledge, CRUD for character/location/event/note
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
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare function registerKnowledgeTools(server: McpServer): void;
