/**
 * HTTP client for Creader API.
 * Attaches API key to all requests. Thin wrapper, no business logic.
 */

const API_KEY = process.env.CREADER_API_KEY
const BASE_URL = process.env.CREADER_API_URL || "https://creader.io"

interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: { code: string; message: string }
}

export class CreaderClient {
  private apiKey: string
  private baseUrl: string

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

    return json.data as T
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
