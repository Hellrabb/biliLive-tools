// ---------------------------------------------------------------------------
// Shared JSON extraction & parsing
// ---------------------------------------------------------------------------

const CODE_FENCE_RE = /```(?:json)?\s*\n?([\s\S]*?)```/;

/**
 * Extract a balanced JSON object from raw text by counting braces.
 * Handles nested objects, strings with escaped quotes,
 * and multiple top-level objects (returns the first valid one).
 */
function extractBalancedJSON(text: string): string | null {
  // Try code fence first
  const blockMatch = text.match(CODE_FENCE_RE);
  const searchText = blockMatch ? blockMatch[1]!.trim() : text;

  const start = searchText.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < searchText.length; i++) {
    const c = searchText[i]!;

    if (escape) {
      escape = false;
      continue;
    }

    if (c === "\\") {
      escape = true;
      continue;
    }

    if (c === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          return searchText.slice(start, i + 1);
        }
      }
    }
  }

  return null; // unbalanced braces
}

/**
 * Extract a JSON payload from raw LLM output and parse it.
 *
 * Tries markdown code fence first (with optional `json` language tag),
 * then falls back to balanced brace extraction.
 *
 * @returns The parsed object, or `null` if extraction / parsing fails.
 */
export function extractAndParseJSON<T = Record<string, unknown>>(raw: string): T | null {
  const jsonStr = extractBalancedJSON(raw);
  if (!jsonStr) return null;

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
  return extractBalancedJSON(raw);
}
