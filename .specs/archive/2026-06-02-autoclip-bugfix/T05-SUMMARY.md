# T05-SUMMARY — DB Schema Hardening + Frontend Fixes (2026-06-01)

## Changes

### 1. DB Schema Hardening (Migration v5)

- **File**: `packages/shared/src/db/autoClip.ts`
- **Change**: Added migration v5 `harden_id_constraint` that:
  - Cleans dirty data: `UPDATE ... SET id = lower(hex(randomblob(16))) WHERE id = '' OR id IS NULL`
  - Rebuilds table with `id TEXT NOT NULL PRIMARY KEY CHECK(id != '')` (atomic transaction)
  - Idempotent: checks existing DDL via `sqlite_master` before rebuilding
- **Rationale**: Prevents recurrence of H2 (empty string IDs in auto_clip_results) at the DB layer

### 2. L6: Polling Progress Indicator

- **File**: `packages/app/src/renderer/src/pages/AutoClipManagement/Index.vue`
- **Change**: Added `pollingProgress` reactive ref showing "第 N/M 次查询..." during extended analysis polling. Cleared on completion/cancel.
- **Lines**: +8 additions, 0 deletions

### 3. L8: Stale Rule Index Fix

- **File**: `packages/app/src/renderer/src/components/AutoClipPresetDialog.vue`
- **Change**: Filter rule toggle/delete callbacks now use `rules.findIndex(r => r.id === row.id)` instead of raw array `index`. The `DanmakuFilterRule` type already has an `id` field.
- **Lines**: +9 additions, -3 deletions

### 4. DB Constraint Tests

- **File**: `packages/shared/test/autoClip/dbConstraint.test.ts` (NEW)
- **Tests**: 8 tests covering:
  - Migration cleans empty string id rows
  - Migration cleans NULL id rows
  - Migration idempotent (safe to run twice)
  - Rejects new insert with empty id (CHECK constraint)
  - Rejects new insert with NULL id (NOT NULL constraint)
  - upsertResult works with valid id
  - Fresh DB creates table with NOT NULL on id
  - upsertResult rejects empty id on new DB

## Verification

```
cd packages/shared && pnpm run test -- autoClip/dbConstraint.test.ts
Test Files  1 passed
Tests  8 passed
```

## Commit

`2891a896 fix(autoclip-bugfix): T05 add DB id constraint, fix polling progress, stale rule index`

## Files Modified

| File                                                              | Lines   | Status   |
| ----------------------------------------------------------------- | ------- | -------- |
| packages/shared/src/db/autoClip.ts                                | +125/-7 | Modified |
| packages/shared/test/autoClip/dbConstraint.test.ts                | +315    | Created  |
| packages/app/src/renderer/src/pages/AutoClipManagement/Index.vue  | +8/-0   | Modified |
| packages/app/src/renderer/src/components/AutoClipPresetDialog.vue | +9/-3   | Modified |
