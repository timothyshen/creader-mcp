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
export declare class ApiRequestError extends Error {
    readonly status: number;
    readonly code?: string | undefined;
    constructor(message: string, status: number, code?: string | undefined);
}
/**
 * What a 401 from Creader can mean, for the model to relay. Since 2026-10-23
 * API access (API keys and this MCP server) is a Creator-plan feature, and the
 * server refuses keys whose owner is not on Creator with the same bare 401
 * "Not authenticated" an invalid key gets. Without this, a writer whose plan
 * changed sees "Error: Not authenticated" and replaces a key that was fine.
 */
export declare const UNAUTHORIZED_HINT: string;
/** A 401 from the API, with the hint appended once. */
export declare function withUnauthorizedHint(message: string): string;
export declare function toolError(error: unknown): {
    content: {
        type: "text";
        text: string;
    }[];
    isError: boolean;
};
