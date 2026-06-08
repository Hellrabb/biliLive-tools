import { describe, it, expect } from "vitest";
import {
  applyTemplateVariables,
  renderTitleTemplate,
  renderDescTemplate,
  type TemplateContext,
} from "../../src/autoClip/templateRenderer.js";

const ctx: TemplateContext = {
  highlightTitle: "五杀瞬间",
  roomName: "某某直播间",
  date: "2026-06-08",
  uploadDate: "2026-06-08",
};

describe("applyTemplateVariables", () => {
  it("replaces known variables", () => {
    const result = applyTemplateVariables("{{highlightTitle}} - {{roomName}}", {
      highlightTitle: "test",
      roomName: "room",
    });
    expect(result).toBe("test - room");
  });

  it("keeps unknown placeholders unchanged", () => {
    const result = applyTemplateVariables("{{unknown}} title", {});
    expect(result).toBe("{{unknown}} title");
  });

  it("replaces undefined values with empty string", () => {
    const result = applyTemplateVariables("before{{a}}after", { a: undefined });
    expect(result).toBe("beforeafter");
  });

  it("handles empty template", () => {
    expect(applyTemplateVariables("", { highlightTitle: "x" })).toBe("");
  });

  it("replaces multiple occurrences of the same variable", () => {
    const result = applyTemplateVariables("{{x}} and {{x}}", { x: "a" });
    expect(result).toBe("a and a");
  });

  it("does not replace partial matches", () => {
    const result = applyTemplateVariables("{{highlightTitle}}", {
      highlight: "WRONG",
    });
    expect(result).toBe("{{highlightTitle}}");
  });
});

describe("renderTitleTemplate", () => {
  it("renders with context variables", () => {
    const result = renderTitleTemplate("{{highlightTitle}} - {{roomName}}", ctx);
    expect(result).toBe("五杀瞬间 - 某某直播间");
  });

  it("truncates to 80 characters", () => {
    const long = "a".repeat(100);
    const result = renderTitleTemplate(long, ctx);
    expect(result.length).toBeLessThanOrEqual(80);
  });

  it("trims whitespace", () => {
    const result = renderTitleTemplate("  {{highlightTitle}}  ", ctx);
    expect(result).toBe("五杀瞬间");
  });

  it("uses all four variables", () => {
    const result = renderTitleTemplate(
      "{{highlightTitle}} {{roomName}} {{date}} {{uploadDate}}",
      ctx,
    );
    expect(result).toBe("五杀瞬间 某某直播间 2026-06-08 2026-06-08");
  });
});

describe("renderDescTemplate", () => {
  it("renders multi-line description", () => {
    const result = renderDescTemplate("直播间：{{roomName}}\n日期：{{date}}", ctx);
    expect(result).toBe("直播间：某某直播间\n日期：2026-06-08");
  });

  it("returns empty string for empty template", () => {
    expect(renderDescTemplate("", ctx)).toBe("");
  });
});

describe("boundary cases", () => {
  it("handles special regex characters in variable names safely", () => {
    const result = applyTemplateVariables("{{$test}}", { $test: "pass" });
    // $ is a regex special char — replaceAll should handle it
    expect(result).toBe("pass");
  });

  it("handles unicode in values", () => {
    const result = applyTemplateVariables("{{highlightTitle}}", {
      highlightTitle: "🎮精彩操作",
    });
    expect(result).toBe("🎮精彩操作");
  });

  it("handles empty context gracefully", () => {
    const emptyCtx: TemplateContext = {
      highlightTitle: "",
      roomName: "",
      date: "",
      uploadDate: "",
    };
    const result = renderTitleTemplate("{{highlightTitle}} - {{roomName}}", emptyCtx);
    // trimmed: "" - "" → trim() → "-"
    expect(result).toBe("-");
  });
});
