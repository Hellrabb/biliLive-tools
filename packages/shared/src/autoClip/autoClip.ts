// AutoClip facade — re-exports the atomic retry-and-reschedule method
// from the database model. The actual SQLite transaction lives in
// ../db/autoClip.ts AutoClipModel.retryAndReschedule() so callers do
// NOT need to coordinate incrementRetry + updateStatus manually.
//
// H3 fix: ExportClipByIdDeps.retryAndReschedule replaces the old
// non-atomic `incrementRetry + updateStatus` pattern.

export { autoClipModel } from "../db/index.js";
