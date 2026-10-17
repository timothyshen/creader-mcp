/**
 * AI MCP tools: generate_outline, guardian_check, vector_check, orchestrate
 *
 * `guardian_check` replaces the three tools that fronted the pre-v0.13
 * Guardian routes (consistency_check / analyze_book / proofread). Those
 * routes were deleted from the product on 2026-05-01 and collapsed into one
 * 5-layer dispatcher, so all three had been returning 404 to every caller
 * for months. One dispatcher route, one tool.
 *
 * `extract_facts` is gone for the same reason, one version later: the product
 * retired the whole fact-delta chain on 2026-08-27 (route, trigger, hook,
 * component, store slice) as work nothing reached, so the tool's only endpoint
 * stopped existing. Entity discovery from prose lives on as
 * POST /api/books/:bookId/entity-candidates, which proposes *new* entities and
 * field updates into a review queue — a different contract, not a rename, so it
 * gets its own tool when it gets one rather than inheriting this name.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GuardianRunResponse } from "../lib/types.js";
export declare function registerAITools(server: McpServer): void;
/**
 * Project the dispatcher's response down to what a caller can act on.
 *
 * `issues` is the payload. The per-layer roll-up is not decoration: a
 * detector that errored, or a layer that only analysed a prefix of the
 * chapter, means the coverage is narrower than the empty issue list implies —
 * reporting "no issues" while hiding that would be a lie. Everything dropped
 * (per-detector wall-clock timings) is product-UI telemetry.
 */
export declare function summarizeGuardianRun(result: GuardianRunResponse): {
    durationMs: number;
    traceId: string;
    tokensSpent: number;
    techniques?: unknown[] | undefined;
    deferredLayers?: import("../lib/types.js").NarrativeLayer[] | undefined;
    issues: import("../lib/types.js").GuardianIssue[];
    layers: {
        truncation?: {
            analyzedChars: number;
            totalChars: number;
        } | undefined;
        errors?: {
            detectorId: string;
            message: string;
        }[] | undefined;
        layer: import("../lib/types.js").NarrativeLayer;
        issueCount: number;
    }[];
};
