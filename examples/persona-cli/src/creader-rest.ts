/**
 * @input  CREADER_API_KEY (scopes read + write) and CREADER_API_URL (default https://creader.io),
 *         same env names as creader-mcp.
 * @output A thin client over the Creader REST routes seed needs. Every response is the
 *         `{ success, data }` envelope; errors carry the status and body text.
 * @pos    persona-cli — the REST fallback for what creader-mcp cannot do yet
 *         (create_character / update_character do not accept customFields).
 */

export interface Envelope<T> {
  success: boolean
  data: T
}

/** Creader keys are `cr_live_` + 40 hex chars (creader_editor lib/api-key.ts). Anything else is a different service's secret. */
export function assertKeyShape(key: string): void {
  if (!/^cr_live_[0-9a-f]{40}$/.test(key)) {
    const shape = `${key.slice(0, 6)}…, ${key.length} chars`
    throw new Error(`persona-cli: CREADER_API_KEY does not look like a Creader key (${shape}); expected cr_live_ + 40 hex = 48 chars, from the editor's Settings → API Keys tab`)
  }
}

export class CreaderRest {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = process.env.CREADER_API_URL ?? "https://creader.io",
  ) {}

  static fromEnv(): CreaderRest {
    const key = process.env.CREADER_API_KEY
    if (!key) throw new Error("persona-cli: CREADER_API_KEY not set")
    assertKeyShape(key)
    return new CreaderRest(key)
  }

  /**
   * Production sits behind Vercel's firewall, which sometimes answers a burst of API calls with
   * 403 `{"error":{"code":"challenge"}}` or 429. Those are not auth failures: wait and retry
   * (twice, 2 s then 6 s). Nothing here solves a challenge; it only tries again later.
   */
  async call<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<T> {
    const init: RequestInit = {
      method,
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
    }
    if (body !== undefined) init.body = JSON.stringify(body)
    const delays = [2_000, 6_000]
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${this.baseUrl}${path}`, init)
      const text = await res.text()
      if (res.ok) return (JSON.parse(text) as Envelope<T>).data
      const transient = res.status === 429 || (res.status === 403 && text.includes('"challenge"'))
      const delay = delays[attempt]
      if (!transient || delay === undefined) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`)
      console.error(`  ${method} ${path} → ${res.status} (firewall); retrying in ${delay / 1000}s`)
      await new Promise((r) => setTimeout(r, delay))
    }
  }
}
