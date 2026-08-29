/**
 * Minimal stand-in for McpServer that captures `tool()` registrations
 * so tests can invoke handlers directly without stdio transport.
 *
 * `call()` deliberately skips schema validation — it feeds the handler
 * directly, the way most tests want. That also means a call with a bogus
 * argument still "passes", so an assertion about what a tool *accepts* has to
 * go through `validate()`, which runs the registered zod shape.
 */
import { z, type ZodRawShape } from "zod"

interface RegisteredTool {
  description: string
  schema: unknown
  annotations: unknown
  handler: (args: unknown) => Promise<unknown>
}

export class FakeMcpServer {
  public tools = new Map<string, RegisteredTool>()

  tool(
    name: string,
    description: string,
    schema: unknown,
    annotations: unknown,
    handler: (args: unknown) => Promise<unknown>
  ) {
    this.tools.set(name, { description, schema, annotations, handler })
  }

  async call<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const tool = this.tools.get(name)
    if (!tool) {
      throw new Error(`Tool "${name}" not registered. Available: ${[...this.tools.keys()].join(", ")}`)
    }
    return (await tool.handler(args)) as T
  }

  /** Check args against the tool's registered zod shape (what a real client is held to). */
  validate(name: string, args: Record<string, unknown>) {
    const tool = this.tools.get(name)
    if (!tool) throw new Error(`Tool "${name}" not registered.`)
    return z.object(tool.schema as ZodRawShape).safeParse(args)
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  names(): string[] {
    return [...this.tools.keys()]
  }
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>
  isError?: boolean
}

export function asToolResult(value: unknown): ToolResult {
  return value as ToolResult
}
