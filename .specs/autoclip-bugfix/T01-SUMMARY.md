# T01 SUMMARY — 出口管线修复 (exportPipeline.ts)

## Date: 2026-06-01

## Files modified
- `packages/shared/test/autoClip/exportPipeline.test.ts` — NEW: 13 regression tests (commit: 69bc05f8)

Note: `packages/shared/src/autoClip/exportPipeline.ts` was NOT modified in this task — the fixes were already applied at HEAD (commit 69de392d, T02). All edits were no-ops confirming the code was already fixed.

## Bugs fixed (already in HEAD)

### H1 (HIGH) — Timer leak
**Root cause**: `setTimeout` for `EXPORT_TIMEOUT_MS` was set before the `try` block in `doExportClips`. If synchronous calls between timer creation and try (like `updateStatus`) threw, the 10-minute timer leaked.
**Fix (already applied)**: Timer creation moved inside `try` block, after `deps.updateStatus("exporting")`. The existing `clearTimeout` in `finally` handles all error paths.

### M7 (MEDIUM) — In-place mutation
**Root cause**: `validateAndNormalizeHighlight` mutated input objects via `(obj as Record<string, unknown>).score = 5` pattern.
**Fix (already applied)**: Function returns a new `HighlightSegment` object with spread, never mutating input. Return type changed from `h is HighlightSegment` to `HighlightSegment | false`. Call site updated from `.filter()` to `.map().filter()`.

### L1 (LOW) — Task completion detection
**Root cause**: Danmaku conversion promise only listened to `task-end`/`task-error` events. If task completed before listeners registered, promise never resolved.
**Fix (already applied)**: Check `task.status` immediately after listener registration; resolve/reject immediately if already completed/errored/cancelled.

### L2 (LOW) — ASS cleanup race
**Root cause**: ASS file unlinked immediately after `Promise.allSettled` on cut tasks. ffmpeg might still hold the file handle.
**Fix (already applied)**: Added 100ms delay before unlink; wrapped unlink in try/catch ignoring ENOENT.

### L3 (LOW) — AbortSignal propagation
**Root cause**: `doExportClips` received `signal` parameter but didn't pass it to `tryLoadExportConfig`.
**Fix (already applied)**: Added `signal?: AbortSignal` parameter to `tryLoadExportConfig`; checks `signal?.throwIfAborted()`; propagates `AbortError` through catch. Both call sites pass `signal`.

### L4 (LOW) — Double DI import
**Root cause**: `resolveExportPresets` called `await import("../index.js")` in each conditional block, though a local `diContainer` guard already prevented double import within one call.
**Fix (already applied)**: Extracted to module-level `cachedDiContainer` + `getDiContainer()` helper, caching across multiple calls.

## Test results (GREEN phase)

```
✓ test/autoClip/exportPipeline.test.ts (13 tests) PASS
  ✓ validateAndNormalizeHighlight — 9 tests (valid, invalid, non-mutation)
  ✓ resolveSavePath — 3 tests
  ✓ resolveExportPresets — 1 test

✓ test/autoClip/pipeline.test.ts (11 tests) PASS — no regression
```

## 6-dimension self-review (R1-R6)

| Dim | Item | Verdict |
|-----|------|---------|
| R1 | Spec compliance | All 6 bugs (H1/M7/L1/L2/L3/L4) addressed in code |
| R2 | Test coverage | 13 new tests: M7 non-mutation (4), validation (5), resolveSavePath (3), resolver (1). H1/L3 verified via code structure |
| R3 | Existing regression | pipeline.test.ts: 11/11 pass. Full autoclip suite: 486/487 pass (1 pre-existing signalDetector failure) |
| R4 | API compatibility | validateAndNormalizeHighlight return type changed (type guard → HighlightSegment \| false), call site updated in doExportClips. Publicly re-exported via pipeline.ts |
| R5 | Error handling | All error paths preserved. Added AbortError propagation in tryLoadExportConfig. ENOENT gracefully ignored in ASS cleanup |
| R6 | Code style | Consistent with codebase patterns (2-space indent, tabs in some areas, async/await, try/catch) |

## Boundary check (R6.5)

```
git diff --name-only HEAD
  (empty — all source code changes were already in HEAD)
write_files constraint: ✅ exportPipeline.test.ts is in allowed write_files list
```

## Commit

`69bc05f8 fix(autoclip-bugfix): T01 add regression tests for exportPipeline fixes`
