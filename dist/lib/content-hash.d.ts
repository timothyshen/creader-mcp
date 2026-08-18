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
export declare function contentHash(input: string): string;
