import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  validateAndNormalizeHighlight,
  resolveSavePath,
  resolveExportPresets,
} from "../../src/autoClip/exportPipeline";
import { makeHighlight } from "./mockData";

// ============================================================================
// validateAndNormalizeHighlight tests
// ============================================================================

describe("validateAndNormalizeHighlight", () => {
  it("returns normalized object for valid HighlightSegment", () => {
    const h = makeHighlight();
    const result = validateAndNormalizeHighlight(h);
    expect(result).toBeTruthy();
    expect(typeof result).toBe("object");
    if (result && typeof result === "object") {
      expect(result.bestRange).toEqual([125, 295]);
      expect(result.timeRange).toEqual([120, 300]);
      expect(result.score).toBe(8);
      expect(result.title).toBe("Test Highlight");
    }
  });

  it("patches missing fields to defaults in returned object", () => {
    const h = {
      timeRange: [0, 100] as [number, number],
      bestRange: [10, 90] as [number, number],
    };
    const result = validateAndNormalizeHighlight(h);
    expect(result).toBeTruthy();
    expect(typeof result).toBe("object");
    if (result && typeof result === "object") {
      expect(result.score).toBe(5);
      expect(result.title).toBe("Untitled");
      expect(result.tags).toEqual([]);
      expect(result.highlightType).toBe("hype");
      expect(result.reason).toBe("");
      expect(result.signalSources).toEqual([]);
      expect(result.isHighlight).toBe(true);
    }
  });

  it("returns false for null / non-object", () => {
    expect(validateAndNormalizeHighlight(null)).toBe(false);
    expect(validateAndNormalizeHighlight(undefined)).toBe(false);
    expect(validateAndNormalizeHighlight(42)).toBe(false);
    expect(validateAndNormalizeHighlight("string")).toBe(false);
  });

  it("returns false when bestRange is missing or invalid", () => {
    expect(validateAndNormalizeHighlight({ timeRange: [0, 60] })).toBe(false);
    expect(validateAndNormalizeHighlight({ timeRange: [0, 60], bestRange: [0] })).toBe(false);
    expect(validateAndNormalizeHighlight({ timeRange: [0, 60], bestRange: [NaN, 60] })).toBe(false);
    expect(validateAndNormalizeHighlight({ timeRange: [0, 60], bestRange: [0, Infinity] })).toBe(
      false,
    );
  });

  it("returns false when timeRange is missing", () => {
    expect(validateAndNormalizeHighlight({ bestRange: [0, 60] })).toBe(false);
  });

  // ------------------------------------------------------------------
  // M7: In-place mutation — MUST NOT mutate the input object
  // ------------------------------------------------------------------

  it("does NOT mutate input when fields are missing (M7)", () => {
    const input = {
      timeRange: [0, 100] as [number, number],
      bestRange: [10, 90] as [number, number],
      // score, title, tags intentionally missing
    };

    const snapshot = JSON.stringify(input);
    const result = validateAndNormalizeHighlight(input);

    expect(result).toBeTruthy();
    expect(JSON.stringify(input)).toBe(snapshot);
    expect((input as any).score).toBeUndefined();
    expect((input as any).title).toBeUndefined();
    expect((input as any).tags).toBeUndefined();
  });

  it("does NOT mutate input when all fields are present (M7)", () => {
    const input = {
      timeRange: [0, 100] as [number, number],
      bestRange: [10, 90] as [number, number],
      score: 7,
      title: "Original Title",
      tags: ["funny"],
      highlightType: "hype" as const,
      reason: "good",
      signalSources: ["density"],
      isHighlight: true,
    };

    const snapshot = JSON.stringify(input);
    validateAndNormalizeHighlight(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("does NOT mutate input when score is non-numeric (M7)", () => {
    const input = {
      timeRange: [0, 100] as [number, number],
      bestRange: [10, 90] as [number, number],
      score: "not_a_number",
      title: "Valid Title",
    };

    const snapshot = JSON.stringify(input);
    validateAndNormalizeHighlight(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    // Old buggy code would have mutated score to NaN in-place
    expect((input as any).score).toBe("not_a_number");
  });

  it("does NOT mutate input when title is non-string (M7)", () => {
    const input = {
      timeRange: [0, 100] as [number, number],
      bestRange: [10, 90] as [number, number],
      score: 5,
      title: 12345, // non-string
    };

    const snapshot = JSON.stringify(input);
    validateAndNormalizeHighlight(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect((input as any).title).toBe(12345);
  });
});

// ============================================================================
// resolveSavePath tests
// ============================================================================

describe("resolveSavePath", () => {
  it("uses exportConfig.savePath when provided", () => {
    expect(resolveSavePath({ savePath: "/custom/save" }, "/video/test.mp4")).toBe("/custom/save");
  });

  it("falls back to video directory when savePath is empty string", () => {
    expect(resolveSavePath({ savePath: "" }, "/videos/stream/test.mp4")).toBe("/videos/stream");
  });

  it("falls back when savePath is undefined", () => {
    expect(resolveSavePath({}, "/videos/stream/test.mp4")).toBe("/videos/stream");
  });
});

// ============================================================================
// resolveExportPresets
// ============================================================================

describe("resolveExportPresets", () => {
  it("returns empty context when no preset IDs are set", async () => {
    const result = await resolveExportPresets({});
    expect(result).toEqual({});
  });
});

// ============================================================================
// doExportClips timer lifecycle (H1) & signal propagation (L3)
// ============================================================================
// These behaviors are verified structurally via code review:
//
// H1: exportsignal setup (lines 420-427) moved from before the try block
//     to INSIDE the try block, after updateStatus (line 462). The finally
//     block already handles clearTimeout. This ensures:
//     - If sync code (import, updateStatus) throws, no timer is created
//     - If async code in try throws, finally clears the timer
//
// L3: signal parameter is now passed through to tryLoadExportConfig so
//     abort signals are propagated to all async operations.
//
// L1: Danmaku task completion race (exportClips, lines 135-139) —
//     check task.status immediately after listener registration to avoid
//     missing already-completed tasks.
//
// L2: ASS cleanup race (exportClips, lines 297-304) —
//     add 100ms delay before unlinking temp ASS file so ffmpeg can
//     release the file handle; wrap unlink in try/catch ignoring ENOENT.
//
// L4: Double DI import (resolveExportPresets, lines 31-76) —
//     extract await import("../index.js") to a module/closure-level
//     cached variable instead of importing twice.
// ============================================================================
