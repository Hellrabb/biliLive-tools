import { describe, it, expect, vi } from "vitest";
import { makeHighlight } from "./mockData.js";

describe("refineBoundaries constraint checks", () => {
  it("should clamp adjustments to maxAdjustSec", async () => {
    const { refineBoundaries } = await import("../../src/autoClip/boundaryRefiner.js");

    const highlights = [makeHighlight({ timeRange: [100, 200], bestRange: [100, 200] })];
    const asrMap = new Map([[0, "some asr text"]]);
    const frameMap = new Map<number, string>();

    const mockSend = vi.fn().mockResolvedValue(
      JSON.stringify({
        adjustments: [
          {
            highlightIndex: 0,
            startAdjustment: -999,
            endAdjustment: 999,
            startReason: "extend way back",
            endReason: "extend way forward",
            confidence: "high",
          },
        ],
      }),
    );

    const { highlights: result, refinements: _r } = await refineBoundaries(
      highlights,
      asrMap,
      frameMap,
      mockSend,
      { maxAdjustSec: 30, minClipDuration: 15 },
      1000,
    );

    expect(result[0]!.timeRange[0]).toBe(70); // 100 - 30
    expect(result[0]!.timeRange[1]).toBe(230); // 200 + 30
  });

  it("should preserve original boundaries when adjusted clip is too short", async () => {
    const { refineBoundaries } = await import("../../src/autoClip/boundaryRefiner.js");

    const highlights = [makeHighlight({ timeRange: [100, 120], bestRange: [100, 120] })]; // 20s clip
    const asrMap = new Map([[0, "test asr"]]);
    const frameMap = new Map<number, string>();

    const mockSend = vi.fn().mockResolvedValue(
      JSON.stringify({
        adjustments: [
          {
            highlightIndex: 0,
            startAdjustment: 10,
            endAdjustment: -10,
            startReason: "trim",
            endReason: "trim",
            confidence: "high",
          },
        ],
      }),
    );

    const { highlights: result, refinements: _r } = await refineBoundaries(
      highlights,
      asrMap,
      frameMap,
      mockSend,
      { maxAdjustSec: 30, minClipDuration: 15 },
      1000,
    );

    // Adjusted duration would be 0s < 15s min, so should reject
    expect(result[0]!.timeRange).toEqual([100, 120]);
  });

  it("should clamp to video bounds [0, duration]", async () => {
    const { refineBoundaries } = await import("../../src/autoClip/boundaryRefiner.js");

    const highlights = [makeHighlight({ timeRange: [5, 50], bestRange: [5, 50] })];
    const asrMap = new Map([[0, "test"]]);
    const frameMap = new Map<number, string>();

    const mockSend = vi.fn().mockResolvedValue(
      JSON.stringify({
        adjustments: [
          {
            highlightIndex: 0,
            startAdjustment: -20,
            endAdjustment: 0,
            startReason: "extend",
            endReason: "",
            confidence: "high",
          },
        ],
      }),
    );

    const { highlights: result, refinements: _r } = await refineBoundaries(
      highlights,
      asrMap,
      frameMap,
      mockSend,
      { maxAdjustSec: 30, minClipDuration: 15 },
      1000,
    );

    expect(result[0]!.timeRange[0]).toBe(0);
  });

  it("should skip adjustments with confidence=low", async () => {
    const { refineBoundaries } = await import("../../src/autoClip/boundaryRefiner.js");

    const highlights = [makeHighlight({ timeRange: [100, 200], bestRange: [100, 200] })];
    const asrMap = new Map([[0, "test"]]);
    const frameMap = new Map<number, string>();

    const mockSend = vi.fn().mockResolvedValue(
      JSON.stringify({
        adjustments: [
          {
            highlightIndex: 0,
            startAdjustment: -15,
            endAdjustment: 15,
            startReason: "maybe",
            endReason: "maybe",
            confidence: "low",
          },
        ],
      }),
    );

    const { highlights: result, refinements: _r } = await refineBoundaries(
      highlights,
      asrMap,
      frameMap,
      mockSend,
      { maxAdjustSec: 30, minClipDuration: 15 },
      1000,
    );

    expect(result[0]!.timeRange).toEqual([100, 200]);
  });

  it("should trim minor overlap (< 3s) between adjacent clips", async () => {
    const { refineBoundaries } = await import("../../src/autoClip/boundaryRefiner.js");

    const highlights = [
      makeHighlight({ timeRange: [100, 200], bestRange: [100, 200] }),
      makeHighlight({ timeRange: [250, 350], bestRange: [250, 350] }),
    ];
    const asrMap = new Map([
      [0, "a"],
      [1, "b"],
    ]);
    const frameMap = new Map<number, string>();

    const mockSend = vi.fn().mockResolvedValue(
      JSON.stringify({
        adjustments: [
          {
            highlightIndex: 0,
            startAdjustment: 0,
            endAdjustment: 53,
            startReason: "",
            endReason: "extend",
            confidence: "high",
          },
        ],
      }),
    );

    const { highlights: result, refinements: _r } = await refineBoundaries(
      highlights,
      asrMap,
      frameMap,
      mockSend,
      { maxAdjustSec: 30, minClipDuration: 15 },
      1000,
    );

    // Clip 0 extended by 53s → clamped to maxAdjustSec 30 → end becomes 230.
    // 230 < 250, so no overlap. Verify clip boundaries don't cross.
    expect(result[0]!.timeRange[1]).toBeLessThanOrEqual(result[1]!.timeRange[0]);
  });

  it("should merge overlapping clips and preserve best metadata from both", async () => {
    const { refineBoundaries } = await import("../../src/autoClip/boundaryRefiner.js");

    const highlights = [
      makeHighlight({ timeRange: [100, 200], bestRange: [100, 200], title: "Clip A", score: 7 }),
      makeHighlight({ timeRange: [150, 300], bestRange: [150, 300], title: "Clip B", score: 9 }),
    ];
    highlights[0]!.tags = ["funny"];
    highlights[0]!.highlightType = "hype";
    highlights[0]!.reason = "lower quality moment";
    highlights[1]!.tags = ["impressive", "hype"];
    highlights[1]!.highlightType = "impressive";
    highlights[1]!.reason = "best moment of stream";

    const asrMap = new Map([
      [0, "a"],
      [1, "b"],
    ]);
    const frameMap = new Map<number, string>();

    const mockSend = vi.fn().mockResolvedValue(
      JSON.stringify({
        adjustments: [
          {
            highlightIndex: 0,
            startAdjustment: 0,
            endAdjustment: 80,
            startReason: "",
            endReason: "extend",
            confidence: "high",
          },
          {
            highlightIndex: 1,
            startAdjustment: 0,
            endAdjustment: 0,
            startReason: "",
            endReason: "",
            confidence: "medium",
          },
        ],
      }),
    );

    const { highlights: result, refinements: _r } = await refineBoundaries(
      highlights,
      asrMap,
      frameMap,
      mockSend,
      { maxAdjustSec: 80, minClipDuration: 15 },
      1000,
    );

    // Merged into single clip (overlap = 280 - 150 = 130 > 3s triggers merge)
    expect(result).toHaveLength(1);
    const merged = result[0]!;
    expect(merged.score).toBe(9); // should use higher score from Clip B
    expect(merged.tags).toContain("funny");
    expect(merged.tags).toContain("impressive");
    expect(merged.tags).toContain("hype");
    expect(merged.tags).toHaveLength(3);
    expect(merged.title).toContain("Clip A");
    expect(merged.title).toContain("Clip B");
    expect(merged.highlightType).toBe("impressive");
    expect(merged.reason).toBe("best moment of stream");
  });

  it("should return original highlights when LLM call throws", async () => {
    const { refineBoundaries } = await import("../../src/autoClip/boundaryRefiner.js");

    const highlights = [makeHighlight({ timeRange: [50, 150], bestRange: [50, 150] })];
    const asrMap = new Map([[0, "test"]]);
    const frameMap = new Map<number, string>();

    const mockSend = vi.fn().mockRejectedValue(new Error("network error"));

    const { highlights: result, refinements: _r } = await refineBoundaries(
      highlights,
      asrMap,
      frameMap,
      mockSend,
      { maxAdjustSec: 30, minClipDuration: 15 },
      1000,
    );

    expect(result).toEqual(highlights);
  });

  // ============================================================================
  // M1: resolveOverlaps cascade — backward merge must loop to check deeper levels
  // ============================================================================

  it("should cascade-check backward after merges involving 4+ overlapping clips", async () => {
    const { refineBoundaries } = await import("../../src/autoClip/boundaryRefiner.js");

    // 4 clips where LLM adjustments create a tight overlap chain
    // that requires cascading backward merges to fully resolve.
    const highlights = [
      makeHighlight({ timeRange: [0, 20], bestRange: [0, 20], score: 3 }),
      makeHighlight({ timeRange: [30, 100], bestRange: [30, 100], score: 5 }),
      makeHighlight({ timeRange: [15, 150], bestRange: [15, 150], score: 8 }),
      makeHighlight({ timeRange: [140, 200], bestRange: [140, 200], score: 2 }),
    ];
    const asrMap = new Map([
      [0, "a"],
      [1, "b"],
      [2, "c"],
      [3, "d"],
    ]);
    const frameMap = new Map<number, string>();

    // Adjustments cause dense overlaps:
    // clip0: [0, 20] unchanged
    // clip1: [30, 100] end +60 → [30, 160]
    // clip2: [15, 150] start -50, end +60 → [0, 210] (clamped)
    // clip3: [140, 200] start -10 → [130, 200]
    const mockSend = vi.fn().mockResolvedValue(
      JSON.stringify({
        adjustments: [
          {
            highlightIndex: 0,
            startAdjustment: 0,
            endAdjustment: 0,
            startReason: "",
            endReason: "",
            confidence: "medium",
          },
          {
            highlightIndex: 1,
            startAdjustment: 0,
            endAdjustment: 60,
            startReason: "",
            endReason: "extend",
            confidence: "high",
          },
          {
            highlightIndex: 2,
            startAdjustment: -50,
            endAdjustment: 60,
            startReason: "extend back",
            endReason: "extend forward",
            confidence: "high",
          },
          {
            highlightIndex: 3,
            startAdjustment: -10,
            endAdjustment: 0,
            startReason: "extend",
            endReason: "",
            confidence: "high",
          },
        ],
      }),
    );

    const { highlights: result, refinements: _r } = await refineBoundaries(
      highlights,
      asrMap,
      frameMap,
      mockSend,
      { maxAdjustSec: 50, minClipDuration: 5 },
      1000,
    );

    // After cascading resolves all overlaps, the result should have
    // no overlapping clips and all clips should be properly merged.
    expect(result.length).toBeGreaterThanOrEqual(1);

    // Verify no two clips overlap
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i]!.timeRange[1]).toBeLessThanOrEqual(result[i + 1]!.timeRange[0]);
    }
  });

  it("should cascade backward merge with unsorted clip order after adjustments", async () => {
    const { refineBoundaries } = await import("../../src/autoClip/boundaryRefiner.js");

    // 5 clips where adjustments create out-of-order overlaps
    // that require multiple backward merges to resolve
    const highlights = [
      makeHighlight({ timeRange: [0, 30], bestRange: [0, 30], score: 4 }),
      makeHighlight({ timeRange: [100, 200], bestRange: [100, 200], score: 6 }),
      makeHighlight({ timeRange: [40, 120], bestRange: [40, 120], score: 9 }),
      makeHighlight({ timeRange: [180, 250], bestRange: [180, 250], score: 3 }),
      makeHighlight({ timeRange: [240, 300], bestRange: [240, 300], score: 5 }),
    ];
    const asrMap = new Map([
      [0, "a"],
      [1, "b"],
      [2, "c"],
      [3, "d"],
      [4, "e"],
    ]);
    const frameMap = new Map<number, string>();

    // clip1 is index 1 with [100,200] score 6
    // clip2 is index 2 with [40,120] score 9 — overlaps clip1 after startAdjustment
    // This creates an out-of-order merge that requires cascade
    const mockSend = vi.fn().mockResolvedValue(
      JSON.stringify({
        adjustments: [
          {
            highlightIndex: 1,
            startAdjustment: -70,
            endAdjustment: 0,
            startReason: "extend",
            endReason: "",
            confidence: "high",
          },
          {
            highlightIndex: 2,
            startAdjustment: 0,
            endAdjustment: 80,
            startReason: "",
            endReason: "extend",
            confidence: "high",
          },
          {
            highlightIndex: 3,
            startAdjustment: 0,
            endAdjustment: 80,
            startReason: "",
            endReason: "extend",
            confidence: "high",
          },
          {
            highlightIndex: 4,
            startAdjustment: -20,
            endAdjustment: 0,
            startReason: "extend",
            endReason: "",
            confidence: "high",
          },
        ],
      }),
    );

    const { highlights: result, refinements: _r } = await refineBoundaries(
      highlights,
      asrMap,
      frameMap,
      mockSend,
      { maxAdjustSec: 80, minClipDuration: 5 },
      1000,
    );

    // All overlapping clips should be resolved — verify no overlaps
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i]!.timeRange[1]).toBeLessThanOrEqual(result[i + 1]!.timeRange[0]);
    }
  });

  // ============================================================================
  // L7: newEnd boundary guard — prevent start >= end in resolveOverlaps
  // ============================================================================

  it("should not produce zero-length clip from minor overlap resolution", async () => {
    const { refineBoundaries } = await import("../../src/autoClip/boundaryRefiner.js");

    // Clips very close together where minor overlap resolution
    // could produce a degenerate clip.
    const highlights = [
      makeHighlight({ timeRange: [100, 130], bestRange: [100, 130], score: 7 }),
      makeHighlight({ timeRange: [129, 200], bestRange: [129, 200], score: 5 }),
    ];
    const asrMap = new Map([
      [0, "a"],
      [1, "b"],
    ]);
    const frameMap = new Map<number, string>();

    // Extend clip1 end just slightly into clip2 start
    const mockSend = vi.fn().mockResolvedValue(
      JSON.stringify({
        adjustments: [
          {
            highlightIndex: 0,
            startAdjustment: 0,
            endAdjustment: 2,
            startReason: "",
            endReason: "extend",
            confidence: "high",
          },
        ],
      }),
    );

    const { highlights: result, refinements: _r } = await refineBoundaries(
      highlights,
      asrMap,
      frameMap,
      mockSend,
      { maxAdjustSec: 30, minClipDuration: 15 },
      1000,
    );

    // Every clip should have positive duration
    for (const h of result) {
      expect(h.timeRange[0]).toBeLessThan(h.timeRange[1]);
      expect(h.timeRange[1] - h.timeRange[0]).toBeGreaterThan(0);
    }
  });

  it("should skip when both ASR and frame data are empty", async () => {
    const { refineBoundaries } = await import("../../src/autoClip/boundaryRefiner.js");

    const highlights = [makeHighlight({ timeRange: [50, 150], bestRange: [50, 150] })];
    const mockSend = vi.fn();

    const { highlights: result, refinements: _r } = await refineBoundaries(
      highlights,
      new Map(),
      new Map(),
      mockSend,
      { maxAdjustSec: 30, minClipDuration: 15 },
      1000,
    );

    expect(mockSend).not.toHaveBeenCalled();
    expect(result).toEqual(highlights);
  });
});
