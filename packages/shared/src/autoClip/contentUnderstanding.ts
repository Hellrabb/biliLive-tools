import { spawn } from "node:child_process";
import { readdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import logger from "../utils/log.js";
import { sampleFrames } from "./frameSampler.js";
import type { HighlightSegment } from "./types.js";
import type { AutoClipEnhancementConfig } from "@biliLive-tools/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContentUnderstandingDeps {
  /** ASR recognize function (injected to avoid circular deps) */
  recognizeASR?: (audioPath: string) => Promise<{ text: string }>;
  /** Multimodal message sender for frame description */
  sendMultimodalMessage?: (prompt: string, images: string[], signal?: AbortSignal) => Promise<string>;
  /** Frame sampler (mockable, defaults to frameSampler) */
  sampleFrames?: typeof sampleFrames;
  /** Audio extractor (mockable, defaults to ffmpeg-based) */
  extractAudio?: (videoPath: string, bestRange: [number, number]) => Promise<string>;
  /** Path to ffmpeg binary (defaults to "ffmpeg") */
  ffmpegPath?: string;
}

// ---------------------------------------------------------------------------
// Audio extraction
// ---------------------------------------------------------------------------

/** Seconds of audio padding around clip boundaries for ASR context */
const ASR_PADDING_SEC = 3;

function extractAudioSegment(
  videoPath: string,
  [start, end]: [number, number],
  ffmpegPath = "ffmpeg",
): Promise<string> {
  return new Promise((resolve, reject) => {
    const padStart = Math.max(0, start - ASR_PADDING_SEC);
    const duration = (end - start) + ASR_PADDING_SEC * 2;
    const outputPath = path.join(tmpdir(), `autoclip_asr_${uuidv4()}.wav`);

    const args = [
      "-ss", String(padStart),
      "-i", videoPath,
      "-t", String(duration),
      "-vn",
      "-acodec", "pcm_s16le",
      "-ar", "16000",
      "-ac", "1",
      "-y",
      outputPath,
    ];

    const proc = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";

    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(outputPath);
      } else {
        reject(new Error(`Audio extraction failed: ${stderr.slice(-200)}`));
      }
    });

    proc.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// understandContent
// ---------------------------------------------------------------------------

const FRAME_DESCRIPTION_PROMPT =
  "Describe what is happening in this live stream frame in 1-2 sentences. Focus on: scene type (game/chat/performance), visible action, emotional atmosphere. Be factual and concise.";

export async function understandContent(
  videoPath: string,
  highlights: HighlightSegment[],
  config: AutoClipEnhancementConfig,
  deps: ContentUnderstandingDeps,
  signal?: AbortSignal,
): Promise<{ asrMap: Map<number, string>; frameMap: Map<number, string> }> {
  const asrMap = new Map<number, string>();
  const frameMap = new Map<number, string>();

  if (highlights.length === 0) return { asrMap, frameMap };
  if (signal?.aborted) return { asrMap, frameMap };

  const doASR = config.asrEnabled && !!deps.recognizeASR;
  const doVisual = config.visualEnabled && !!deps.sendMultimodalMessage;
  if (!doASR && !doVisual) return { asrMap, frameMap };

  const doExtractAudio = deps.extractAudio
    ? (videoPath: string, range: [number, number]) => (deps.extractAudio!)(videoPath, range)
    : (videoPath: string, range: [number, number]) => extractAudioSegment(videoPath, range, deps.ffmpegPath);
  const doSampleFrames = deps.sampleFrames
    ? (videoPath: string, timestamps: number[]) => deps.sampleFrames!(videoPath, timestamps, deps.ffmpegPath)
    : (videoPath: string, timestamps: number[]) => sampleFrames(videoPath, timestamps, deps.ffmpegPath);

  // Process highlights in parallel with concurrency control
  const CONCURRENCY = 3;
  const { default: pLimit } = await import("p-limit");
  const limit = pLimit(CONCURRENCY);

  const tasks = highlights.map((h, i) =>
    limit(async () => {
      if (signal?.aborted) return;
      // --- ASR ---
      if (doASR) {
        try {
          const audioPath = await doExtractAudio(videoPath, h.bestRange);
          try {
            const result = await deps.recognizeASR!(audioPath);
            if (result?.text) {
              asrMap.set(i, result.text);
            }
          } finally {
            unlink(audioPath).catch(() => {});
          }
        } catch (err) {
          logger.warn(`contentUnderstanding: ASR failed for highlight ${i}: ${err}`);
        }
      }

      // --- Frame description ---
      if (doVisual) {
        try {
          const timestamps = [
            h.bestRange[0] + 1,
            (h.bestRange[0] + h.bestRange[1]) / 2,
          ];
          const frames = await doSampleFrames(videoPath, timestamps);
          if (frames.length > 0) {
            const description = await deps.sendMultimodalMessage!(
              FRAME_DESCRIPTION_PROMPT,
              frames,
              signal,
            );
            if (description) {
              frameMap.set(i, description);
            }
          }
        } catch (err) {
          logger.warn(`contentUnderstanding: frame description failed for highlight ${i}: ${err}`);
        }
      }
    }),
  );

  await Promise.allSettled(tasks);

  return { asrMap, frameMap };
}

// ---------------------------------------------------------------------------
// Stale temp file cleanup
// ---------------------------------------------------------------------------

const ASR_TEMP_PREFIX = "autoclip_asr_";

/**
 * Clean up stale ASR temp files from previous runs (e.g., after SIGKILL).
 * Best-effort — errors are logged and ignored.
 */
export async function cleanupStaleASRTempFiles(): Promise<void> {
  try {
    const files = await readdir(tmpdir());
    const stale = files.filter((f) => f.startsWith(ASR_TEMP_PREFIX));
    for (const f of stale) {
      try {
        await unlink(path.join(tmpdir(), f));
      } catch {
        // File may be locked or already deleted
      }
    }
    if (stale.length > 0) {
      logger.info(`AutoClip: cleaned up ${stale.length} stale ASR temp files`);
    }
  } catch (err) {
    logger.warn("AutoClip: failed to scan for stale ASR temp files", err);
  }
}

// Schedule cleanup at module import time (non-blocking)
setImmediate(() => { cleanupStaleASRTempFiles(); });
