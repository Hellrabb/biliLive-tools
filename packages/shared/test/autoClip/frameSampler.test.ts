import { describe, it, expect, vi, beforeEach } from "vitest";
import { sampleFrames } from "../../src/autoClip/frameSampler.js";

// vi.mock is hoisted above imports, so factory cannot reference top-level
// variables. Use vi.hoisted() to lift the mock reference.
const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: mockSpawn,
}));

// p-limit: passthrough (no concurrency in tests)
vi.mock("p-limit", () => ({
  default: () => (fn: () => unknown) => fn(),
}));

// Fake JPEG bytes for the mock ffmpeg output
const FAKE_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const FAKE_BASE64 = `data:image/jpeg;base64,${FAKE_JPEG.toString("base64")}`;

function createMockProc(opts: {
  exitCode?: number;
  stdoutChunks?: Buffer[];
  stderr?: string;
  emitError?: Error;
}) {
  const {
    exitCode = 0,
    stdoutChunks = [FAKE_JPEG],
    stderr = "",
    emitError,
  } = opts;

  const listeners: Record<string, Array<(...args: any[]) => void>> = {};

  // Simulate spawn returning a ChildProcess-like object
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
    stdin: null, // matches spawn() signature but unused
    pid: 12345,
  };

  // Schedule the simulated process lifecycle
  queueMicrotask(() => {
    if (emitError) {
      listeners["error"]?.forEach((fn) => fn(emitError));
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sampleFrames", () => {
  it("returns empty array for empty timestamps", async () => {
    const frames = await sampleFrames("/nonexistent/video.mp4", []);
    expect(frames).toEqual([]);
    // spawn should not be called for empty timestamps
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("returns base64 data URIs on successful ffmpeg extraction", async () => {
    mockSpawn.mockReturnValue(createMockProc({ exitCode: 0, stdoutChunks: [FAKE_JPEG] }));

    const frames = await sampleFrames("/fake/video.mp4", [10]);
    expect(frames).toEqual([FAKE_BASE64]);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it("returns multiple base64 URIs for multiple timestamps", async () => {
    mockSpawn.mockReturnValue(createMockProc({ exitCode: 0, stdoutChunks: [FAKE_JPEG] }));

    const frames = await sampleFrames("/fake/video.mp4", [10, 20, 30]);
    expect(frames).toHaveLength(3);
    expect(frames.every((f) => f === FAKE_BASE64)).toBe(true);
    expect(mockSpawn).toHaveBeenCalledTimes(3);
  });

  it("omits frames where ffmpeg exits with non-zero code", async () => {
    const successProc = createMockProc({ exitCode: 0, stdoutChunks: [FAKE_JPEG] });
    const failProc = createMockProc({ exitCode: 1, stderr: "error" });

    mockSpawn
      .mockReturnValueOnce(successProc)
      .mockReturnValueOnce(failProc)
      .mockReturnValueOnce(successProc);

    const frames = await sampleFrames("/fake/video.mp4", [10, 20, 30]);
    expect(frames).toHaveLength(2); // middle one failed
    expect(mockSpawn).toHaveBeenCalledTimes(3);
  });

  it("omits frames where ffmpeg spawn emits an error", async () => {
    const successProc = createMockProc({ exitCode: 0, stdoutChunks: [FAKE_JPEG] });
    const errorProc = createMockProc({ emitError: new Error("ENOENT") });

    mockSpawn
      .mockReturnValueOnce(successProc)
      .mockReturnValueOnce(errorProc);

    const frames = await sampleFrames("/fake/video.mp4", [10, 20]);
    expect(frames).toHaveLength(1);
  });

  it("passes correct ffmpeg args for frame extraction", async () => {
    mockSpawn.mockReturnValue(createMockProc({ exitCode: 0, stdoutChunks: [FAKE_JPEG] }));

    await sampleFrames("/my/video.mp4", [42.5]);

    const [ffmpegPath, args, options] = mockSpawn.mock.calls[0];
    expect(ffmpegPath).toBe("ffmpeg");
    expect(args).toContain("-ss");
    expect(args).toContain("42.5");
    expect(args).toContain("-i");
    expect(args).toContain("/my/video.mp4");
    expect(args).toContain("-vframes");
    expect(args).toContain("1");
    expect(args).toContain("-f");
    expect(args).toContain("image2pipe");
    expect(args).toContain("-vcodec");
    expect(args).toContain("mjpeg");
    expect(options.stdio).toEqual(["ignore", "pipe", "pipe"]);
  });

  it("uses custom ffmpeg path when provided", async () => {
    mockSpawn.mockReturnValue(createMockProc({ exitCode: 0, stdoutChunks: [FAKE_JPEG] }));

    await sampleFrames("/my/video.mp4", [5], "/custom/ffmpeg");

    expect(mockSpawn.mock.calls[0][0]).toBe("/custom/ffmpeg");
  });
});
