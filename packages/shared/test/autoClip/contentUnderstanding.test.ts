import { describe, it, expect, vi, beforeEach } from "vitest";
import { understandContent, extractAudioSegment } from "../../src/autoClip/contentUnderstanding.js";
import type { AutoClipEnhancementConfig } from "@biliLive-tools/types";
import { makeHighlight } from "./mockData.js";

// ---------------------------------------------------------------------------
// Mocks for extractAudioSegment tests (H5, M3)
// ---------------------------------------------------------------------------

const { mockSpawn, mockExistsSync } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockExistsSync: vi.fn(() => true),
}));

vi.mock("node:child_process", () => ({
  spawn: mockSpawn,
}));

vi.mock("node:fs", () => {
  const actual = { ...(vi.importActual?.("node:fs") ?? {}) } as any;
  return {
    ...actual,
    existsSync: mockExistsSync,
  };
});

// Fake WAV bytes for mock ffmpeg output
const FAKE_WAV = Buffer.from([0x52, 0x49, 0x46, 0x46]); // "RIFF" header

function createMockProc(opts: {
  exitCode?: number;
  stdoutChunks?: Buffer[];
  stderr?: string;
  emitError?: Error;
  /** fire close event AFTER error event (simulates double-event for M3) */
  fireCloseAfterError?: boolean;
}) {
  const {
    exitCode = 0,
    stdoutChunks = [FAKE_WAV],
    stderr = "",
    emitError,
    fireCloseAfterError = false,
  } = opts;

  const listeners: Record<string, Array<(...args: any[]) => void>> = {};

  const proc = {
    stdout: {
      on: vi.fn((event: string, fn: (...args: any[]) => void) => {
        if (!listeners[`stdout:${event}`]) listeners[`stdout:${event}`] = [];
        listeners[`stdout:${event}`].push(fn);
      }),
    },
    stderr: {
      on: vi.fn((event: string, fn: (...args: any[]) => void) => {
        if (!listeners[`stderr:${event}`]) listeners[`stderr:${event}`] = [];
        listeners[`stderr:${event}`].push(fn);
      }),
    },
    on: vi.fn((event: string, fn: (...args: any[]) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    }),
    kill: vi.fn(),
    stdin: null,
    pid: 12345,
  };

  // Schedule the simulated process lifecycle
  queueMicrotask(() => {
    if (emitError) {
      listeners["error"]?.forEach((fn) => fn(emitError));
      if (fireCloseAfterError) {
        listeners["close"]?.forEach((fn) => fn(exitCode));
      }
      return;
    }

    // Deliver stdout data chunks
    for (const chunk of stdoutChunks) {
      listeners["stdout:data"]?.forEach((fn) => fn(chunk));
    }

    // Deliver stderr
    if (stderr) {
      listeners["stderr:data"]?.forEach((fn) => fn(Buffer.from(stderr)));
    }

    // Emit close
    listeners["close"]?.forEach((fn) => fn(exitCode));
  });

  return proc;
}

// p-limit: passthrough (no concurrency in tests)
vi.mock("p-limit", () => ({
  default: () => (fn: () => unknown) => fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(true);
});

// ============================================================================
// understandContent (existing tests)
// ============================================================================

describe("understandContent", () => {
  it("should return empty maps when both ASR and visual disabled", async () => {
    const config: AutoClipEnhancementConfig = { asrEnabled: false, visualEnabled: false };
    const result = await understandContent("/nonexistent/video.mp4", [makeHighlight()], config, {});
    expect(result.asrMap.size).toBe(0);
    expect(result.frameMap.size).toBe(0);
  });

  it("should skip ASR when no recognizeASR provided", async () => {
    const config: AutoClipEnhancementConfig = { asrEnabled: true, visualEnabled: false };
    const result = await understandContent("/nonexistent/video.mp4", [makeHighlight()], config, {});
    expect(result.asrMap.size).toBe(0);
  });

  it("should call recognizeASR when enabled and provided", async () => {
    const config: AutoClipEnhancementConfig = { asrEnabled: true, visualEnabled: false };
    let calledWith = "";
    const result = await understandContent("/nonexistent/video.mp4", [makeHighlight()], config, {
      recognizeASR: async (audioPath: string) => {
        calledWith = audioPath;
        return { text: "主播完成反杀" };
      },
      extractAudio: async (_videoPath?: string, _range?: [number, number], _signal?: AbortSignal) =>
        "/tmp/test.wav",
    });
    expect(result.asrMap.get(0)).toBe("主播完成反杀");
    expect(calledWith).toBe("/tmp/test.wav");
  });

  it("should send frames to multimodal when visual enabled", async () => {
    const config: AutoClipEnhancementConfig = { asrEnabled: false, visualEnabled: true };
    const capturedFrames: string[][] = [];
    const result = await understandContent("/nonexistent/video.mp4", [makeHighlight()], config, {
      sendMultimodalMessage: async (_prompt, images) => {
        capturedFrames.push(images);
        return "一场激烈的团战";
      },
      sampleFrames: async () => ["data:image/jpeg;base64,xx"],
    });
    expect(result.frameMap.get(0)).toBe("一场激烈的团战");
    expect(capturedFrames.length).toBe(1);
  });

  it("should continue processing remaining highlights after one fails", async () => {
    const config: AutoClipEnhancementConfig = { asrEnabled: true, visualEnabled: false };
    const highlights = [makeHighlight({ score: 9 }), makeHighlight({ score: 5 })];
    let callCount = 0;
    const result = await understandContent("/nonexistent/video.mp4", highlights, config, {
      recognizeASR: async () => {
        callCount++;
        if (callCount === 1) throw new Error("ASR failed");
        return { text: "成功" };
      },
      extractAudio: async (_videoPath?: string, _range?: [number, number], _signal?: AbortSignal) =>
        "/tmp/test.wav",
    });
    expect(result.asrMap.get(0)).toBeUndefined();
    expect(result.asrMap.get(1)).toBe("成功");
  });

  it("should handle empty highlights array", async () => {
    const config: AutoClipEnhancementConfig = { asrEnabled: true, visualEnabled: true };
    const result = await understandContent("/nonexistent/video.mp4", [], config, {});
    expect(result.asrMap.size).toBe(0);
    expect(result.frameMap.size).toBe(0);
  });
});

// ============================================================================
// extractAudioSegment (H5, M3 tests)
// ============================================================================

describe("extractAudioSegment", () => {
  it("resolves outputPath on successful ffmpeg extraction", async () => {
    mockSpawn.mockReturnValue(createMockProc({ exitCode: 0, stdoutChunks: [FAKE_WAV] }));

    const promise = extractAudioSegment("/fake/video.mp4", [0, 30]);
    const outputPath = await promise;

    expect(outputPath).toContain("autoclip_asr_");
    expect(outputPath).toContain(".wav");
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it("rejects when ffmpeg exits with non-zero code", async () => {
    mockSpawn.mockReturnValue(
      createMockProc({ exitCode: 1, stderr: "ffmpeg error output", stdoutChunks: [] }),
    );

    const promise = extractAudioSegment("/fake/video.mp4", [0, 30]);
    await expect(promise).rejects.toThrow(/Audio extraction failed/);
  });

  it("rejects when ffmpeg spawn emits an error", async () => {
    const spawnError = new Error("ENOENT");
    mockSpawn.mockReturnValue(createMockProc({ emitError: spawnError }));

    const promise = extractAudioSegment("/fake/video.mp4", [0, 30]);
    await expect(promise).rejects.toThrow("ENOENT");
  });

  // ---------------------------------------------------------------------------
  // H5: Abort resolves deleted file
  // ---------------------------------------------------------------------------

  it("rejects when ffmpeg exits code 0 but output file does not exist (H5)", async () => {
    mockSpawn.mockReturnValue(createMockProc({ exitCode: 0, stdoutChunks: [FAKE_WAV] }));
    // Simulate: file was deleted (e.g. by abort handler)
    mockExistsSync.mockReturnValue(false);

    const promise = extractAudioSegment("/fake/video.mp4", [0, 30]);
    await expect(promise).rejects.toThrow(/Audio extraction.*file.*missing|not exist/i);
  });

  it("resolves when ffmpeg exits code 0 and output file exists (H5 - happy path)", async () => {
    mockSpawn.mockReturnValue(createMockProc({ exitCode: 0, stdoutChunks: [FAKE_WAV] }));
    mockExistsSync.mockReturnValue(true);

    const outputPath = await extractAudioSegment("/fake/video.mp4", [0, 30]);
    expect(outputPath).toContain(".wav");
  });

  // ---------------------------------------------------------------------------
  // M3: Double reject guard
  // ---------------------------------------------------------------------------

  it("settles only once when both error and close fire (M3)", async () => {
    const spawnError = new Error("ENOENT");
    mockSpawn.mockReturnValue(
      createMockProc({
        emitError: spawnError,
        fireCloseAfterError: true,
        exitCode: -1,
      }),
    );

    const promise = extractAudioSegment("/fake/video.mp4", [0, 30]);
    // Should reject with the FIRST error (ENOENT), not the close error
    await expect(promise).rejects.toThrow("ENOENT");
  });

  it("handles abort without double settle (M3)", async () => {
    const proc = createMockProc({ exitCode: 0, stdoutChunks: [FAKE_WAV] });
    mockSpawn.mockReturnValue(proc);

    // After abort, the file is deleted by the abort handler's unlink.
    // Simulate this by returning false from existsSync.
    mockExistsSync.mockReturnValue(false);

    const controller = new AbortController();
    const promise = extractAudioSegment("/fake/video.mp4", [0, 30], "ffmpeg", controller.signal);

    // Abort before close fires
    controller.abort();

    // After abort, the process is killed and file is unlinked (existsSync=false).
    // The close handler should reject because the output file is missing (H5 guard).
    await expect(promise).rejects.toThrow(/output file missing|not exist/i);
    expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
  });
});
