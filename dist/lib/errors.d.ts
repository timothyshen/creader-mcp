/**
 * Error handling utility for MCP tool responses.
 * Returns errors as tool content with isError flag so the LLM can see
 * what went wrong and self-correct, rather than getting a protocol-level error.
 */
export declare function toolError(error: unknown): {
    content: {
        type: "text";
        text: string;
    }[];
    isError: boolean;
};
