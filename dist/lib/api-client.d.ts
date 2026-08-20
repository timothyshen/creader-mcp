/**
 * HTTP client for Creader API.
 * Attaches API key to all requests.
 * Includes TTL cache for GET requests — see explanation below.
 *
 * ## Two response shapes
 *
 * Most Creader routes reply with the `{ success, data }` envelope, which
 * `get/post/patch/delete` unwrap. A handful reply with bare JSON instead —
 * they were written as plain `NextResponse.json(payload)` handlers rather
 * than through the shared route factory. Those need `getRaw` / `postRaw`,
 * which return the body verbatim. Sending a bare-JSON route through the
 * enveloped path fails with a nonsensical "API error: 200", because
 * `json.success` is simply absent. That is exactly how `search_knowledge`
 * would have kept failing even after its URL was corrected.
 *
 * ## How the cache works
 *
 * The MCP server is a long-running process. Claude may call the same tool
 * multiple times across conversation turns (e.g. get_book_context on every
 * turn). Without caching, each call hits the Creader API even when the data
 * hasn't changed.
 *
 * The cache stores GET responses in memory with a time-to-live (TTL).
 * Within the TTL window, repeated GETs return the cached copy instantly
 * instead of making an HTTP request.
 *
 * On any write (POST/PATCH/DELETE), the cache is cleared so subsequent
 * GETs fetch fresh data reflecting the change.
 *
 * Cache key = the URL path (e.g. "/api/books/abc/characters")
 * Cache value = { data, timestamp }
 * Eviction = on TTL expiry OR on any write operation
 */
export declare class CreaderClient {
    private apiKey;
    private baseUrl;
    private cache;
    constructor(apiKey?: string, baseUrl?: string);
    private headers;
    /** Cached copy of a GET, or undefined when absent/expired. */
    private cached;
    /** Cache a GET result; any write invalidates everything. */
    private settle;
    private request;
    /**
     * Drop one cached GET so the next read is guaranteed to hit the server.
     * Needed after a rejected write: the cached pre-image is exactly the stale
     * copy the caller must stop re-baselining against.
     */
    invalidate(path: string): void;
    get<T>(path: string): Promise<T>;
    post<T>(path: string, body?: unknown): Promise<T>;
    patch<T>(path: string, body?: unknown): Promise<T>;
    delete<T>(path: string): Promise<T>;
    /**
     * Same transport, no envelope unwrapping — the body IS the result.
     * Shared by getRaw/postRaw so the error-parsing rules can't drift apart.
     */
    private requestRaw;
    /**
     * GET a route that returns bare JSON rather than the { success, data }
     * envelope — e.g. /api/books/[bookId]/knowledge/search. Cached like any
     * other GET.
     */
    getRaw<T>(path: string): Promise<T>;
    /**
     * POST without ApiResponse envelope unwrapping.
     * Use for endpoints (like /guardian/vector-check and /guardian/run) that
     * return raw JSON instead of the { success, data } envelope. Bypasses the
     * read cache and clears it on success, same as a regular write.
     */
    postRaw<T>(path: string, body?: unknown): Promise<T>;
}
export declare function getClient(): CreaderClient;
