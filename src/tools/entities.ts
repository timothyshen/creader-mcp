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

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { getClient } from "../lib/api-client.js"
import { toolError } from "../lib/errors.js"
import { stripHtmlForPositions } from "../lib/html-text.js"
import type { Chapter, EntityCandidate, EntityFact } from "../lib/types.js"

/** The server slices prose to this before either leg sees it. */
const EXTRACTION_CHAR_LIMIT = 24_000

function formatCandidates(candidates: EntityCandidate[]): string {
  return candidates
    .map(
      (c) =>
        `- [${c.type}] ${c.name}` +
        (c.descriptionGuess ? ` — ${c.descriptionGuess}` : "") +
        ` (id:${c.id}${c.chapterId ? ` chapter:${c.chapterId}` : ""})`
    )
    .join("\n")
}

export function registerEntityReviewTools(server: McpServer) {
  server.tool(
    "extract_entity_candidates",
    [
      "Read a chapter and propose knowledge-base work from its prose: entities the",
      "chapter mentions that the book does not have yet, and — for a long enough chapter",
      "on a plan with Entity Check — new facts about entities it already has.",
      "Nothing is confirmed. Everything lands in a review queue for the writer, which you",
      "can read with list_entity_candidates and list_entity_facts and act on with the",
      "triage tools.",
      "Spends the owner's token quota (both legs) and needs an API key with the 'ai' scope.",
      "The reply lists everything currently pending on the book, not only what this run",
      "found.",
    ].join(" "),
    {
      bookId: z.string().describe("Book ID"),
      chapterId: z
        .string()
        .describe(
          "Chapter to read. Required for the maintain leg — a fact with no chapter has no place in time."
        ),
    },
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ bookId, chapterId }) => {
      try {
        const client = getClient()
        const chapter = await client.get<Chapter>(`/api/chapters/${chapterId}`)
        const content = stripHtmlForPositions(chapter.content || "")
        if (!content.trim()) {
          return toolError(new Error("Chapter has no prose to extract from"))
        }

        const { candidates } = await client.post<{ candidates: EntityCandidate[] }>(
          `/api/books/${bookId}/entity-candidates`,
          { chapterId, content }
        )

        const notes: string[] = []
        if (content.length > EXTRACTION_CHAR_LIMIT) {
          // The server slices and says nothing. Silence here would read as
          // "the whole chapter was examined", and an entity introduced in the
          // tail would look like one the extractor judged unworthy.
          notes.push(
            `note: the chapter is ${content.length} characters and only the first ${EXTRACTION_CHAR_LIMIT} were examined — anything introduced after that was not seen`
          )
        }
        notes.push(
          "note: facts about entities that already exist land in a separate queue — read it with list_entity_facts"
        )

        const header = candidates.length
          ? `${candidates.length} entity candidate${candidates.length === 1 ? "" : "s"} pending review (everything pending on this book, not only this run):`
          : "No entity candidates pending. Either the chapter introduced nothing new, or every name in it is already known or already triaged."

        return {
          content: [{
            type: "text" as const,
            text: [header, candidates.length ? formatCandidates(candidates) : "", ...notes]
              .filter(Boolean)
              .join("\n"),
          }],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "list_entity_candidates",
    [
      "List the NEW entities extraction has proposed and the writer has not yet decided",
      "on. Free — this only reads the queue. Each carries the id that triage_entity_candidate",
      "takes.",
    ].join(" "),
    { bookId: z.string().describe("Book ID") },
    { readOnlyHint: true, openWorldHint: true },
    async ({ bookId }) => {
      try {
        const client = getClient()
        const { candidates } = await client.get<{ candidates: EntityCandidate[] }>(
          `/api/books/${bookId}/entity-candidates`
        )
        if (!candidates.length) {
          return {
            content: [{ type: "text" as const, text: "No entity candidates pending review." }],
          }
        }
        return {
          content: [{
            type: "text" as const,
            text: `${candidates.length} pending:\n${formatCandidates(candidates)}`,
          }],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "triage_entity_candidate",
    [
      "Decide on one proposed entity. ACCEPTED confirms the draft record extraction",
      "already prepared, so it becomes a real character/location/event in the book.",
      "DISMISSED deletes that draft.",
      "Both are permanent in one respect: the name is never proposed again either way.",
      "This is the writer's call about their own world — decide when they asked you to,",
      "or when the prose plainly settles it, not to empty the queue.",
    ].join(" "),
    {
      bookId: z.string().describe("Book ID"),
      id: z.string().describe("Candidate ID"),
      status: z.enum(["ACCEPTED", "DISMISSED"]),
    },
    { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async ({ bookId, id, status }) => {
      try {
        const client = getClient()
        await client.patch(`/api/books/${bookId}/entity-candidates/${id}`, { status })
        const text =
          status === "ACCEPTED"
            ? `Accepted candidate ${id} — its draft record is now a confirmed entity.`
            : `Dismissed candidate ${id} — its draft record is deleted and the name will not be proposed again.`
        return { content: [{ type: "text" as const, text }] }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "list_entity_facts",
    [
      "List proposed facts about entities the book ALREADY has — the other half of what",
      "extraction produces, ordered by the chapter that established each one.",
      "Free. Pass status to see what was accepted or dismissed earlier; the default is",
      "the pending queue.",
    ].join(" "),
    {
      bookId: z.string().describe("Book ID"),
      status: z
        .enum(["PENDING", "ACCEPTED", "DISMISSED"])
        .optional()
        .describe("Default PENDING"),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ bookId, status }) => {
      try {
        const client = getClient()
        const path = status
          ? `/api/books/${bookId}/entity-facts?status=${status}`
          : `/api/books/${bookId}/entity-facts`
        const { facts } = await client.get<{ facts: EntityFact[] }>(path)
        if (!facts.length) {
          return {
            content: [{
              type: "text" as const,
              text: `No ${(status ?? "PENDING").toLowerCase()} entity facts.`,
            }],
          }
        }
        const text = facts
          .map(
            (f) =>
              `- ${f.statement}` +
              `\n  ${f.entityType}:${f.entityId} — established in Ch ${f.chapterOrderIndex + 1} "${f.chapterTitle}"` +
              (f.evidence ? `\n  evidence: ${f.evidence}` : "") +
              `\n  id:${f.id}`
          )
          .join("\n")
        return {
          content: [{
            type: "text" as const,
            text: `${facts.length} ${(status ?? "PENDING").toLowerCase()} fact${facts.length === 1 ? "" : "s"}:\n${text}`,
          }],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "triage_entity_fact",
    [
      "Decide on one proposed fact. ACCEPTED adds it to the fact log the AI context reads;",
      "it does NOT rewrite the entity's card, so nothing the writer typed is touched.",
      "DISMISSED keeps the row so the same statement is never proposed again.",
      "As with candidates, this is the writer's judgement about their own world.",
    ].join(" "),
    {
      bookId: z.string().describe("Book ID"),
      id: z.string().describe("Fact ID"),
      status: z.enum(["ACCEPTED", "DISMISSED"]),
    },
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ bookId, id, status }) => {
      try {
        const client = getClient()
        await client.patch(`/api/books/${bookId}/entity-facts/${id}`, { status })
        const text =
          status === "ACCEPTED"
            ? `Accepted fact ${id} — appended to the fact log; the entity's card is unchanged.`
            : `Dismissed fact ${id} — the statement will not be proposed again.`
        return { content: [{ type: "text" as const, text }] }
      } catch (error) {
        return toolError(error)
      }
    }
  )
}
