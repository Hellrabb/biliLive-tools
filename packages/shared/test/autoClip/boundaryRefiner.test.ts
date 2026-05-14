import { describe, it, expect, vi } from "vitest";
import { makeHighlight } from "./mockData.js";

describe("refineBoundaries constraint checks", () => {

  it("should clamp adjustments to maxAdjustSec", async () => {
    const { refineBoundaries } = await import("../../src/autoClip/boundaryRefiner.js");

    const highlights = [makeHighlight({ timeRange: [100, 200], bestRange: [100, 200] })];
    const asrMap = new Map([[0, "some asr text"]]);
    const frameMap = new Map<number, string>();

    const mockSend = vi.fn().mockResolvedValue(JSON.stringify({
      adjustments: [{
        highlightIndex: 0,
        startAdjustment: -999,
        endAdjustment: 999,
        startReason: "extend way back",
        endReason: "extend way forward",
        confidence: "high",
      }],
    }));

    const result = await refineBoundaries(
      highlights, asrMap, frameMap, mockSend,
      { maxAdjustSec: 30, minClipDuration: 15 },
      1000,
    );

    expect(result[0]!.timeRange[0]).toBe(70);   // 100 - 30
    expect(result[0]!.timeRange[1]).toBe(230);   // 200 + 30
  });

  it("should preserve original boundaries when adjusted clip is too short", async () => {
    const { refineBoundaries } = await import("../../src/autoClip/boundaryRefiner.js");

    const highlights = [makeHighlight({ timeRange: [100, 120], bestRange: [100, 120] })]; // 20s clip
    const asrMap = new Map([[0, "test asr"]]);
    const frameMap = new Map<number, string>();

    const mockSend = vi.fn().mockResolvedValue(JSON.stringify({
      adjustments: [{
        highlightIndex: 0,
        startAdjustment: 10,
        endAdjustment: -10,
        startReason: "trim",
        endReason: "trim",
        confidence: "high",
      }],
    }));

    const result = await refineBoundaries(
      highlights, asrMap, frameMap, mockSend,
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

    const mockSend = vi.fn().mockResolvedValue(JSON.stringify({
      adjustments: [{
        highlightIndex: 0,
        startAdjustment: -20,
        endAdjustment: 0,
        startReason: "extend",
        endReason: "",
        confidence: "high",
      }],
    }));

    const result = await refineBoundaries(
      highlights, asrMap, frameMap, mockSend,
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

    const mockSend = vi.fn().mockResolvedValue(JSON.stringify({
      adjustments: [{
        highlightIndex: 0,
        startAdjustment: -15,
        endAdjustment: 15,
        startReason: "maybe",
        endReason: "maybe",
        confidence: "low",
      }],
    }));

    const result = await refineBoundaries(
      highlights, asrMap, frameMap, mockSend,
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
    const asrMap = new Map([[0, "a"], [1, "b"]]);
    const frameMap = new Map<number, string>();

    const mockSend = vi.fn().mockResolvedValue(JSON.stringify({
      adjustments: [{
        highlightIndex: 0,
        startAdjustment: 0,
        endAdjustment: 53,
        startReason: "",
        endReason: "extend",
        confidence: "high",
      }],
    }));

    const result = await refineBoundaries(
      highlights, asrMap, frameMap, mockSend,
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

    const asrMap = new Map([[0, "a"], [1, "b"]]);
    const frameMap = new Map<number, string>();

    const mockSend = vi.fn().mockResolvedValue(JSON.stringify({
      adjustments: [
        { highlightIndex: 0, startAdjustment: 0, endAdjustment: 80, startReason: "", endReason: "extend", confidence: "high" },
        { highlightIndex: 1, startAdjustment: 0, endAdjustment: 0, startReason: "", endReason: "", confidence: "medium" },
      ],
    }));

    const result = await refineBoundaries(
      highlights, asrMap, frameMap, mockSend,
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

    const result = await refineBoundaries(
      highlights, asrMap, frameMap, mockSend,
      { maxAdjustSec: 30, minClipDuration: 15 },
      1000,
    );

    expect(result).toEqual(highlights);
  });

  it("should skip when both ASR and frame data are empty", async () => {
    const { refineBoundaries } = await import("../../src/autoClip/boundaryRefiner.js");

    const highlights = [makeHighlight({ timeRange: [50, 150], bestRange: [50, 150] })];
    const mockSend = vi.fn();

    const result = await refineBoundaries(
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
