import { LLM_REQUEST_TIMEOUT_MS } from "./constants.js";

/**
 * Wrap an async LLM call with an AbortController timeout.
 * Rejects with "LLM request timeout" if the call exceeds timeoutMs.
 */
export function sendWithTimeout(
  sendMessage: (prompt: string, signal?: AbortSignal) => Promise<string>,
  prompt: string,
  timeoutMs = LLM_REQUEST_TIMEOUT_MS,
): Promise<string> {
  const controller = new AbortController();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error("LLM request timeout"));
    }, timeoutMs);
    sendMessage(prompt, controller.signal)
      .then((res) => { clearTimeout(timer); resolve(res); })
      .catch((err) => {
        clearTimeout(timer);
        if (err?.name === "AbortError") {
          reject(new Error("LLM request timeout"));
        } else {
          reject(err);
        }
      });
  });
}
