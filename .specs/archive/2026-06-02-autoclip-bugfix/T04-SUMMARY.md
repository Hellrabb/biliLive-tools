# T04 SUMMARY — 媒体处理 + abort + LLM provider

Date: 2026-06-01

## Bugs Fixed

### H5 (HIGH): Abort resolve deleted file

- **File**: `packages/shared/src/autoClip/contentUnderstanding.ts`
- **Root cause**: `extractAudioSegment` close handler resolved `outputPath` on `code === 0` without checking if the file still existed. When abort fired and deleted the .wav via `unlink`, ffmpeg could still exit code 0 (edge case after SIGKILL), causing the promise to resolve to a deleted file path.
- **Fix**: Added `fs.existsSync(outputPath)` check in the `code === 0` branch. If file missing, reject with descriptive error.

### M3 (MEDIUM): Double reject on abort/error+close

- **Files**: `contentUnderstanding.ts` (`extractAudioSegment`), `frameSampler.ts` (`extractOneFrame`)
- **Root cause**: Both functions could fire multiple settle events (e.g., `error` then `close`, or `abort` then `close`), leading to double reject/resolve calls. While JS promise semantics make the 2nd call no-op, the settled guard prevents unnecessary code execution and future bugs.
- **Fix**: Added `let settled = false` guard variable at the top of each Promise constructor. Check `if (settled) return; settled = true;` before every `resolve()`/`reject()` call in close, error, abort, and timer handlers.

### M9 (MEDIUM): Abort error swallowed

- **File**: `packages/shared/src/autoClip/frameSampler.ts`
- **Root cause**: `sampleFrames` catch block logged all errors and returned `null`, making abort rejections indistinguishable from real ffmpeg errors. Abort signals were silently swallowed.
- **Fix**:
  1. `extractOneFrame` abort rejections now have `error.name = "AbortError"`
  2. `sampleFrames` catch block checks `err.name === "AbortError"` and re-throws
  3. After `Promise.allSettled`, scan for AbortError rejections and re-throw
  4. Pre-aborted signal check now throws instead of returning `[]`

### H4 (HIGH): OpenAI provider silent failure

- **File**: `packages/shared/src/autoClip/sendMessage.ts`
- **Root cause**: `buildSendMessage` handled `qwen`, `aliyun`, `ollama` providers but NOT `openai`. However, `buildSendMultimodalMessage` DID handle `openai` via `vendor.provider`. And `routes/autoClip.ts` validated `openai` as a valid enum value. Result: openai text ranking silently degraded to heuristic, while multimodal worked fine -- an asymmetric, hard-to-detect bug.
- **Fix**: Added `if (llmCfg.provider === "openai" || vendor.provider === "openai")` branch using QwenLLM (OpenAI-compatible chat completions endpoint), matching the pattern in `buildSendMultimodalMessage`.

## Tests Added

### contentUnderstanding.test.ts (+7 tests)

- `extractAudioSegment` resolves on success
- `extractAudioSegment` rejects on non-zero exit code
- `extractAudioSegment` rejects on spawn error
- H5: Rejects when ffmpeg exits code 0 but file missing
- H5: Resolves when ffmpeg exits code 0 and file exists
- M3: Settles only once when error+close both fire
- M3: Handles abort without double settle

### frameSampler.test.ts (+3 tests, +1 updated)

- M9: Aborts mid-extraction and re-throws AbortError
- M9: Propagates AbortError when signal is pre-aborted
- M3: `extractOneFrame` settles only once when error+close fire
- Updated: "returns empty array when signal already aborted" now expects throw

### sendMessage.test.ts (+2 tests)

- H4: Routes to QwenLLM for `openai` provider via `llmCfg.provider`
- H4: Routes to QwenLLM when `vendor.provider` is `openai`

## Test Results

- **Before**: 28/28 passing (no new tests)
- **After**: 40/40 passing (all 3 test files)
- **All T04-specific tests**: 40 passed, 0 failed
- **Pre-existing failures**: 3 (exportPipeline.test.ts x2, signalDetector.test.ts x1 -- from other tasks, not T04 scope)

## Verification

```bash
cd packages/shared && pnpm run test -- autoClip/contentUnderstanding.test.ts autoClip/frameSampler.test.ts autoClip/sendMessage.test.ts
# PASS: 40/40
```
