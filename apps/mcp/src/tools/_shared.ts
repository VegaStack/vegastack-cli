// Shared helpers for MCP tool handlers.

/**
 * Wrap an arbitrary JSON-serialisable value in the MCP `content` envelope.
 * The MCP TS SDK accepts `structuredContent` on responses; we set BOTH so
 * older clients (text-only) and modern clients (structured) both work.
 *
 * The MCP SDK requires `structuredContent` to be a JSON object (not a bare
 * primitive or array), so we wrap arrays / scalars in `{ value: ... }`.
 */
export function jsonContent(value: unknown): {
  content: [{ type: "text"; text: string }];
  structuredContent: Record<string, unknown>;
} {
  const text = JSON.stringify(value, null, 2);
  const structured: Record<string, unknown> =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { value };
  return {
    content: [{ type: "text", text }],
    structuredContent: structured,
  };
}
