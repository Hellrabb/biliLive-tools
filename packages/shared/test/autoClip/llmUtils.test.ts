import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendWithTimeout } from "../../src/autoClip/llmUtils";

// Mock constants to use a short timeout for fast tests
vi.mock("../../src/autoClip/constants.js", () => ({
  LLM_CONCURRENCY: 3,
  LLM_REQUEST_TIMEOUT_MS: 100,
}));

// ============================================================================
// Tests that do NOT use fake timers
// ============================================================================

describe("sendWithTimeout (real timers)", () => {
  it("resolves when call completes before timeout", async () => {
    const sendMessage = vi.fn().mockResolvedValue("hello world");

    const result = await sendWithTimeout(sendMessage, "test prompt", { timeoutMs: 5000 });

    expect(result).toBe("hello world");
    expect(sendMessage).toHaveBeenCalledWith("test prompt", expect.any(AbortSignal));
  });

  it("rejects immediately when external signal already aborted", async () => {
    const externalController = new AbortController();
    externalController.abort(); // already aborted

    const sendMessage = vi.fn();

    await expect(
      sendWithTimeout(sendMessage, "test prompt", {
        timeoutMs: 5000,
        externalSignal: externalController.signal,
      }),
    ).rejects.toThrow("AutoClip pipeline aborted");

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("accepts timeout as a plain number (backward-compatible)", async () => {
    const sendMessage = vi.fn().mockResolvedValue("fast response");

    const result = await sendWithTimeout(sendMessage, "prompt", 5000);
    expect(result).toBe("fast response");
  });

  it("propagates non-AbortError errors from sendMessage", async () => {
    const sendMessage = vi.fn().mockImplementation(() => {
      return Promise.reject(new Error("Network failure"));
    });

    await expect(
      sendWithTimeout(sendMessage, "test prompt", { timeoutMs: 5000 }),
    ).rejects.toThrow("Network failure");
  });

  it("passes through AbortError when not caused by internal controller", async () => {
    const abortErr = new Error("The operation was aborted");
    abortErr.name = "AbortError";
    const sendMessage = vi.fn().mockImplementation(() => {
      return Promise.reject(abortErr);
    });

    // Signal is NOT aborted here, so the error passes through unchanged
    await expect(
      sendWithTimeout(sendMessage, "test prompt", { timeoutMs: 5000 }),
    ).rejects.toThrow("The operation was aborted");
  });

  it("passes internal AbortSignal to sendMessage", async () => {
    let capturedSignal: AbortSignal | undefined;
    const sendMessage = vi.fn().mockImplementation(
      (_prompt: string, signal?: AbortSignal) => {
        capturedSignal = signal;
        return Promise.resolve("ok");
      },
    );

    const result = await sendWithTimeout(sendMessage, "test prompt", { timeoutMs: 5000 });

    expect(result).toBe("ok");
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(false);
  });

  it("rejects with abort error when external signal fires", async () => {
    const externalController = new AbortController();
    const sendMessage = vi.fn().mockImplementation(
      () => new Promise<string>(() => {
        // never resolves
      }),
    );

    const promise = sendWithTimeout(sendMessage, "test prompt", {
      timeoutMs: 5000,
      externalSignal: externalController.signal,
    });

    // Fire external signal after a microtask
    await new Promise((r) => setTimeout(r, 0));
    externalController.abort();

    await expect(promise).rejects.toThrow("AutoClip pipeline aborted");
  });
});

// ============================================================================
// Tests that use fake timers (timeout timing logic only)
// ============================================================================

describe("sendWithTimeout (fake timers)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects with timeout error when call exceeds timeout", async () => {
    const sendMessage = vi.fn().mockImplementation(
      () => new Promise<string>(() => {
        // never resolves
      }),
    );

    const promise = sendWithTimeout(sendMessage, "test prompt", { timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(0);

    vi.advanceTimersByTime(100);

    await expect(promise).rejects.toThrow("LLM request timeout");
  });

  it("cleans up timer when external signal fires before timeout", async () => {
    const externalController = new AbortController();
    const sendMessage = vi.fn().mockImplementation(
      () => new Promise<string>(() => {
        // never resolves
      }),
    );

    const promise = sendWithTimeout(sendMessage, "test prompt", {
      timeoutMs: 500,
      externalSignal: externalController.signal,
    });
    await vi.advanceTimersByTimeAsync(0);

    // Fire external signal before timeout; catch rejection immediately
    const rejectionCatcher = promise.catch(() => {});
    externalController.abort();
    await vi.advanceTimersByTimeAsync(0);

    await expect(promise).rejects.toThrow("AutoClip pipeline aborted");

    // Advance far past the original timeout — should NOT trigger second rejection
    vi.advanceTimersByTime(1000);
  });

  it("only settles once when both timeout and external signal fire near-simultaneously", async () => {
    const externalController = new AbortController();
    const sendMessage = vi.fn().mockImplementation(
      () => new Promise<string>(() => {
        // never resolves
      }),
    );

    const promise = sendWithTimeout(sendMessage, "test prompt", {
      timeoutMs: 100,
      externalSignal: externalController.signal,
    });
    await vi.advanceTimersByTimeAsync(0);

    // Pre-attach a catch to prevent unhandled rejection
    const caught = promise.catch(() => {});

    // Fire both at the same time
    externalController.abort();
    vi.advanceTimersByTime(100);

    // Should reject exactly once
    await expect(promise).rejects.toThrow();
  });
});

// ============================================================================
// sendWithTimeout AbortError handling (controller.signal.aborted check)
// ============================================================================

describe("sendWithTimeout AbortError handling", () => {
  it("reports 'LLM request timeout' when internal AbortController triggers abort", async () => {
    const sendMessage = (_prompt: string, signal?: AbortSignal) =>
      new Promise<string>((_, reject) => {
        const onAbort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        signal?.addEventListener("abort", onAbort);
      });

    const promise = sendWithTimeout(sendMessage, "test", { timeoutMs: 10 });
    await expect(promise).rejects.toThrow("LLM request timeout");
  });

  it("passes through AbortError when not caused by internal controller", async () => {
    const sendMessage = (_prompt: string, _signal?: AbortSignal) => {
      const err = Object.assign(new Error("fetch aborted by network"), { name: "AbortError" });
      return Promise.reject(err);
    };

    const promise = sendWithTimeout(sendMessage, "test", { timeoutMs: 30000 });
    await expect(promise).rejects.toThrow("fetch aborted by network");
  });

  it("rejects with 'AutoClip pipeline aborted' when external signal fires", async () => {
    const sendMessage = () => new Promise<string>(() => {});
    const externalController = new AbortController();

    const promise = sendWithTimeout(sendMessage, "test", {
      timeoutMs: 30000,
      externalSignal: externalController.signal,
    });

    setTimeout(() => externalController.abort(), 10);
    await expect(promise).rejects.toThrow("AutoClip pipeline aborted");
  });
});
