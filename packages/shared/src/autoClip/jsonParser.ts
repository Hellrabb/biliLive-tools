// ---------------------------------------------------------------------------
// Shared JSON extraction & parsing
// ---------------------------------------------------------------------------

const CODE_FENCE_RE = /```(?:json)?\s*\n?([\s\S]*?)```/;
const JSON_OBJECT_RE = /\{[\s\S]*\}/;

/**
 * Extract a JSON payload from raw LLM output and parse it.
 *
 * Tries markdown code fence first (with optional `json` language tag),
 * then falls back to extracting the first bare `{...}` object.
 *
 * @returns The parsed object, or `null` if extraction / parsing fails.
 */
export function extractAndParseJSON<T = Record<string, unknown>>(raw: string): T | null {
  let jsonStr = raw;

  const blockMatch = raw.match(CODE_FENCE_RE);
  if (blockMatch) {
    jsonStr = blockMatch[1]!.trim();
  } else {
    const objMatch = raw.match(JSON_OBJECT_RE);
    if (objMatch) {
      jsonStr = objMatch[0];
    }
  }

  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    return null;
  }
}

/**
 * Extract just the JSON string from raw LLM output (no parsing).
 * Useful when the caller needs the raw string for further processing.
 *
 * @returns The extracted JSON string, or `null` if nothing found.
 */
export function extractJSONString(raw: string): string | null {
  const blockMatch = raw.match(CODE_FENCE_RE);
  if (blockMatch) return blockMatch[1]!.trim();

  const objMatch = raw.match(JSON_OBJECT_RE);
  if (objMatch) return objMatch[0];

  return null;
}
