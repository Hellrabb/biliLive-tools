import { spawn } from "node:child_process";
import pLimit from "p-limit";
import logger from "../utils/log.js";
import { FRAME_CONCURRENCY, FRAME_EXTRACT_TIMEOUT_MS } from "./constants.js";

/**
 * Extract frames from a video at given timestamps.
 * Extractions run in parallel (up to 3 concurrent ffmpeg processes).
 * Returns base64 JPEG data URIs for successfully extracted frames.
 */
export async function sampleFrames(
  videoPath: string,
  timestampsSeconds: number[],
  ffmpegPath = "ffmpeg",
  signal?: AbortSignal,
): Promise<string[]> {
  if (timestampsSeconds.length === 0) return [];
  // M9: propagate pre-existing abort as rejection instead of silently returning []
  if (signal?.aborted) {
    const abortErr = new Error("AutoClip pipeline aborted");
    abortErr.name = "AbortError";
    throw abortErr;
  }

  const limit = pLimit(FRAME_CONCURRENCY);

  const tasks = timestampsSeconds.map((ts) =>
    limit(async () => {
      try {
        return await extractOneFrame(videoPath, ts, ffmpegPath, signal);
      } catch (err) {
        // M9: distinguish AbortError (re-throw) from real errors (return null)
        if (err instanceof Error && err.name === "AbortError") {
          throw err;
        }
        logger.warn(`frameSampler: failed to extract frame at ${ts}s: ${err}`);
        return null;
      }
    }),
  );

  const results = await Promise.allSettled(tasks);

  // M9: propagate abort rejections from settled tasks
  for (const r of results) {
    if (r.status === "rejected" && r.reason instanceof Error && r.reason.name === "AbortError") {
      throw r.reason;
    }
  }
  // Also propagate if signal was aborted during execution
  if (signal?.aborted) {
    const abortErr = new Error("AutoClip pipeline aborted");
    abortErr.name = "AbortError";
    throw abortErr;
  }

  const frames: string[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value !== null) {
      frames.push(r.value);
    }
  }
  return frames;
}

export function extractOneFrame(
  videoPath: string,
  timestampSec: number,
  ffmpegPath: string,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const abortErr = new Error("AutoClip pipeline aborted");
      abortErr.name = "AbortError";
      return reject(abortErr);
    }

    const args = [
      "-ss",
      String(timestampSec),
      "-i",
      videoPath,
      "-vframes",
      "1",
      "-q:v",
      "2",
      "-f",
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "-",
    ];

    const proc = spawn(ffmpegPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    // M3: settled guard prevents double resolve/reject from timer+close, abort+close, or error+close
    let settled = false;

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      if (settled) return;
      settled = true;
      reject(
        new Error(
          `Frame extraction timed out after ${FRAME_EXTRACT_TIMEOUT_MS}ms at ${timestampSec}s`,
        ),
      );
    }, FRAME_EXTRACT_TIMEOUT_MS);

    const onAbort = () => {
      proc.kill("SIGKILL");
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      const abortErr = new Error("AutoClip pipeline aborted");
      abortErr.name = "AbortError";
      reject(abortErr);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    // Double-check after registration to close race window
    if (signal?.aborted) {
      onAbort();
      signal?.removeEventListener("abort", onAbort);
      return;
    }

    const chunks: Buffer[] = [];
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (settled) return;
      settled = true;
      if (code !== 0 || chunks.length === 0) {
        reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-200)}`));
        return;
      }
      const base64 = Buffer.concat(chunks).toString("base64");
      resolve(`data:image/jpeg;base64,${base64}`);
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}
