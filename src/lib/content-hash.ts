/**
 * FNV-1a 32-bit hex fingerprint of chapter prose.
 *
 * MIRROR of `lib/offline/content-hash.ts` in creader-editor. The product's
 * chapter PATCH compares `baseContentHash` against its own digest of the
 * stored prose, so this implementation must stay byte-for-byte equivalent —
 * a divergence would make every guarded write look like a conflict.
 *
 * Not cryptographic. It only answers "did this prose change since I last
 * read it". The server compares content equality as the final arbiter, so a
 * collision can never destroy data; it can only skip a conflict warning.
 */

export function contentHash(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}
