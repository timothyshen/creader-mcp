/**
 * Error handling utility for MCP tool responses.
 * Returns errors as tool content with isError flag so the LLM can see
 * what went wrong and self-correct, rather than getting a protocol-level error.
 */
/**
 * An HTTP failure from the Creader API, carrying the two facts a tool needs
 * in order to branch: the status and — when the API sent an enveloped error —
 * its machine-readable code.
 *
 * Exists because `update_chapter` has to tell a 409 write conflict (someone
 * else's words are on the server; do NOT overwrite) apart from every other
 * failure. A bare Error only carries a human sentence, so the only way to
 * recognise a conflict would be to string-match the server's prose.
 */
export class ApiRequestError extends Error {
    status;
    code;
    constructor(message, status, code) {
        super(message);
        this.status = status;
        this.code = code;
        this.name = "ApiRequestError";
    }
}
export function toolError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
    };
}
