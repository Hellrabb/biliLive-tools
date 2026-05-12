const MAX_LENGTH = 200;
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * Sanitize user-generated text before inserting it into an LLM prompt.
 *
 * Protects against:
 * - Prompt injection via JSON-template confusion (curly braces → fullwidth)
 * - Control-character smuggling
 * - Overly long strings consuming context window
 */
export function sanitizeForPrompt(text: string): string {
  if (!text) return "";

  let out = text.trim();
  if (out.length === 0) return "";

  if (out.length > MAX_LENGTH) {
    out = out.slice(0, MAX_LENGTH);
  }

  out = out.replace(CONTROL_CHARS, " ");

  // Replace curly braces with fullwidth equivalents to prevent
  // JSON-template confusion in LLM prompts
  out = out.replace(/\{/g, "｛"); // ｛
  out = out.replace(/\}/g, "｝"); // ｝

  return out;
}

/**
 * Sanitize a list of danmaku text strings for LLM prompt insertion.
 */
export function sanitizeDanmakuList(texts: string[]): string[] {
  return texts
    .map((t) => sanitizeForPrompt(t))
    .filter((t) => t.length > 0);
}
