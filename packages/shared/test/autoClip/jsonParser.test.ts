import { describe, it, expect } from "vitest";
import { extractAndParseJSON, extractJSONString } from "../../src/autoClip/jsonParser.js";

describe("extractAndParseJSON", () => {
  it("should parse a plain JSON object", () => {
    const result = extractAndParseJSON<{ score: number }>('{"score": 8}');
    expect(result).toEqual({ score: 8 });
  });

  it("should extract JSON from a markdown code fence with json tag", () => {
    const raw = '```json\n{"score": 8, "isHighlight": true}\n```';
    const result = extractAndParseJSON<{ score: number; isHighlight: boolean }>(raw);
    expect(result).toEqual({ score: 8, isHighlight: true });
  });

  it("should extract JSON from a markdown code fence without json tag", () => {
    const raw = '```\n{"title": "一剑曾当百万师"}\n```';
    const result = extractAndParseJSON<{ title: string }>(raw);
    expect(result).toEqual({ title: "一剑曾当百万师" });
  });

  it("should extract the first JSON object from surrounding text", () => {
    const raw = 'some prefix text {"score": 5, "reason": "good clip"} trailing text';
    const result = extractAndParseJSON<{ score: number; reason: string }>(raw);
    expect(result).toEqual({ score: 5, reason: "good clip" });
  });

  it("should return null for invalid JSON", () => {
    const result = extractAndParseJSON("not json at all");
    expect(result).toBeNull();
  });

  it("should return null for an empty code fence", () => {
    const result = extractAndParseJSON("```json\n```");
    expect(result).toBeNull();
  });

  it("should handle nested JSON objects", () => {
    const raw = '{"results": [{"index": 1, "verdict": "spam"}, {"index": 2, "verdict": "ok"}]}';
    const result = extractAndParseJSON<{ results: Array<{ index: number; verdict: string }> }>(raw);
    expect(result).toEqual({
      results: [
        { index: 1, verdict: "spam" },
        { index: 2, verdict: "ok" },
      ],
    });
  });

  it("should prefer code fence extraction over inline JSON when both present", () => {
    const raw = '```json\n{"score": 10}\n```\nextra {"score": 3}';
    const result = extractAndParseJSON<{ score: number }>(raw);
    expect(result).toEqual({ score: 10 });
  });
});

describe("extractJSONString", () => {
  it("should extract JSON string from code fence", () => {
    const result = extractJSONString('```json\n{"a": 1}\n```');
    expect(result).toBe('{"a": 1}');
  });

  it("should extract bare JSON object string", () => {
    const result = extractJSONString('text {"key": "value"} more');
    expect(result).toBe('{"key": "value"}');
  });

  it("should return null when no JSON found", () => {
    const result = extractJSONString("just plain text");
    expect(result).toBeNull();
  });
});

describe("extractAndParseJSON edge cases", () => {
  it("multiple top-level JSON blocks extracts only the first", () => {
    const result = extractAndParseJSON('{"a":1} 中间文本 {"b":2}');
    expect(result).toEqual({ a: 1 });
  });

  it("handles nested JSON correctly", () => {
    const result = extractAndParseJSON('{"outer":{"inner":[1,2,3]},"key":"val"}');
    expect(result).toEqual({ outer: { inner: [1, 2, 3] }, key: "val" });
  });

  it("handles escaped quotes inside strings", () => {
    const result = extractAndParseJSON('{"text":"he said \\"hello\\""}');
    expect(result).toEqual({ text: 'he said "hello"' });
  });

  it("handles escaped backslashes", () => {
    const result = extractAndParseJSON('{"path":"C:\\\\Users\\\\test"}');
    expect(result).toEqual({ path: "C:\\Users\\test" });
  });

  it("returns null for unbalanced braces", () => {
    expect(extractAndParseJSON('{"a":1')).toBeNull();
  });

  it("extracts only code fence content when multiple JSON blocks exist outside", () => {
    const raw = '```json\n{"a":1}\n```\n还有 {"b":2}';
    const result = extractAndParseJSON(raw);
    expect(result).toEqual({ a: 1 });
  });
});
