import { LLM_REQUEST_TIMEOUT_MS } from "./constants.js";

/**
 * Wrap an async LLM call with an AbortController timeout.
 * Rejects with "LLM request timeout" if the call exceeds timeoutMs.
 *
 * Uses a `settled` flag to prevent post-timeout resolution from
 * triggering unnecessary cleanup. The underlying HTTP request may
 * still complete (depending on fetch implementation), but the
 * promise contract is upheld: only the first settlement wins.
 */
export function sendWithTimeout(
  sendMessage: (prompt: string, signal?: AbortSignal) => Promise<string>,
  prompt: string,
  timeoutMs = LLM_REQUEST_TIMEOUT_MS,
): Promise<string> {
  const controller = new AbortController();
  return new Promise((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      controller.abort();
      reject(new Error("LLM request timeout"));
    }, timeoutMs);

    sendMessage(prompt, controller.signal)
      .then((res) => {
        if (!settled) {
          clearTimeout(timer);
          resolve(res);
        }
      })
      .catch((err) => {
        if (!settled) {
          clearTimeout(timer);
          if (err?.name === "AbortError") {
            reject(new Error("LLM request timeout"));
          } else {
            reject(err);
          }
        }
      });
  });
}
