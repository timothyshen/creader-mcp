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

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    // Check cache for GET requests
    if (method === "GET") {
      const cached = this.cache.get(path)
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.data as T
      }
    }

    const url = `${this.baseUrl}${path}`
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    const json = (await res.json()) as ApiResponse<T>

    if (!res.ok || !json.success) {
      const msg = json.error?.message || `API error: ${res.status}`
      throw new Error(msg)
    }

    const data = json.data as T

    if (method === "GET") {
      // Store in cache
      this.cache.set(path, { data, timestamp: Date.now() })
    } else {
      // Write operation — clear entire cache so next GETs fetch fresh data
      this.cache.clear()
    }

    return data
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
}

// Singleton instance
let _client: CreaderClient | null = null

export function getClient(): CreaderClient {
  if (!_client) {
    _client = new CreaderClient()
  }
  return _client
}
