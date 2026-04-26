/**
 * HTTP client for Creader API.
 * Attaches API key to all requests.
 * Includes TTL cache for GET requests — see explanation below.
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
    private request;
    get<T>(path: string): Promise<T>;
    post<T>(path: string, body?: unknown): Promise<T>;
    patch<T>(path: string, body?: unknown): Promise<T>;
    delete<T>(path: string): Promise<T>;
    /**
     * POST without ApiResponse envelope unwrapping.
     * Use for endpoints (like /guardian/vector-check) that return raw JSON instead
     * of the { success, data } envelope. Bypasses the read cache and clears it
     * on success, same as a regular write.
     */
    postRaw<T>(path: string, body?: unknown): Promise<T>;
}
export declare function getClient(): CreaderClient;
