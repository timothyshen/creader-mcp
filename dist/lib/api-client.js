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
const API_KEY = process.env.CREADER_API_KEY;
const BASE_URL = process.env.CREADER_API_URL || "https://creader.io";
const CACHE_TTL_MS = 60_000; // 60 seconds
export class CreaderClient {
    apiKey;
    baseUrl;
    cache = new Map();
    constructor(apiKey, baseUrl) {
        this.apiKey = apiKey || API_KEY || "";
        this.baseUrl = baseUrl || BASE_URL;
        if (!this.apiKey) {
            throw new Error("CREADER_API_KEY is required. Set it as an environment variable.");
        }
    }
    async request(method, path, body) {
        // Check cache for GET requests
        if (method === "GET") {
            const cached = this.cache.get(path);
            if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
                return cached.data;
            }
        }
        const url = `${this.baseUrl}${path}`;
        const headers = {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
        };
        const res = await fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
        });
        const json = (await res.json());
        if (!res.ok || !json.success) {
            const msg = json.error?.message || `API error: ${res.status}`;
            throw new Error(msg);
        }
        const data = json.data;
        if (method === "GET") {
            // Store in cache
            this.cache.set(path, { data, timestamp: Date.now() });
        }
        else {
            // Write operation — clear entire cache so next GETs fetch fresh data
            this.cache.clear();
        }
        return data;
    }
    async get(path) {
        return this.request("GET", path);
    }
    async post(path, body) {
        return this.request("POST", path, body);
    }
    async patch(path, body) {
        return this.request("PATCH", path, body);
    }
    async delete(path) {
        return this.request("DELETE", path);
    }
    /**
     * POST without ApiResponse envelope unwrapping.
     * Use for endpoints (like /guardian/vector-check) that return raw JSON instead
     * of the { success, data } envelope. Bypasses the read cache and clears it
     * on success, same as a regular write.
     */
    async postRaw(path, body) {
        const url = `${this.baseUrl}${path}`;
        const headers = {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
        };
        const res = await fetch(url, {
            method: "POST",
            headers,
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) {
            let msg = `API error: ${res.status}`;
            try {
                const errJson = (await res.json());
                const errField = errJson.error;
                if (typeof errField === "string")
                    msg = errField;
                else if (errField?.message)
                    msg = errField.message;
            }
            catch {
                // Response wasn't JSON — keep generic message
            }
            throw new Error(msg);
        }
        this.cache.clear();
        return (await res.json());
    }
}
// Singleton instance
let _client = null;
export function getClient() {
    if (!_client) {
        _client = new CreaderClient();
    }
    return _client;
}
