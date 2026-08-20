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
export function stripHtmlForPositions(html) {
    if (!html)
        return "";
    return html
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&apos;/gi, "'")
        .replace(/&ldquo;/gi, "\u201c")
        .replace(/&rdquo;/gi, "\u201d")
        .replace(/&lsquo;/gi, "\u2018")
        .replace(/&rsquo;/gi, "\u2019")
        .replace(/&mdash;/gi, "\u2014")
        .replace(/&ndash;/gi, "\u2013")
        .replace(/&hellip;/gi, "\u2026")
        .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_match, dec) => String.fromCharCode(Number(dec)));
}
