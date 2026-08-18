/**
 * Tiptap/HTML → plain text for AI routes that score character offsets.
 *
 * MIRROR of `stripHtmlForPositions` in creader-editor's `lib/utils.ts`.
 * Chapter content is stored as Tiptap HTML, but /guardian/run takes
 * `plainContent` and reports findings as `textPosition` offsets INTO that
 * plain string. Tags are removed without replacement (no spacer characters)
 * so the offsets line up with ProseMirror's `doc.textContent` — which is what
 * the editor highlights against. Any "tidier" strip (collapsing whitespace,
 * trimming, inserting newlines per block) shifts every offset after it and
 * silently mislocates every issue.
 */
export declare function stripHtmlForPositions(html: string): string;
