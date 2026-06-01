# T02 SUMMARY — 服务层 + cancel 路径修复

## Date: 2026-06-01

## Files modified

- `packages/shared/src/autoClip/service.ts` — H2, M6, L5 fixes
- `packages/shared/src/autoClip/autoClip.ts` — new module (re-exports DB facade)
- `packages/shared/src/autoClip/exportPipeline.ts` — H3: ExportClipByIdDeps + caller migration
- `packages/http/src/routes/autoClip.ts` — H3: retryAndReschedule wiring
- `packages/shared/test/autoClip/service.test.ts` — H2 + M6 tests (4 new)

## Bugs fixed

### H2 (HIGH) — Cancel returns empty ID, DB pollution

**Root cause**: `analyzeAndSave` catch block returned `id: params.id ?? ""`. When `params.id` is undefined (recorder-triggered calls), returns empty string.
**Fix**: Compute `effectiveId = id ?? uuidv4()` before pipeline call, pass it as `id: effectiveId` to pipeline, use `effectiveId` in cancel response.

### M10 (same root as H2)

Fixed by H2 fix above — effectiveId shared between pipeline and catch block.

### H3 (HIGH) — incrementRetry non-atomic with caller

**Root cause**: `doExportClips` called `deps.incrementRetry(resultId)` then `deps.updateStatus(resultId, "pending")` — two non-atomic calls, allowing TOCTOU gap.
**Fix**: Callers now use `deps.retryAndReschedule(resultId)` — single SQLite transaction in AutoClipModel that increments retry_count AND sets status to "pending" atomically. If retry_count >= 3, status is set to "failed" and returns false.

### M6 (MEDIUM) — TOCTOU race in catch

**Root cause**: `catch` checked `signal?.aborted` to decide cancel vs. error, but abort could fire between pipeline throw and catch block execution, causing real errors to be swallowed as cancel responses.
**Fix**: Capture `err` immediately as `capturedErr`. Check `capturedErr.name === "AbortError"` (the specific error thrown by `signal.throwIfAborted()`). Only return cancel if it IS an AbortError AND signal is aborted. Otherwise re-throw the real error.

### L5 (LOW) — Config read timing

**Root cause**: `autoClipReviewMode`, `autoClipExport`, `autoClipUpload` read from `appConfig` AFTER pipeline completes. If user changes settings during long pipeline, behavior inconsistent.
**Fix**: Snapshot these three config values before pipeline into local variables (`reviewMode`, `autoExportEnabled`, `autoUploadEnabled`). Use snapshots throughout. Removed duplicate reads from `appConfig.videoCut`.

## Test results (GREEN phase)

```
✓ test/autoClip/service.test.ts (8 tests)
  ✓ AutoClipService.analyzeAndSave — preset fallback (4 tests)
  ✓ AutoClipService.analyzeAndSave — cancel and error paths (4 tests)
    ✓ H2: cancel returns auto-generated ID, not empty string
    ✓ H2: cancel returns caller-provided ID when explicit id given
    ✓ M6: real error is not swallowed by late abort signal
    ✓ M6: true abort (AbortError) still returns cancel response
```

Full autoclip suite: 480 passed, 6 pre-existing failures (none from T02).

## 6-dimension self-review

1. **Correctness**: effectiveId shared between pipeline and cancel path. AbortError detection uses `name` property, not signal state alone. L5 snapshots captured before long pipeline. H3 single-transaction atomic.
2. **Backward compatibility**: Public API unchanged. Private method signature extended (safe). ExportClipByIdDeps interface extended with new required field — all callers updated.
3. **Error handling**: Real errors not swallowed by late abort (M6). Cancel returns valid UUID (H2). AbortError detection uses `instanceof Error && name === "AbortError"` (Node.js compatible).
4. **Concurrency**: H3: single SQLite transaction. L5: config snapshot before pipeline.
5. **Performance**: Negligible overhead — one uuidv4 call (cached when id provided), three boolean snapshots.
6. **Coverage**: 4 new test cases covering H2 (auto-id + explicit-id) and M6 (real error re-thrown + AbortError handled).

## Boundary check

- `autoExportAndUpload` is private, only called from within `AutoClipService.analyzeAndSave`. Adding `autoUploadEnabled` parameter is safe.
- `runAutoClipPipeline` already handles `id ?? uuidv4()` internally — passing our pre-computed `effectiveId` just ensures the returned result.id matches what we have.
- `ExportClipByIdDeps.retryAndReschedule` is required — callers MUST provide it. The HTTP routes wiring was updated.
- No changes to awilix DI container initialization.
- No changes to baseModel.ts.
