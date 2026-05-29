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
  if (signal?.aborted) return [];

  const limit = pLimit(FRAME_CONCURRENCY);

  const tasks = timestampsSeconds.map((ts) =>
    limit(async () => {
      try {
        return await extractOneFrame(videoPath, ts, ffmpegPath, signal);
      } catch (err) {
        logger.warn(`frameSampler: failed to extract frame at ${ts}s: ${err}`);
        return null;
      }
    }),
  );

  const results = await Promise.allSettled(tasks);
  const frames: string[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value !== null) {
      frames.push(r.value);
    }
  }
  return frames;
}

function extractOneFrame(
  videoPath: string,
  timestampSec: number,
  ffmpegPath: string,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new Error("AutoClip pipeline aborted"));
    }

    const args = [
      "-ss", String(timestampSec),
      "-i", videoPath,
      "-vframes", "1",
      "-q:v", "2",
      "-f", "image2pipe",
      "-vcodec", "mjpeg",
      "-",
    ];

    const proc = spawn(ffmpegPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`Frame extraction timed out after ${FRAME_EXTRACT_TIMEOUT_MS}ms at ${timestampSec}s`));
    }, FRAME_EXTRACT_TIMEOUT_MS);

    const onAbort = () => {
      proc.kill("SIGKILL");
      clearTimeout(timer);
      reject(new Error("AutoClip pipeline aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    // Double-check after registration to close race window
    if (signal?.aborted) {
      onAbort();
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
      reject(err);
    });
  });
}
