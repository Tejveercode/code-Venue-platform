import { ConvexError } from "convex/values";

/**
 * Extract a user-facing message from a thrown Convex function error.
 *
 * The backend intentionally throws ConvexError for everything a user can act
 * on (validation failures, rate limits). Those carry safe, human-readable
 * data and are shown as-is. ANY other error (bugs, network faults, internal
 * Convex errors) falls back to the provided generic message — raw errors,
 * stack traces, and internal details never reach the UI.
 */
export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ConvexError && typeof error.data === "string") {
    return error.data;
  }
  // Cross-bundle safety: if the ConvexError class identity differs, match
  // by shape (name + string data).
  if (
    typeof error === "object" &&
    error !== null &&
    "data" in error &&
    (error as { name?: unknown }).name === "ConvexError" &&
    typeof (error as { data?: unknown }).data === "string"
  ) {
    return (error as { data: string }).data;
  }
  return fallback;
}
