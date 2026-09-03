/**
 * Style MCP tools: get_style, list_style_references, add_style_references,
 * delete_style_reference, set_style_learning
 *
 * Two different things share the word "style" in Creader, and conflating them
 * is the mistake this file exists to prevent:
 *
 *   fingerprint  — MEASURED. Sentence lengths, vocabulary diversity, tone, POV,
 *                  tense, commonest words, computed from the author's own prose
 *                  by the style analyzer and re-derived as the manuscript
 *                  changes. Read it to write in this author's voice.
 *   references   — AUTHORED. Passages the writer chose as exemplars of how they
 *                  want to sound. A corpus, not a measurement.
 *
 * ## Why there is no set_style
 *
 * `PUT /style` exists and takes an API key, so a `set_style` tool would have
 * been two lines. It is deliberately absent. The fingerprint is a measurement
 * of prose that exists — editor-v2 computes it with the analyzer and PUTs the
 * result. A model writing one by hand would be fabricating a measurement, and
 * every AI call on that book afterwards is steered by it: chat, inline, the
 * L2 detectors. A wrong fingerprint does not fail loudly, it quietly teaches
 * the book the wrong voice. Reading is the whole value here; writing is a
 * footgun with no use case behind it.
 *
 * ## Not wrapped
 *
 * The Twitter-archive import is a multipart file upload (tweet.js, 5MB cap).
 * There is no file to upload from an MCP client, and the same rows can be
 * created through add_style_references with source "archive_import".
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { getClient } from "../lib/api-client.js"
import { toolError } from "../lib/errors.js"
import type { StyleFingerprintResponse, StyleReferencesResponse } from "../lib/types.js"

/** Server-side caps on POST /style-references, mirrored so a bad batch fails here. */
const MAX_REFERENCE_CHARS = 2000
const MAX_REFERENCES_PER_CALL = 50

export function registerStyleTools(server: McpServer) {
  server.tool(
    "get_style",
    [
      "Read the book's writing-style fingerprint: average sentence and paragraph length,",
      "vocabulary diversity, sentence-structure mix, tone, point of view, tense, and the",
      "author's commonest words. It is MEASURED from their own prose, not declared — so",
      "read it before drafting or revising anything, and match it.",
      "Null means no fingerprint has been computed yet (a new or barely-written book);",
      "that is not a claim that the author has no style.",
    ].join(" "),
    { bookId: z.string().describe("Book ID") },
    { readOnlyHint: true, openWorldHint: true },
    async ({ bookId }) => {
      try {
        const client = getClient()
        const { styleFingerprint } = await client.get<StyleFingerprintResponse>(
          `/api/books/${bookId}/style`
        )
        if (!styleFingerprint) {
          return {
            content: [{
              type: "text" as const,
              text: "No style fingerprint computed for this book yet. It is derived from the manuscript as it grows, so an early book has none — write in a voice the prose supports rather than inventing one.",
            }],
          }
        }
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(styleFingerprint, null, 2),
          }],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "list_style_references",
    [
      "List the passages the author chose as exemplars of how they want to sound, and",
      "whether style learning is switched on for this book. Unlike the fingerprint these",
      "are AUTHORED, not measured — treat them as the target voice.",
      "styleEnabled false means Creader is not feeding them to its own AI calls; the",
      "passages are still what the author picked.",
    ].join(" "),
    { bookId: z.string().describe("Book ID") },
    { readOnlyHint: true, openWorldHint: true },
    async ({ bookId }) => {
      try {
        const client = getClient()
        const { styleEnabled, references, count } =
          await client.get<StyleReferencesResponse>(
            `/api/books/${bookId}/style-references`
          )
        if (!references.length) {
          return {
            content: [{
              type: "text" as const,
              text: `No style references on this book. Style learning is ${styleEnabled ? "on" : "off"}.`,
            }],
          }
        }
        const lines = references.map(
          (r) => `- ${r.content}\n  id:${r.id} source:${r.source}`
        )
        return {
          content: [{
            type: "text" as const,
            text: [
              `${count} style reference${count === 1 ? "" : "s"}; style learning is ${styleEnabled ? "on" : "off"}.`,
              "",
              ...lines,
            ].join("\n"),
          }],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "add_style_references",
    [
      "Add passages to the author's voice corpus — prose they want future writing to",
      "sound like. Up to 50 per call, 2000 characters each, 500 per book.",
      "Add the author's own writing or a sample they chose; do not add your own prose,",
      "which would teach the book to sound like a model.",
      "Requires the Creator plan.",
    ].join(" "),
    {
      bookId: z.string().describe("Book ID"),
      references: z
        .array(
          z.object({
            content: z
              .string()
              .min(1)
              .max(MAX_REFERENCE_CHARS)
              .describe("The passage itself"),
            source: z
              .enum(["manual", "archive_import"])
              .optional()
              .describe("Where it came from. Defaults to manual."),
          })
        )
        .min(1)
        .max(MAX_REFERENCES_PER_CALL),
    },
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ bookId, references }) => {
      try {
        const client = getClient()
        const { count } = await client.post<{ count: number }>(
          `/api/books/${bookId}/style-references`,
          { references }
        )
        // The route silently trims the batch to fit the 500-per-book cap and
        // reports only what it created. Sent 20, stored 3, replied "3" — a
        // caller that printed "added" would be reporting a partial write as a
        // whole one, and the 17 dropped passages would never be missed.
        const dropped = references.length - count
        const text =
          dropped > 0
            ? `Added ${count} of ${references.length} style references. ${dropped} were dropped: the book is at its 500-reference cap. Delete some before adding more.`
            : `Added ${count} style reference${count === 1 ? "" : "s"}.`
        return { content: [{ type: "text" as const, text }] }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "delete_style_reference",
    "Remove one passage from the author's voice corpus. Deletes the exemplar only — no prose in the book is touched.",
    {
      bookId: z.string().describe("Book ID"),
      id: z.string().describe("Style reference ID"),
    },
    { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async ({ bookId, id }) => {
      try {
        const client = getClient()
        await client.delete(`/api/books/${bookId}/style-references/${id}`)
        return {
          content: [{ type: "text" as const, text: `Deleted style reference ${id}` }],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.tool(
    "set_style_learning",
    [
      "Switch on or off whether Creader feeds this book's style references into its own",
      "AI calls. Off leaves the references in place and stops them steering generation.",
      "This is the author's setting about their own voice — flip it when they ask, not",
      "because it would make a task easier. Requires the Creator plan.",
    ].join(" "),
    {
      bookId: z.string().describe("Book ID"),
      styleEnabled: z.boolean().describe("true to learn from the references, false to stop"),
    },
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ bookId, styleEnabled }) => {
      try {
        const client = getClient()
        const result = await client.patch<{ styleEnabled: boolean }>(
          `/api/books/${bookId}/style-references`,
          { styleEnabled }
        )
        return {
          content: [{
            type: "text" as const,
            text: `Style learning is now ${result.styleEnabled ? "on" : "off"} for this book.`,
          }],
        }
      } catch (error) {
        return toolError(error)
      }
    }
  )
}
