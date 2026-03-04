/**
 * Error handling utility for MCP tool responses.
 * Returns errors as tool content with isError flag so the LLM can see
 * what went wrong and self-correct, rather than getting a protocol-level error.
 */

export function toolError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  }
}
