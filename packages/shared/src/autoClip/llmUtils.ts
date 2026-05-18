import { LLM_REQUEST_TIMEOUT_MS } from "./constants.js";

/**
 * Wrap an async LLM call with an AbortController timeout.
 * Rejects with "LLM request timeout" if the call exceeds timeoutMs.
 *
 * Supports an optional `externalSignal` that races against the internal
 * timeout — when the external signal fires, the internal timer is cleared
 * and the promise rejects with "AutoClip pipeline aborted".
 *
 * Uses a `settled` flag to prevent post-timeout resolution from
 * triggering unnecessary cleanup. The underlying HTTP request may
 * still complete (depending on fetch implementation), but the
 * promise contract is upheld: only the first settlement wins.
 *
 * Backward-compatible: `sendWithTimeout(send, prompt, 30000)` still works.
 */
export function sendWithTimeout(
  sendMessage: (prompt: string, signal?: AbortSignal) => Promise<string>,
  prompt: string,
  options?: number | { timeoutMs?: number; externalSignal?: AbortSignal },
): Promise<string> {
  const timeoutMs = typeof options === "number" ? options : (options?.timeoutMs ?? LLM_REQUEST_TIMEOUT_MS);
  const externalSignal = typeof options === "object" ? options?.externalSignal : undefined;

  // Fast path: external signal already aborted
  if (externalSignal?.aborted) {
    return Promise.reject(new Error("AutoClip pipeline aborted"));
  }

  const controller = new AbortController();
  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    };

    const onExternalAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      controller.abort();
      reject(new Error("AutoClip pipeline aborted"));
    };

    externalSignal?.addEventListener("abort", onExternalAbort);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      controller.abort();
      reject(new Error("LLM request timeout"));
    }, timeoutMs);

    sendMessage(prompt, controller.signal)
      .then((res) => {
        if (!settled) {
          cleanup();
          resolve(res);
        }
      })
      .catch((err) => {
        if (!settled) {
          cleanup();
          if (err?.name === "AbortError") {
            if (controller.signal.aborted) {
              reject(new Error("LLM request timeout"));
            } else {
              reject(err);
            }
          } else {
            reject(err);
          }
        }
      });
  });
}
