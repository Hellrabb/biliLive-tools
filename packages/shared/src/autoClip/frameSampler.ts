import { spawn } from "node:child_process";
import logger from "../utils/log.js";

/**
 * Extract frames from a video at given timestamps.
 * Returns base64 JPEG data URIs via ffmpeg pipe (no temp files).
 */
export async function sampleFrames(
  videoPath: string,
  timestampsSeconds: number[],
  ffmpegPath = "ffmpeg",
): Promise<string[]> {
  if (timestampsSeconds.length === 0) return [];

  const frames: string[] = [];

  for (const ts of timestampsSeconds) {
    try {
      const frame = await extractOneFrame(videoPath, ts, ffmpegPath);
      frames.push(frame);
    } catch (err) {
      logger.warn(`frameSampler: failed to extract frame at ${ts}s: ${err}`);
    }
  }

  return frames;
}

function extractOneFrame(
  videoPath: string,
  timestampSec: number,
  ffmpegPath: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
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

    const chunks: Buffer[] = [];
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0 || chunks.length === 0) {
        reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-200)}`));
        return;
      }
      const base64 = Buffer.concat(chunks).toString("base64");
      resolve(`data:image/jpeg;base64,${base64}`);
    });

    proc.on("error", reject);
  });
}
