/**
 * Queue-based fetch mock. Each `mock*` call enqueues a response;
 * subsequent fetch() calls dequeue in order.
 */

import { vi } from "vitest"

export interface RecordedCall {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

type Responder = () => Promise<Response> | Response

export class FetchMock {
  private queue: Responder[] = []
  public calls: RecordedCall[] = []

  mockSuccess(data: unknown) {
    this.queue.push(() =>
      new Response(JSON.stringify({ success: true, data }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )
    return this
  }

  /** API returned 200 but with success:false envelope. */
  mockApiError(code: string, message: string) {
    this.queue.push(() =>
      new Response(JSON.stringify({ success: false, error: { code, message } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )
    return this
  }

  /** Non-2xx HTTP status with optional body. */
  mockHttpError(status: number, body?: unknown) {
    this.queue.push(() =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      })
    )
    return this
  }

  /** Raw JSON response (no envelope), used for postRaw endpoints. */
  mockRaw(body: unknown, status = 200) {
    this.queue.push(() =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      })
    )
    return this
  }

  /** Network-level failure (fetch rejects). */
  mockReject(error: Error) {
    this.queue.push(() => Promise.reject(error))
    return this
  }

  lastCall(): RecordedCall | undefined {
    return this.calls[this.calls.length - 1]
  }

  reset() {
    this.queue = []
    this.calls = []
  }
}

export function installFetchMock(): FetchMock {
  const mock = new FetchMock()

  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString()
    const method = (init?.method ?? "GET").toUpperCase()
    const headers: Record<string, string> = {}
    if (init?.headers) {
      const h = new Headers(init.headers as HeadersInit)
      h.forEach((v, k) => {
        headers[k] = v
      })
    }
    let parsedBody: unknown = undefined
    if (init?.body && typeof init.body === "string") {
      try {
        parsedBody = JSON.parse(init.body)
      } catch {
        parsedBody = init.body
      }
    }

    mock.calls.push({ url, method, headers, body: parsedBody })

    const responder = (mock as unknown as { queue: Responder[] }).queue.shift()
    if (!responder) {
      throw new Error(
        `fetch called without a queued response. url=${method} ${url}`
      )
    }
    return await responder()
  })

  vi.stubGlobal("fetch", fetchImpl)
  return mock
}
