/**
 * Entity review MCP tools: extract_entity_candidates, list_entity_candidates,
 * triage_entity_candidate, list_entity_facts, triage_entity_fact
 *
 * The honest successor to `extract_facts`, which called a route the product
 * deleted on 2026-08-27 and was removed in v1.4.0. This is not that tool
 * renamed. `extract_facts` proposed a fact delta and handed it back; nothing
 * was stored and the caller applied what it liked with update_* tools. What
 * replaced it is a REVIEW QUEUE the writer owns: extraction persists proposals
 * as PENDING rows, and a human — or a tool acting for one — accepts or
 * dismisses each. Nothing enters the world unreviewed.
 *
 * ## One extraction call, two queues
 *
 * `POST /entity-candidates` runs two LLM legs concurrently and bills both:
 *
 *   discovery  → EntityCandidate rows. NEW entities the prose mentions and the
 *                knowledge base does not have. Read with list_entity_candidates.
 *   maintain   → EntityFact rows. Field-level facts about entities that ALREADY
 *                exist. Read with list_entity_facts. Only runs for a chapter,
 *                on long-enough prose, on a tier that has entityMaintain.
 *
 * Both are paid for by one call, so both get tools. Shipping only the candidate
 * half would bill the writer for output no client could see — the same "half a
 * feature reachable" shape that kept Guardian findings out of the editor until
 * v1.5.0.
 *
 * ## Accepting is not the same act in the two queues
 *
 * Accepting a CANDIDATE confirms a draft Character/Location/Event row that
 * extraction already materialized in the background; dismissing deletes it.
 * Accepting a FACT appends to a fact log the AI context reads — it does NOT
 * rewrite the author's entity card. Nothing the writer typed is ever touched by
 * either path. Both dismissals are permanent by design: the row is kept so the
 * same name or statement is never proposed again.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare function registerEntityReviewTools(server: McpServer): void;
