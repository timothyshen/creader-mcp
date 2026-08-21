/**
 * AI MCP tools: generate_outline, guardian_check, vector_check,
 * extract_facts, orchestrate
 *
 * `guardian_check` replaces the three tools that fronted the pre-v0.13
 * Guardian routes (consistency_check / analyze_book / proofread). Those
 * routes were deleted from the product on 2026-05-01 and collapsed into one
 * 5-layer dispatcher, so all three had been returning 404 to every caller
 * for months. One dispatcher route, one tool.
 */
import { z } from "zod";
import { getClient } from "../lib/api-client.js";
import { toolError } from "../lib/errors.js";
import { stripHtmlForPositions } from "../lib/html-text.js";
/** Server-side zod cap on both plainContent and htmlContent. */
const MAX_CONTENT_CHARS = 200_000;
// Server-side zod bounds on /api/ai/extract-facts.
const EXTRACT_MIN_CHARS = 200;
const EXTRACT_MAX_CHARS = 100_000;
const SNAPSHOT_MAX_ENTITIES = 200;
const SNAPSHOT_MAX_CONTENT = 500;
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
    }, { readOnlyHint: true, openWorldHint: true }, async ({ bookId, chapterId, layers, costBudget, locale }) => {
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
            return {
                content: [
                    { type: "text", text: JSON.stringify(summarize(result), null, 2) },
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
    server.tool("extract_facts", [
        "Extract PROPOSED knowledge-base updates from one chapter's prose: status changes,",
        "new details, and relationship changes to entities that already exist in the book.",
        "It does not discover new entities and does not write anything — every proposal",
        "comes back status:'pending' with its text evidence. Apply the ones you accept via",
        "update_character / update_location / update_event / update_note.",
        "Spends AI token quota and needs an API key with the 'ai' scope.",
        "The server analyses at most the first ~15,000 characters of the chapter (the",
        "reply's `truncated` flag says when that happened) and requires at least 200.",
    ].join(" "), {
        bookId: z.string().describe("Book ID"),
        chapterId: z.string().describe("Chapter whose prose to extract from"),
    }, { readOnlyHint: true, openWorldHint: true }, async ({ bookId, chapterId }) => {
        try {
            const client = getClient();
            const chapter = await client.get(`/api/chapters/${chapterId}`);
            const plain = stripHtmlForPositions(chapter.content || "");
            if (plain.length < EXTRACT_MIN_CHARS) {
                return toolError(new Error(`Chapter has ${plain.length} characters of prose; extract-facts requires at least ${EXTRACT_MIN_CHARS}.`));
            }
            // The route detects changes to entities it is TOLD about, so the
            // snapshot is the whole point of the call. Built here rather than
            // asked of the caller — same batched-read approach as get_book_context.
            const [characters, locations, events, notes] = await Promise.all([
                client.get(`/api/books/${bookId}/characters`),
                client.get(`/api/books/${bookId}/locations`),
                client.get(`/api/books/${bookId}/timeline-events`),
                client.get(`/api/books/${bookId}/notes`),
            ]);
            const snapshot = (id, title, type, content, metadata) => ({
                id,
                title,
                type,
                content: (content || "").slice(0, SNAPSHOT_MAX_CONTENT),
                ...(metadata ? { metadata } : {}),
            });
            const entities = [
                ...characters.map(c => snapshot(c.id, c.name, "character", c.description, c.role ? { role: c.role } : undefined)),
                ...locations.map(l => snapshot(l.id, l.name, "location", l.description, l.type ? { locationType: l.type } : undefined)),
                ...events.map(e => snapshot(e.id, e.title, "event", [e.description, e.consequences].filter(Boolean).join(" — "))),
                ...notes.map(n => snapshot(n.id, n.title, "note", n.content)),
            ];
            if (!entities.length) {
                return toolError(new Error("The book has no knowledge entities yet — extract_facts reports changes to entities that already exist. Create characters/locations/events/notes first."));
            }
            const capped = entities.slice(0, SNAPSHOT_MAX_ENTITIES);
            const response = await client.postRaw("/api/ai/extract-facts", {
                bookId,
                chapterId,
                chapterContent: plain.slice(0, EXTRACT_MAX_CHARS),
                existingEntities: capped,
            });
            const caveats = [];
            if (response.result?.truncated) {
                caveats.push("note: the server analysed only the first ~15,000 characters of this chapter");
            }
            if (entities.length > capped.length) {
                caveats.push(`note: entity snapshot capped at ${SNAPSHOT_MAX_ENTITIES} of ${entities.length} entities — proposals for the rest cannot appear`);
            }
            return {
                content: [{
                        type: "text",
                        text: [JSON.stringify(response.result, null, 2), ...caveats].join("\n"),
                    }],
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
