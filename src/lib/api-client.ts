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

import { ApiRequestError } from "./errors.js"

const API_KEY = process.env.CREADER_API_KEY
const BASE_URL = process.env.CREADER_API_URL || "https://creader.io"
const CACHE_TTL_MS = 60_000 // 60 seconds

interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: { code: string; message: string }
}

interface CacheEntry {
  data: unknown
  timestamp: number
}

export class CreaderClient {
  private apiKey: string
  private baseUrl: string
  private cache = new Map<string, CacheEntry>()

  constructor(apiKey?: string, baseUrl?: string) {
    this.apiKey = apiKey || API_KEY || ""
    this.baseUrl = baseUrl || BASE_URL

    if (!this.apiKey) {
      throw new Error(
        "CREADER_API_KEY is required. Set it as an environment variable."
      )
    }
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    }
  }

  /** Cached copy of a GET, or undefined when absent/expired. */
  private cached<T>(method: string, path: string): T | undefined {
    if (method !== "GET") return undefined
    const entry = this.cache.get(path)
    if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
      return entry.data as T
    }
    return undefined
  }

  /** Cache a GET result; any write invalidates everything. */
  private settle(method: string, path: string, data: unknown): void {
    if (method === "GET") {
      this.cache.set(path, { data, timestamp: Date.now() })
    } else {
      this.cache.clear()
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const hit = this.cached<T>(method, path)
    if (hit !== undefined) return hit

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    })

    const json = (await res.json()) as ApiResponse<T>

    if (!res.ok || !json.success) {
      const msg = json.error?.message || `API error: ${res.status}`
      throw new ApiRequestError(msg, res.status, json.error?.code)
    }

    const data = json.data as T
    this.settle(method, path, data)
    return data
  }

  /**
   * Drop one cached GET so the next read is guaranteed to hit the server.
   * Needed after a rejected write: the cached pre-image is exactly the stale
   * copy the caller must stop re-baselining against.
   */
  invalidate(path: string): void {
    this.cache.delete(path)
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path)
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body)
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PATCH", path, body)
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path)
  }

  /**
   * Same transport, no envelope unwrapping — the body IS the result.
   * Shared by getRaw/postRaw so the error-parsing rules can't drift apart.
   */
  private async requestRaw<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown
  ): Promise<T> {
    const hit = this.cached<T>(method, path)
    if (hit !== undefined) return hit

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!res.ok) {
      let msg = `API error: ${res.status}`
      let code: string | undefined
      try {
        const errJson = (await res.json()) as {
          error?: string | { message?: string; code?: string }
        }
        const errField = errJson.error
        if (typeof errField === "string") msg = errField
        else if (errField?.message) {
          msg = errField.message
          code = errField.code
        }
      } catch {
        // Response wasn't JSON — keep generic message
      }
      throw new ApiRequestError(msg, res.status, code)
    }

    const data = (await res.json()) as T
    this.settle(method, path, data)
    return data
  }

  /**
   * GET a route that returns bare JSON rather than the { success, data }
   * envelope — e.g. /api/books/[bookId]/knowledge/search. Cached like any
   * other GET.
   */
  async getRaw<T>(path: string): Promise<T> {
    return this.requestRaw<T>("GET", path)
  }

  /**
   * POST without ApiResponse envelope unwrapping.
   * Use for endpoints (like /guardian/vector-check and /guardian/run) that
   * return raw JSON instead of the { success, data } envelope. Bypasses the
   * read cache and clears it on success, same as a regular write.
   */
  async postRaw<T>(path: string, body?: unknown): Promise<T> {
    return this.requestRaw<T>("POST", path, body)
  }
}

// Singleton instance
let _client: CreaderClient | null = null

export function getClient(): CreaderClient {
  if (!_client) {
    _client = new CreaderClient()
  }
  return _client
}
