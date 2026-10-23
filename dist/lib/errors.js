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
/**
 * What a 401 from Creader can mean, for the model to relay. Since 2026-10-23
 * API access (API keys and this MCP server) is a Creator-plan feature, and the
 * server refuses keys whose owner is not on Creator with the same bare 401
 * "Not authenticated" an invalid key gets. Without this, a writer whose plan
 * changed sees "Error: Not authenticated" and replaces a key that was fine.
 */
export const UNAUTHORIZED_HINT = "Creader did not accept this API key. Either the key is invalid or was deleted, " +
    "or the account that owns it is not on the Creator plan (API access and the MCP " +
    "server are part of Creator). Check the key and the plan in Creader under Settings > Developer.";
/** A 401 from the API, with the hint appended once. */
export function withUnauthorizedHint(message) {
    return message.includes(UNAUTHORIZED_HINT) ? message : `${message}. ${UNAUTHORIZED_HINT}`;
}
export function toolError(error) {
    const message = error instanceof ApiRequestError && error.status === 401
        ? withUnauthorizedHint(error.message)
        : error instanceof Error
            ? error.message
            : String(error);
    return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
    };
}
