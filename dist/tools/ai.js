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
import { z } from "zod";
import { getClient } from "../lib/api-client.js";
import { toolError } from "../lib/errors.js";
import { stripHtmlForPositions } from "../lib/html-text.js";
/** Server-side zod cap on both plainContent and htmlContent. */
const MAX_CONTENT_CHARS = 200_000;
/** Server-side zod cap on one POST to /guardian/issues. */
const MAX_PERSISTED_ISSUES = 200;
export function registerAITools(server) {
    server.tool("generate_outline", "Generate a story outline based on a premise. Returns structured chapter suggestions.", {
        title: z.string().describe("Book/story title"),
        premise: z.string().describe("Story premise or synopsis"),
        genre: z.string().optional().describe("Genre"),
        chapterCount: z
            .number()
            .optional()
            .describe("Target number of chapters (default: 10)"),
    }, { readOnlyHint: true, openWorldHint: true }, async ({ title, premise, genre, chapterCount }) => {
        try {
            const client = getClient();
            const outline = await client.post("/api/onboarding/generate-outline", {
                title,
                description: premise,
                genre,
                chapterCount: chapterCount || 10,
            });
            return {
                content: [{ type: "text", text: JSON.stringify(outline, null, 2) }],
            };
        }
        catch (error) {
            return toolError(error);
        }
    });
    server.tool("guardian_check", [
        "Run Creader's Guardian over ONE chapter. Guardian is a 5-layer narrative model;",
        "pick layers and a cost budget rather than a preset check.",
        "Layers: 1=Consistency (dead characters, name typos, timeline/entity contradictions),",
        "2=Style & Prose (cliche, weak verbs, dialogue tags, POV leak, proofreading),",
        "3=Analysis (character arcs, causal chains, literary quality),",
        "4=Chapter & Suspense (opening quality, suspense, thread coverage, cliffhangers),",
        "5=Plot Structure (three-act shape, inciting incident, midpoint, foreshadowing).",
        "Omit `layers` to run all five.",
        "costBudget is an inclusive ceiling on detector cost and defaults to 'local':",
        "'local' makes NO model calls, spends no token quota, and is the right default —",
        "but it only reaches the rule-based detectors, so layer 3 returns nothing under it",
        "and layers 1/2/4/5 return only their local subset (this includes cliche and",
        "repetition, but NOT proofreading or POV leak, which are model detectors).",
        "Use 'api-heavy' for a full pass: it spends the owner's token quota and needs an",
        "API key with the 'ai' scope. Findings carry char-offset textPosition into the",
        "chapter's plain text; layer-2 proofreading findings also carry suggestedFix.",
        "By default the findings are also SAVED to the book, which is what makes them",
        "appear in the author's Guardian panel and count toward Story Health; pass",
        "persist:false for a look that leaves no trace. Saving needs the 'write' scope,",
        "and a run is never discarded because the save failed.",
    ].join(" "), {
        bookId: z.string().describe("Book ID"),
        chapterId: z.string().describe("Chapter ID to check"),
        layers: z
            .array(z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]))
            .optional()
            .describe("Which narrative layers to run. Omit for all five."),
        costBudget: z
            .enum(["local", "api-light", "vector", "api-heavy"])
            .optional()
            .describe("Inclusive cost ceiling. Default 'local' (free, no model calls). 'api-heavy' spends token quota."),
        locale: z
            .enum(["en", "en-GB", "zh"])
            .optional()
            .describe("Language of the prose. Defaults to the account locale."),
        persist: z
            .boolean()
            .optional()
            .describe("Save the findings to the book so the author sees them in the Guardian panel. Default true."),
    }, 
    // Not read-only: the default path writes GuardianIssue rows. That default is
    // deliberate — a check whose findings evaporate is the exact failure this
    // tool shipped with for months, back when the persist route refused API keys.
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, async ({ bookId, chapterId, layers, costBudget, locale, persist }) => {
        try {
            const client = getClient();
            // The dispatcher scores offsets into plain text, so it wants the prose
            // stripped the same way the editor strips it — not the Tiptap HTML the
            // chapter is stored as.
            const chapter = await client.get(`/api/chapters/${chapterId}`);
            const html = chapter.content || "";
            const plainContent = stripHtmlForPositions(html);
            if (!plainContent.trim()) {
                return toolError(new Error("Chapter has no content to check"));
            }
            if (plainContent.length > MAX_CONTENT_CHARS) {
                return toolError(new Error(`Chapter is ${plainContent.length} characters; the Guardian endpoint accepts at most ${MAX_CONTENT_CHARS}. Split the chapter and check the parts separately.`));
            }
            const result = await client.postRaw(`/api/books/${bookId}/guardian/run`, {
                chapterId,
                plainContent,
                // Optional, and capped separately — omit rather than 400 the whole
                // run when the markup alone blows the limit.
                ...(html.length <= MAX_CONTENT_CHARS ? { htmlContent: html } : {}),
                ...(layers && layers.length ? { layers } : {}),
                costBudget: costBudget ?? "local",
                ...(locale ? { locale } : {}),
                // An MCP call is always an explicit ask, never a keystroke pass —
                // "manual" is what lifts the automatic-trigger detector filter.
                trigger: "manual",
            });
            const saved = persist === false
                ? { persisted: false, reason: "persist:false was requested" }
                : await persistIssues(client, bookId, chapterId, result.issues ?? []);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ ...summarize(result), saved }, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            return toolError(error);
        }
    });
    server.tool("vector_check", "Run vector-based conflict detection across a book. Finds semantic duplicates, character contradictions, timeline inconsistencies, and location mismatches using embeddings. Does not require chapter input — operates on already-indexed content.", {
        bookId: z.string().describe("Book ID"),
        changedSourceId: z
            .string()
            .optional()
            .describe("If provided, restrict check to content related to this source"),
        sourceTypes: z
            .array(z.string())
            .optional()
            .describe("Optional filter: e.g. ['character', 'location', 'chapter']"),
    }, { readOnlyHint: true, openWorldHint: true }, async ({ bookId, changedSourceId, sourceTypes }) => {
        try {
            const client = getClient();
            // vector-check returns raw JSON (no ApiResponse envelope) — use postRaw.
            const result = await client.postRaw(`/api/books/${bookId}/guardian/vector-check`, { changedSourceId, sourceTypes });
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
        }
        catch (error) {
            return toolError(error);
        }
    });
    server.tool("list_guardian_issues", [
        "List the Guardian issues currently OPEN on a book — the same notes the author",
        "sees in the Guardian panel. These persist across runs and across clients, so",
        "this is how you find out what a previous check (yours or the author's own)",
        "already flagged before spending quota on another pass.",
        "Each issue carries a `fingerprint`; pass that to resolve_guardian_issue.",
    ].join(" "), {
        bookId: z.string().describe("Book ID"),
        chapterId: z.string().optional().describe("Narrow to one chapter"),
    }, { readOnlyHint: true, openWorldHint: true }, async ({ bookId, chapterId }) => {
        try {
            const client = getClient();
            // Both branches spell the path out in full rather than concatenating a
            // suffix onto a shared base. creader_editor's satellite-drift checker
            // reads route literals straight out of this file, and an interpolation
            // glued to the end of a path reaches it as a phantom extra segment —
            // reported as a dead route that was never dead. (It reads comments too,
            // which is why this one names no path.)
            const path = chapterId
                ? `/api/books/${bookId}/guardian/issues?chapterId=${encodeURIComponent(chapterId)}`
                : `/api/books/${bookId}/guardian/issues`;
            const { issues } = await client.get(path);
            if (!issues.length) {
                return {
                    content: [{ type: "text", text: "No open Guardian issues." }],
                };
            }
            return {
                content: [{ type: "text", text: JSON.stringify(issues, null, 2) }],
            };
        }
        catch (error) {
            return toolError(error);
        }
    });
    server.tool("resolve_guardian_issue", [
        "Close a Guardian issue, or reopen one. RESOLVED means the prose was fixed;",
        "DISMISSED means the note was wrong, and also feeds detector confidence so the",
        "same false positive is less likely next time — so dismiss deliberately, not to",
        "tidy up. Addressed by `fingerprint` (from list_guardian_issues or a",
        "guardian_check run), because that is the key that survives a re-run.",
        "Only the issue's own author may transition it.",
    ].join(" "), {
        bookId: z.string().describe("Book ID"),
        fingerprint: z.string().describe("Issue fingerprint"),
        status: z.enum(["OPEN", "RESOLVED", "DISMISSED"]),
    }, { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, async ({ bookId, fingerprint, status }) => {
        try {
            const client = getClient();
            const { issue } = await client.patch(`/api/books/${bookId}/guardian/issues`, { fingerprint, status });
            return {
                content: [
                    { type: "text", text: `Issue ${issue.fingerprint} → ${issue.status}` },
                ],
            };
        }
        catch (error) {
            return toolError(error);
        }
    });
    server.tool("orchestrate", [
        "Turn a writing intent into a structured generation plan: a 2–6 scene breakdown",
        "(purpose, required entities, emotional beat), consistency constraints, style",
        "directives, a word target, and a creative prompt. This is the planning half of",
        "Creader's two-stage generation — use the plan to structure your own drafting,",
        "then write the prose with update_chapter.",
        "Pass bookId to ground the plan in the book's characters and locations.",
        "Spends AI token quota and needs an API key with the 'ai' scope.",
    ].join(" "), {
        intent: z.string().min(1).max(2000).describe("What the passage should accomplish"),
        outline: z.string().max(10_000).optional().describe("Optional outline or beats to honour"),
        bookId: z
            .string()
            .optional()
            .describe("If set, the book's characters and locations are sent as planning context"),
    }, { readOnlyHint: true, openWorldHint: true }, async ({ intent, outline, bookId }) => {
        try {
            const client = getClient();
            let contextPacket;
            if (bookId) {
                const [characters, locations] = await Promise.all([
                    client.get(`/api/books/${bookId}/characters`),
                    client.get(`/api/books/${bookId}/locations`),
                ]);
                // The server JSON-stringifies this and keeps only the first 1,000
                // characters — send names and roles, not descriptions.
                const entities = [
                    ...characters.map(c => ({
                        name: c.name,
                        type: "character",
                        ...(c.role ? { role: c.role } : {}),
                    })),
                    ...locations.map(l => ({ name: l.name, type: "location" })),
                ];
                if (entities.length)
                    contextPacket = { entities };
            }
            const response = await client.postRaw("/api/ai/orchestrate", {
                intent,
                // Required by the route's schema, so an omitted outline goes as "".
                outline: outline ?? "",
                ...(contextPacket ? { contextPacket } : {}),
            });
            return {
                content: [{ type: "text", text: JSON.stringify(response.plan, null, 2) }],
            };
        }
        catch (error) {
            return toolError(error);
        }
    });
}
/**
 * Project the dispatcher's response down to what a caller can act on.
 *
 * `issues` is the payload. The per-layer roll-up is not decoration: a
 * detector that errored, or a layer that only analysed a prefix of the
 * chapter, means the coverage is narrower than the empty issue list implies —
 * reporting "no issues" while hiding that would be a lie. Everything dropped
 * (per-detector wall-clock timings) is product-UI telemetry.
 */
/**
 * Save a run's findings so they reach the author's Guardian panel.
 *
 * Never throws. The run has already happened and, on an api-heavy budget, has
 * already been billed — losing all of it because the key lacks `write`, or
 * because the caller is an org contributor who may read but not write the book,
 * would be the worst possible trade. The failure is reported alongside the
 * findings instead, which the caller still has in full.
 */
async function persistIssues(client, bookId, chapterId, issues) {
    if (!issues.length)
        return { persisted: true, count: 0 };
    const batch = issues.slice(0, MAX_PERSISTED_ISSUES);
    try {
        const result = await client.post(`/api/books/${bookId}/guardian/issues`, {
            chapterId,
            issues: batch.map((i) => ({
                id: i.id,
                fingerprint: i.fingerprint,
                title: i.title,
                severity: i.severity,
                ...(i.category ? { category: i.category } : {}),
                ...(i.confidence ? { confidence: i.confidence } : {}),
                ...(i.chapterId ? { chapterId: i.chapterId } : {}),
                ...(i.suggestedFix ? { suggestedFix: i.suggestedFix } : {}),
                ...(i.textPosition ? { textPosition: i.textPosition } : {}),
            })),
        });
        return {
            persisted: true,
            count: result.upsertedCount,
            ...(issues.length > batch.length ? { capped: issues.length - batch.length } : {}),
        };
    }
    catch (error) {
        return {
            persisted: false,
            reason: error instanceof Error ? error.message : String(error),
        };
    }
}
function summarize(result) {
    return {
        issues: result.issues ?? [],
        layers: (result.reports ?? []).map((r) => ({
            layer: r.layer,
            issueCount: r.issues?.length ?? 0,
            ...(r.errors && r.errors.length ? { errors: r.errors } : {}),
            ...(r.truncation ? { truncation: r.truncation } : {}),
        })),
        ...(result.techniques && result.techniques.length
            ? { techniques: result.techniques }
            : {}),
        durationMs: result.durationMs,
        traceId: result.traceId,
        tokensSpent: result.usage?.totalTokens ?? 0,
    };
}
