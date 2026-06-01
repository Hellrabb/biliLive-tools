import { describe, it, expect } from "vitest";
import { sanitizeForPrompt, sanitizeDanmakuList } from "../../src/autoClip/promptSanitizer";

// ============================================================================
// sanitizeForPrompt
// ============================================================================

describe("sanitizeForPrompt", () => {
  it("returns empty string for empty input", () => {
    expect(sanitizeForPrompt("")).toBe("");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(sanitizeForPrompt("   ")).toBe("");
    expect(sanitizeForPrompt("\t\n ")).toBe("");
  });

  it("passes through normal text unchanged", () => {
    const input = "Hello world, this is normal text.";
    expect(sanitizeForPrompt(input)).toBe(input);
  });

  it("trims leading and trailing whitespace", () => {
    expect(sanitizeForPrompt("  hello  ")).toBe("hello");
    expect(sanitizeForPrompt("\tmessage\n")).toBe("message");
  });

  it("truncates text exceeding MAX_LENGTH (200 chars)", () => {
    const longText = "x".repeat(500);
    const result = sanitizeForPrompt(longText);
    expect(result.length).toBe(200);
    expect(result).toBe("x".repeat(200));
  });

  it("does not truncate text at exactly MAX_LENGTH", () => {
    const text = "y".repeat(200);
    expect(sanitizeForPrompt(text)).toBe(text);
  });

  it("strips null byte (\\x00)", () => {
    expect(sanitizeForPrompt("hello\x00world")).toBe("hello world");
  });

  it("strips null byte at beginning and end of text", () => {
    expect(sanitizeForPrompt("\x00test")).toBe(" test");
    expect(sanitizeForPrompt("test\x00")).toBe("test ");
  });

  it("strips escape character (\\x1b)", () => {
    expect(sanitizeForPrompt("hello\x1b world")).toBe("hello  world");
  });

  it("strips all C0 and C1 control characters", () => {
    const controls = "\x00\x01\x02\x03\x04\x05\x06\x07\x08\x0B\x0C\x0E\x0F";
    const cleaned = sanitizeForPrompt(controls);
    // Control chars are replaced with spaces; trim() does NOT remove them
    // because trim() runs BEFORE replacement, and these are not whitespace.
    // The 13 control chars all become spaces.
    expect(cleaned.length).toBe(13);
    expect(cleaned).toBe(" ".repeat(13));
  });

  it("strips DEL character (\\x7F)", () => {
    expect(sanitizeForPrompt("hi\x7Fthere")).toBe("hi there");
  });

  it("strips control characters from middle of text", () => {
    expect(sanitizeForPrompt("abc\x00\x1b def")).toMatch(/^abc\s+def$/);
  });

  it("neutralizes left curly brace to fullwidth", () => {
    expect(sanitizeForPrompt("{system}")).toBe("｛system｝");
  });

  it("neutralizes right curly brace to fullwidth", () => {
    expect(sanitizeForPrompt("value: {user}")).toBe("value: ｛user｝");
  });

  it("neutralizes nested curly braces", () => {
    expect(sanitizeForPrompt("{outer {inner} outer}")).toBe("｛outer ｛inner｝ outer｝");
  });

  it("neutralizes JSON-template style curly braces", () => {
    expect(sanitizeForPrompt('{"key": "value"}')).toBe('｛"key": "value"｝');
  });

  it("passes through Unicode emoji unchanged", () => {
    expect(sanitizeForPrompt("🔥 amazing stream 🎉")).toBe("🔥 amazing stream 🎉");
  });

  it("passes through Chinese characters unchanged", () => {
    expect(sanitizeForPrompt("主播太厉害了！！")).toBe("主播太厉害了！！");
  });

  it("handles mixed emoji, CJK, and special characters", () => {
    const input = "🔥 精彩时刻！{user} 太强了 👏\x00";
    const result = sanitizeForPrompt(input);
    expect(result).toContain("🔥");
    expect(result).toContain("精彩时刻");
    expect(result).toContain("｛user｝");
    expect(result).toContain("👏");
    expect(result).not.toContain("\x00");
    expect(result).not.toContain("{");
    expect(result).not.toContain("}");
  });

  it("truncates then sanitizes for text near boundary length", () => {
    // Text just over 200 chars with a control char near the end
    let text = "a".repeat(198) + "\x00" + "b";
    const result = sanitizeForPrompt(text);
    // Truncation happens at 200 (before sanitize),
    // then control char within the truncated part is replaced
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result).not.toContain("\x00");
  });

  it("returns empty string for falsy input (null/undefined coerced)", () => {
    // TypeScript won't allow null, but defensive check exists: !text
    expect(sanitizeForPrompt(null as unknown as string)).toBe("");
    expect(sanitizeForPrompt(undefined as unknown as string)).toBe("");
  });

  it("non-printable curly braces still work in code examples", () => {
    // Curly braces in a code-like string should be neutralized
    const code = "function { return x; }";
    const result = sanitizeForPrompt(code);
    expect(result).toBe("function ｛ return x; ｝");
  });

  it("keeps safe special characters unchanged", () => {
    const safe = "hello! @#$%^&*()_+-=[]|;:',.<>?/~`";
    const result = sanitizeForPrompt(safe);
    expect(result).toBe(safe);
  });
});

// ============================================================================
// sanitizeDanmakuList
// ============================================================================

describe("sanitizeDanmakuList", () => {
  it("returns empty array for empty input", () => {
    expect(sanitizeDanmakuList([])).toEqual([]);
  });

  it("sanitizes each item and filters empties", () => {
    const input = ["  hello  ", "", "  \x00world  ", "{prompt}"];
    const result = sanitizeDanmakuList(input);
    expect(result).toEqual(["hello", " world", "｛prompt｝"]);
  });

  it("filters out items that become empty after sanitization", () => {
    // "\t\n" trims to empty; "   " trims to empty
    // "\x00\x01\x02" becomes "   " (3 spaces) which has length > 0
    // so it survives the filter
    expect(sanitizeDanmakuList(["\t\n", "   "])).toEqual([]);
    // Control chars become spaces, not filtered
    expect(sanitizeDanmakuList(["\x00\x01\x02"])).toEqual(["   "]);
  });

  it("handles a mix of valid and invalid entries", () => {
    const input = ["hello", "", "   ", "world\x00!", "{inject}", "\x1b escaped", "🔥🔥🔥"];
    const result = sanitizeDanmakuList(input);
    expect(result).toEqual([
      "hello",
      "world !",
      "｛inject｝",
      "  escaped", // \x1b -> space, plus existing space before "escaped"
      "🔥🔥🔥",
    ]);
  });

  it("truncates long entries in the list", () => {
    const longText = "a".repeat(300);
    const result = sanitizeDanmakuList([longText]);
    expect(result.length).toBe(1);
    expect(result[0]!.length).toBe(200);
  });
});
