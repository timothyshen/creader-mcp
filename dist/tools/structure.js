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
import { z } from "zod";
import { getClient } from "../lib/api-client.js";
import { toolError } from "../lib/errors.js";
/** Chapters the server will destroy along with this volume — its own, plus every act's. */
async function chaptersUnderVolume(client, bookId, volumeId) {
    const [chapters, acts] = await Promise.all([
        client.get(`/api/books/${bookId}/chapters`),
        client.get(`/api/books/${bookId}/acts`),
    ]);
    const actIds = new Set(acts.filter(a => a.volumeId === volumeId).map(a => a.id));
    return chapters.filter(c => c.volumeId === volumeId || (c.actId ? actIds.has(c.actId) : false));
}
async function chaptersUnderAct(client, bookId, actId) {
    const chapters = await client.get(`/api/books/${bookId}/chapters`);
    return chapters.filter(c => c.actId === actId);
}
/**
 * The refusal text for an unconfirmed cascade, or null when it may proceed.
 * Names the chapters rather than only counting them: a caller that has to be
 * told "3" should also be told which three, and a human reading the transcript
 * afterwards can see exactly what was on the table.
 */
function cascadeRefusal(kind, doomed, confirmed) {
    if (doomed.length === 0)
        return null;
    if (confirmed === doomed.length)
        return null;
    const names = doomed
        .slice(0, 10)
        .map(c => `  - ${c.title} (${c.wordCount} words)`)
        .join("\n");
    const more = doomed.length > 10 ? `\n  …and ${doomed.length - 10} more` : "";
    const wrongNumber = confirmed === undefined
        ? ""
        : `You passed confirmChapterCount:${confirmed}, which does not match. `;
    return [
        `Deleting this ${kind} also deletes ${doomed.length} chapter(s) and their prose, permanently:`,
        names + more,
        "",
        `${wrongNumber}To go ahead, call again with confirmChapterCount:${doomed.length}. To keep the prose, move those chapters to another ${kind} first (update_chapter), then delete this one.`,
    ].join("\n");
}
export function registerStructureTools(server) {
    server.tool("list_volumes", "List a book's volumes (top level of the volume → act → chapter → scene hierarchy)", { bookId: z.string().describe("Book ID") }, { readOnlyHint: true, openWorldHint: true }, async ({ bookId }) => {
        try {
            const client = getClient();
            const volumes = await client.get(`/api/books/${bookId}/volumes`);
            const text = volumes.length
                ? volumes
                    .map(v => `${v.orderIndex + 1}. ${v.title} (${v._count?.chapters ?? 0} chapters) id:${v.id}${v.description ? `: ${v.description}` : ""}`)
                    .join("\n")
                : "No volumes found.";
            return { content: [{ type: "text", text }] };
        }
        catch (error) {
            return toolError(error);
        }
    });
    server.tool("list_acts", "List a book's acts. Each act belongs to a volume (or none) and groups chapters.", { bookId: z.string().describe("Book ID") }, { readOnlyHint: true, openWorldHint: true }, async ({ bookId }) => {
        try {
            const client = getClient();
            const acts = await client.get(`/api/books/${bookId}/acts`);
            const text = acts.length
                ? acts
                    .map(a => `- ${a.name} id:${a.id} volume:${a.volumeId ?? "none"} order:${a.orderIndex}${a.description ? `: ${a.description}` : ""}`)
                    .join("\n")
                : "No acts found.";
            return { content: [{ type: "text", text }] };
        }
        catch (error) {
            return toolError(error);
        }
    });
    server.tool("list_scenes", "List a book's scenes. Each scene hangs off a chapter and/or act; order is scoped to that parent.", { bookId: z.string().describe("Book ID") }, { readOnlyHint: true, openWorldHint: true }, async ({ bookId }) => {
        try {
            const client = getClient();
            const scenes = await client.get(`/api/books/${bookId}/scenes`);
            const text = scenes.length
                ? scenes
                    .map(s => `- ${s.title}${s.status ? ` (${s.status})` : ""} id:${s.id} chapter:${s.chapterId ?? "none"} act:${s.actId ?? "none"} order:${s.orderIndex}${s.synopsis ? `: ${s.synopsis}` : ""}`)
                    .join("\n")
                : "No scenes found.";
            return { content: [{ type: "text", text }] };
        }
        catch (error) {
            return toolError(error);
        }
    });
    // ── Volumes ───────────────────────────────────────────────────────
    server.tool("create_volume", "Create a volume — the top level of the spine, holding acts and chapters. Omit orderIndex to append at the end.", {
        bookId: z.string().describe("Book ID"),
        title: z.string().min(1).describe("Volume title"),
        description: z.string().optional(),
        synopsis: z.string().optional(),
        notes: z.string().optional(),
        orderIndex: z.number().int().min(0).optional().describe("Position; omit to append"),
    }, { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, async ({ bookId, ...fields }) => {
        try {
            const client = getClient();
            const volume = await client.post(`/api/books/${bookId}/volumes`, fields);
            return {
                content: [{
                        type: "text",
                        text: `Created volume: ${volume.title} (order ${volume.orderIndex}) id:${volume.id}`,
                    }],
            };
        }
        catch (error) {
            return toolError(error);
        }
    });
    server.tool("update_volume", "Update a volume's fields. Only what you pass changes.", {
        id: z.string().describe("Volume ID"),
        title: z.string().optional(),
        subtitle: z.string().optional(),
        description: z.string().optional(),
        synopsis: z.string().optional(),
        notes: z.string().optional(),
        orderIndex: z.number().int().min(0).optional(),
    }, { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, async ({ id, ...fields }) => {
        try {
            const client = getClient();
            const volume = await client.patch(`/api/volumes/${id}`, fields);
            return {
                content: [{ type: "text", text: `Updated volume: ${volume.title} (id:${volume.id})` }],
            };
        }
        catch (error) {
            return toolError(error);
        }
    });
    server.tool("delete_volume", [
        "Delete a volume. THIS ALSO DELETES the chapters inside it and inside its acts,",
        "with their prose, and those chapters' scenes — permanently, in one transaction.",
        "The tool counts what would die and refuses unless you pass that exact number as",
        "confirmChapterCount; an empty volume deletes with no confirmation. To keep the",
        "prose, move the chapters elsewhere with update_chapter first.",
    ].join(" "), {
        bookId: z.string().describe("Book ID"),
        id: z.string().describe("Volume ID"),
        confirmChapterCount: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe("The number of chapters you accept destroying, as reported by this tool"),
    }, { readOnlyHint: false, destructiveHint: true, openWorldHint: true }, async ({ bookId, id, confirmChapterCount }) => {
        try {
            const client = getClient();
            const doomed = await chaptersUnderVolume(client, bookId, id);
            const refusal = cascadeRefusal("volume", doomed, confirmChapterCount);
            if (refusal)
                return { content: [{ type: "text", text: refusal }], isError: true };
            await client.delete(`/api/volumes/${id}`);
            return {
                content: [{
                        type: "text",
                        text: doomed.length
                            ? `Deleted volume ${id}, along with ${doomed.length} chapter(s) and their scenes.`
                            : `Deleted volume ${id} (it held no chapters).`,
                    }],
            };
        }
        catch (error) {
            return toolError(error);
        }
    });
    // ── Acts ──────────────────────────────────────────────────────────
    server.tool("create_act", "Create an act. Acts are NAMED, not titled. Pass volumeId to put it inside a volume; omit orderIndex to append.", {
        bookId: z.string().describe("Book ID"),
        name: z.string().min(1).describe("Act name"),
        description: z.string().optional(),
        alternateLabel: z.string().optional().describe("Display label, e.g. 'Part One'"),
        volumeId: z.string().optional().describe("Parent volume; omit for a book-level act"),
        orderIndex: z.number().int().min(0).optional().describe("Position; omit to append"),
    }, { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, async ({ bookId, ...fields }) => {
        try {
            const client = getClient();
            const act = await client.post(`/api/books/${bookId}/acts`, fields);
            return {
                content: [{
                        type: "text",
                        text: `Created act: ${act.name} (order ${act.orderIndex}, volume:${act.volumeId ?? "none"}) id:${act.id}`,
                    }],
            };
        }
        catch (error) {
            return toolError(error);
        }
    });
    server.tool("update_act", "Update an act's fields. Pass volumeId:null to detach it from its volume.", {
        id: z.string().describe("Act ID"),
        name: z.string().optional(),
        description: z.string().nullable().optional(),
        alternateLabel: z.string().nullable().optional(),
        volumeId: z.string().nullable().optional(),
        orderIndex: z.number().int().min(0).optional(),
    }, { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, async ({ id, ...fields }) => {
        try {
            const client = getClient();
            const act = await client.patch(`/api/acts/${id}`, fields);
            return {
                content: [{ type: "text", text: `Updated act: ${act.name} (id:${act.id})` }],
            };
        }
        catch (error) {
            return toolError(error);
        }
    });
    server.tool("delete_act", [
        "Delete an act. THIS ALSO DELETES the chapters inside it, with their prose, and",
        "those chapters' scenes — permanently, in one transaction. The tool counts what",
        "would die and refuses unless you pass that exact number as confirmChapterCount;",
        "an empty act deletes with no confirmation. To keep the prose, move the chapters",
        "to another act with update_chapter first.",
    ].join(" "), {
        bookId: z.string().describe("Book ID"),
        id: z.string().describe("Act ID"),
        confirmChapterCount: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe("The number of chapters you accept destroying, as reported by this tool"),
    }, { readOnlyHint: false, destructiveHint: true, openWorldHint: true }, async ({ bookId, id, confirmChapterCount }) => {
        try {
            const client = getClient();
            const doomed = await chaptersUnderAct(client, bookId, id);
            const refusal = cascadeRefusal("act", doomed, confirmChapterCount);
            if (refusal)
                return { content: [{ type: "text", text: refusal }], isError: true };
            await client.delete(`/api/acts/${id}`);
            return {
                content: [{
                        type: "text",
                        text: doomed.length
                            ? `Deleted act ${id}, along with ${doomed.length} chapter(s) and their scenes.`
                            : `Deleted act ${id} (it held no chapters).`,
                    }],
            };
        }
        catch (error) {
            return toolError(error);
        }
    });
    // ── Scenes ────────────────────────────────────────────────────────
    server.tool("create_scene", "Create a scene — a unit of plan inside a chapter and/or act. Link it with chapterId and actId; omit orderIndex to append.", {
        bookId: z.string().describe("Book ID"),
        title: z.string().min(1).max(500).describe("Scene title"),
        synopsis: z.string().max(20_000).optional(),
        chapterId: z.string().optional().describe("Chapter this scene belongs to"),
        actId: z.string().optional().describe("Act this scene belongs to"),
        status: z.string().max(50).optional().describe("e.g. 'draft', 'planned'"),
        beatType: z.string().max(100).optional().describe("Story beat this scene carries"),
        pov: z.string().max(200).optional().describe("Point-of-view character"),
        notes: z.string().max(20_000).optional(),
        characterIds: z.array(z.string()).max(500).optional().describe("Characters present"),
        locationId: z.string().optional().describe("Where it happens"),
        orderIndex: z.number().int().min(0).optional().describe("Position; omit to append"),
    }, { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, async ({ bookId, ...fields }) => {
        try {
            const client = getClient();
            const scene = await client.post(`/api/books/${bookId}/scenes`, fields);
            return {
                content: [{
                        type: "text",
                        text: `Created scene: ${scene.title} (order ${scene.orderIndex}, chapter:${scene.chapterId ?? "none"}) id:${scene.id}`,
                    }],
            };
        }
        catch (error) {
            return toolError(error);
        }
    });
    server.tool("update_scene", "Update a scene's fields. Pass null to clear a link (chapterId, actId, locationId).", {
        id: z.string().describe("Scene ID"),
        title: z.string().max(500).optional(),
        synopsis: z.string().max(20_000).nullable().optional(),
        chapterId: z.string().nullable().optional(),
        actId: z.string().nullable().optional(),
        status: z.string().max(50).optional(),
        beatType: z.string().max(100).nullable().optional(),
        pov: z.string().max(200).nullable().optional(),
        notes: z.string().max(20_000).nullable().optional(),
        characterIds: z.array(z.string()).optional(),
        locationId: z.string().nullable().optional(),
        orderIndex: z.number().int().min(0).optional(),
    }, { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, async ({ id, ...fields }) => {
        try {
            const client = getClient();
            const scene = await client.patch(`/api/scenes/${id}`, fields);
            return {
                content: [{ type: "text", text: `Updated scene: ${scene.title} (id:${scene.id})` }],
            };
        }
        catch (error) {
            return toolError(error);
        }
    });
    server.tool("delete_scene", "Delete a scene. Permanent, but it takes nothing with it — a scene is a plan record, and the chapter's prose is untouched.", { id: z.string().describe("Scene ID") }, { readOnlyHint: false, destructiveHint: true, openWorldHint: true }, async ({ id }) => {
        try {
            const client = getClient();
            await client.delete(`/api/scenes/${id}`);
            return { content: [{ type: "text", text: `Deleted scene ${id}.` }] };
        }
        catch (error) {
            return toolError(error);
        }
    });
}
