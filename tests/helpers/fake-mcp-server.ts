/**
 * Minimal stand-in for McpServer that captures `tool()` registrations
 * so tests can invoke handlers directly without stdio transport.
 */

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
