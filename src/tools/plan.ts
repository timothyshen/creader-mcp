/**
 * Plan MCP tools: get_plan_spine, list_plot_nodes, create_plot_node,
 * update_plot_node, delete_plot_node, reorder_plot_nodes, create_plan_thread,
 * apply_structure_template
 *
 * The plan is how a book is DESIGNED before it is written: volumes → acts →
 * chapters → scenes, with beats (PlotNode) hanging off chapters and subplot
 * threads (PlanThread) hanging off volumes. Until now the MCP could create
 * chapter 14 without being able to see which act it landed in or which beat it
 * was meant to carry.
 *
 * ## Why get_plan_spine re-projects instead of forwarding the payload
 *
 * `/plan-spine` includes whole Chapter rows, and a Chapter row carries
 * `content` — the entire prose of the chapter. That is fine for editor-v2,
 * which caches it and is already holding the manuscript. Forwarding it to a
 * model would spend a book's worth of context to answer "what is the shape of
 * this book", and would do it every call. So the tree is walked here and only
 * the structural fields survive. Prose has its own doors: get_chapter and
 * search_book.
 *
 * ## What is deliberately absent
 *
 * `POST /plan/generate-beats` asks a model to invent beats and hands back a
 * draft for the client to materialize. The MCP client IS a model — billing
 * Creader's quota so a second one can draft bullet points is worse output at
 * double the price. Write the beats, then call create_plot_node. Same rule
 * that keeps the nine prose-generation routes unwrapped. (Naming their path
 * prefix here would reach the satellite-drift checker as a dead route: it
 * reads route literals out of this file, comments included.)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { getClient } from "../lib/api-client.js"
import { toolError } from "../lib/errors.js"
import type {
  ApplyTemplateResult,
  PlanSpineResponse,
  PlanThread,
  PlotNode,
  SpineChapter,
} from "../lib/types.js"

/** Server-side zod caps, mirrored so a bad batch fails here, not after a round trip. */
const MAX_REORDER_NODES = 200
const MAX_THREAD_IDS = 20
const MAX_EVENT_IDS = 50

/** Structural fields only — never `content`. See the file header. */
function compactChapter(c: SpineChapter) {
  return {
    id: c.id,
    title: c.title,
    orderIndex: c.orderIndex,
    ...(c.status ? { status: c.status } : {}),
    wordCount: c.wordCount ?? 0,
    scenes: (c.scenes ?? []).map((s) => ({
      id: s.id,
      title: s.title,
      orderIndex: s.orderIndex,
      ...(s.status ? { status: s.status } : {}),
    })),
    beats: (c.plotNodes ?? []).map((n) => ({
      id: n.id,
      order: n.order,
      summary: n.summary,
      ...(n.sceneNum ? { sceneNum: n.sceneNum } : {}),
      ...(n.setupId ? { setsUpMarker: n.setupId } : {}),
      ...(n.eventIds?.length ? { eventIds: n.eventIds } : {}),
      threadIds: (n.threads ?? []).map((t) => t.threadId),
    })),
  }
}

export function registerPlanTools(server: McpServer) {
  server.tool(
    "get_plan_spine",
    [
      "Read the whole plan of a book in one call: volumes → acts → chapters → scenes,",
      "with each chapter's beats and each volume's subplot threads. This is the book as",
      "DESIGNED — use it before adding or moving anything, so a new chapter lands in the",
      "right act and a new beat carries the right thread.",
      "Structure only: chapter prose is deliberately not included (get_chapter reads a",
      "chapter, search_book searches all of them).",
      "Chapters written without a place in the hierarchy come back under",
      "unassignedChapters rather than being hidden.",
    ].join(" "),
    { bookId: z.string().describe("Book ID") },
    { readOnlyHint: true, openWorldHint: true },
    async ({ bookId }) => {
      try {
        const client = getClient()
        const spine = await client.get<PlanSpineResponse>(
          `/api/books/${bookId}/plan-spine`
        )
        const volumes = (spine.volumes ?? []).map((v) => ({
          id: v.id,
          title: v.title,
          orderIndex: v.orderIndex,
          threads: (v.threads ?? []).map((t) => ({
            id: t.id,
            name: t.name,
            ...(t.short ? { short: t.short } : {}),
            color: t.color,
            orderIndex: t.orderIndex,
          })),
          acts: (v.acts ?? []).map((a) => ({
            id: a.id,
            name: a.name,
            orderIndex: a.orderIndex,
            chapters: (a.chapters ?? []).map(compactChapter),
          })),
        }))
        const unassignedChapters = (spine.unassignedChapters ?? []).map(compactChapter)

        if (!volumes.length && !unassignedChapters.length) {
          return {
            content: [{
              type: "text" as const,
              text: "This book has no plan yet — no volumes, acts or unassigned chapters. apply_structure_template lays down a skeleton, or create_volume / create_act / create_chapter build one by hand.",
            }],
          }
        }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ volumes, unassignedChapters }, null, 2),
          }],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "list_plot_nodes",
    [
      "List every beat in a book, flat and ordered by chapter then position — the same",
      "beats get_plan_spine nests under their chapters. Use this when you want to scan or",
      "search beats across the whole book rather than read the tree.",
    ].join(" "),
    { bookId: z.string().describe("Book ID") },
    { readOnlyHint: true, openWorldHint: true },
    async ({ bookId }) => {
      try {
        const client = getClient()
        const nodes = await client.get<PlotNode[]>(`/api/books/${bookId}/plot-nodes`)
        if (!nodes.length) {
          return { content: [{ type: "text" as const, text: "No beats in this book yet." }] }
        }
        const text = nodes
          .map((n) => {
            const threads = (n.threads ?? []).map((t) => t.threadId)
            return (
              `- [${n.order}] ${n.summary}` +
              ` — chapterId:${n.chapterId} id:${n.id}` +
              (n.sceneNum ? ` scene:${n.sceneNum}` : "") +
              (threads.length ? ` threads:${threads.join(",")}` : "") +
              (n.setupId ? ` setsUp:${n.setupId}` : "")
            )
          })
          .join("\n")
        return { content: [{ type: "text" as const, text }] }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "create_plot_node",
    [
      "Add a beat to a chapter — one thing that happens, in one sentence.",
      "Omit `order` and it appends after the chapter's last beat.",
      "`threadIds` attaches the beat to subplot threads (their ids come from",
      "get_plan_spine, per volume); `setupId` records that this beat PLANTS a",
      "foreshadowing setup, so it must be a setup marker and never a payoff.",
    ].join(" "),
    {
      bookId: z.string().describe("Book ID"),
      chapterId: z.string().describe("Chapter this beat belongs to"),
      summary: z.string().min(1).describe("What happens, in one sentence"),
      order: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Position within the chapter. Omit to append."),
      sceneNum: z.string().optional().describe("Anchored scene key, if the beat maps to one"),
      setupId: z
        .string()
        .optional()
        .describe("Foreshadowing marker this beat plants. Must be kind 'setup'."),
      eventIds: z.array(z.string()).max(MAX_EVENT_IDS).optional(),
      threadIds: z.array(z.string().min(1)).max(MAX_THREAD_IDS).optional(),
    },
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ bookId, ...body }) => {
      try {
        const client = getClient()
        const node = await client.post<PlotNode>(`/api/books/${bookId}/plot-nodes`, body)
        return {
          content: [{
            type: "text" as const,
            text: `Created beat at position ${node.order} of chapter ${node.chapterId} (id:${node.id})`,
          }],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "update_plot_node",
    [
      "Change a beat: its wording, its position, the threads it belongs to, or the chapter",
      "it sits in. `threadIds` REPLACES the beat's thread set rather than adding to it —",
      "send the full list, and send [] to detach it from every thread.",
    ].join(" "),
    {
      id: z.string().describe("Beat (plot node) ID"),
      summary: z.string().min(1).optional(),
      order: z.number().int().nonnegative().optional(),
      chapterId: z.string().optional().describe("Move the beat to another chapter"),
      sceneNum: z.string().nullable().optional(),
      setupId: z.string().nullable().optional().describe("Must be a 'setup' marker; null clears"),
      eventIds: z.array(z.string()).max(MAX_EVENT_IDS).optional(),
      threadIds: z
        .array(z.string().min(1))
        .max(MAX_THREAD_IDS)
        .optional()
        .describe("Replaces the whole set. [] detaches from all threads."),
    },
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ id, ...fields }) => {
      try {
        const client = getClient()
        const node = await client.patch<PlotNode>(`/api/plot-nodes/${id}`, fields)
        return {
          content: [{
            type: "text" as const,
            text: `Updated beat (id:${node.id}) at position ${node.order} of chapter ${node.chapterId}`,
          }],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "delete_plot_node",
    "Delete a beat. Removes the plan entry only — the chapter and its prose are untouched.",
    { id: z.string().describe("Beat (plot node) ID") },
    { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async ({ id }) => {
      try {
        const client = getClient()
        await client.delete(`/api/plot-nodes/${id}`)
        return { content: [{ type: "text" as const, text: `Deleted beat ${id}` }] }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "reorder_plot_nodes",
    [
      "Set the position of many beats in one call. Unlike reorder_chapters — which the",
      "server has no batch route for, so it walks chapter by chapter and can stop half",
      "way — this is a single transaction: every id is checked before anything is",
      "written, and one unreachable id rejects the whole batch without moving a beat.",
      "Send only the beats whose position changes; ids may span chapters.",
    ].join(" "),
    {
      nodes: z
        .array(
          z.object({
            id: z.string().min(1),
            order: z.number().int().nonnegative(),
          })
        )
        .max(MAX_REORDER_NODES)
        .describe("Beats and their new positions"),
    },
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ nodes }) => {
      try {
        if (!nodes.length) {
          return { content: [{ type: "text" as const, text: "No beats given; nothing to do." }] }
        }
        const client = getClient()
        const result = await client.post<{ updated: number }>(
          "/api/plot-nodes/reorder",
          { nodes }
        )
        return {
          content: [{
            type: "text" as const,
            text: `Reordered ${result.updated} beat${result.updated === 1 ? "" : "s"}.`,
          }],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "create_plan_thread",
    [
      "Create a subplot thread on a volume — the axis a beat is attached to via",
      "create_plot_node's threadIds, and the column a Plan grid renders. Threads are read",
      "back through get_plan_spine, nested under their volume.",
      "`color` is a CSS color and is required: the grid uses it as the column accent.",
    ].join(" "),
    {
      volumeId: z.string().describe("Volume the thread belongs to"),
      name: z.string().min(1).describe("Thread name, e.g. 'Mira and the letter'"),
      short: z.string().optional().describe("Short label for the grid header; defaults to name"),
      color: z.string().min(1).describe("CSS color, e.g. '#C47F5E'"),
      orderIndex: z.number().int().nonnegative().optional(),
    },
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ volumeId, ...body }) => {
      try {
        const client = getClient()
        const thread = await client.post<PlanThread>(
          `/api/volumes/${volumeId}/threads`,
          body
        )
        return {
          content: [{
            type: "text" as const,
            text: `Created thread: ${thread.name} (id:${thread.id})`,
          }],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "apply_structure_template",
    [
      "Lay down a story-structure skeleton — acts and placeholder chapters — in one",
      "atomic step, for a book whose plan is still empty.",
      "It will not overwrite work: if the spine already has content the template is",
      "recorded as a declaration only and nothing is created (the reply says which",
      "happened). 'none' declares free-form and creates nothing.",
    ].join(" "),
    {
      bookId: z.string().describe("Book ID"),
      templateId: z
        .enum(["three-act", "heros-journey", "save-the-cat", "none"])
        .describe("Which structure to lay down"),
    },
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ bookId, templateId }) => {
      try {
        const client = getClient()
        const result = await client.post<ApplyTemplateResult>(
          `/api/books/${bookId}/structure-template`,
          { templateId }
        )
        const text = result.declaredOnly
          ? `Recorded ${result.templateId} as this book's structure. Nothing was created — the plan already has content, and a template never overwrites it.`
          : `Applied ${result.templateId}: created ${result.acts} act${result.acts === 1 ? "" : "s"} and ${result.chapters} chapter${result.chapters === 1 ? "" : "s"}.`
        return { content: [{ type: "text" as const, text }] }
      } catch (error) {
        return toolError(error)
      }
    }
  )
}
