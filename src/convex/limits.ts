// ---------------------------------------------------------------------------
// Server-side input limits — single source of truth.
// Imported by exams.ts (handlers) and validation.ts (validators) so the two
// can never drift apart. These are hard REJECT limits: input outside them is
// refused outright, never silently trimmed or truncated.
// ---------------------------------------------------------------------------

export const MAX_LIST_ROOMS = 200; // rooms returned per examiner dashboard load
export const MAX_COUNT_ROOMS = 50; // rooms per getRoomCounts call
export const MAX_STUDENT_NAME = 60; // student display name
export const MAX_ROOM_NAME = 120; // room title
export const MAX_ROOM_PROMPT = 10_000; // exam question / prompt text
export const MAX_SUBMISSION_CODE = 64_000; // submitted code (~64KB)
export const MAX_CLIENT_ID = 128; // student session token length
export const MAX_EXAMINER_NAME = 80; // examiner display name
export const MAX_ROOM_IDS_PER_QUERY = 50; // roomIds array length
export const AUTOSAVE_MIN_INTERVAL_MS = 1_000; // damp redundant autosave writes
export const MIN_DURATION_MINUTES = 1;
export const MAX_DURATION_MINUTES = 24 * 60;
export const MIN_ENROLLED_LIMIT = 1;
export const MAX_ENROLLED_LIMIT = 500;

/** Room codes are exactly "CV-" + 4 digits (e.g. "CV-1234"). */
export const ROOM_CODE_PATTERN = /^CV-\d{4}$/;
/** Optional institutional ID (e.g. "24BCA10210"): 3–24 letters/digits/hyphens. */
export const STUDENT_ID_PATTERN = /^[A-Z0-9-]{3,24}$/;
