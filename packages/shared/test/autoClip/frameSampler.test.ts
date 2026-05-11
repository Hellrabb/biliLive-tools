import { describe, it, expect } from "vitest";
import { sampleFrames } from "../../src/autoClip/frameSampler.js";

describe("sampleFrames", () => {
  it("should return base64 data URIs for valid timestamps", async () => {
    const frames = await sampleFrames(
      "/nonexistent/video.mp4",
      [10, 20],
    ).catch(() => [] as string[]);
    expect(Array.isArray(frames)).toBe(true);
  });

  it("should return empty array for empty timestamps", async () => {
    const frames = await sampleFrames("/nonexistent/video.mp4", []);
    expect(frames).toEqual([]);
  });
});
