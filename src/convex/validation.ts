import { ConvexError } from "convex/values";
import {
  MAX_ROOM_NAME,
  MAX_ROOM_PROMPT,
  MAX_STUDENT_NAME,
  MAX_EXAMINER_NAME,
  MAX_SUBMISSION_CODE,
  MAX_CLIENT_ID,
  MAX_BROWSER_ID,
  MIN_DURATION_MINUTES,
  MAX_DURATION_MINUTES,
  MIN_ENROLLED_LIMIT,
  MAX_ENROLLED_LIMIT,
  ROOM_CODE_PATTERN,
  STUDENT_ID_PATTERN,
  MAX_VIOLATION_LIMIT,
  MAX_PRIVACY_MESSAGE,
} from "./limits";

// ---------------------------------------------------------------------------
// Input validation — reject, don't sanitize.
// Every validator throws a ConvexError carrying a clear, user-facing message.
// The frontend displays ConvexError messages and falls back to a generic
// string for anything else, so internal details never leak (see ui.ts).
// ---------------------------------------------------------------------------

function reject(message: string): never {
  throw new ConvexError(message);
}

/** Room title: non-empty, within MAX_ROOM_NAME. */
export function validateRoomName(raw: string): string {
  const name = raw.trim();
  if (!name) reject("Room name is required.");
  if (name.length > MAX_ROOM_NAME)
    reject(`Room name must be ${MAX_ROOM_NAME} characters or fewer.`);
  return name;
}

/** Exam question/prompt: non-empty, within MAX_ROOM_PROMPT. */
export function validateRoomPrompt(raw: string): string {
  const prompt = raw.trim();
  if (!prompt) reject("The exam question is required.");
  if (prompt.length > MAX_ROOM_PROMPT)
    reject(`The exam question must be ${MAX_ROOM_PROMPT} characters or fewer.`);
  return prompt;
}

/** Exam duration in minutes. */
export function validateDuration(raw: number): number {
  const duration = Math.floor(raw);
  if (!Number.isFinite(duration) || duration < MIN_DURATION_MINUTES || duration > MAX_DURATION_MINUTES) {
    reject(`Duration must be between ${MIN_DURATION_MINUTES} and ${MAX_DURATION_MINUTES} minutes.`);
  }
  return duration;
}

/** Room capacity. */
export function validateEnrolledLimit(raw: number): number {
  const limit = Math.floor(raw);
  if (!Number.isFinite(limit) || limit < MIN_ENROLLED_LIMIT || limit > MAX_ENROLLED_LIMIT) {
    reject(`Enrolled limit must be between ${MIN_ENROLLED_LIMIT} and ${MAX_ENROLLED_LIMIT}.`);
  }
  return limit;
}

/** Room code: must match CV-#### exactly (after trim + uppercase). */
export function validateRoomCode(raw: string): string {
  const code = raw.trim().toUpperCase();
  if (!ROOM_CODE_PATTERN.test(code)) {
    reject('Room codes look like "CV-1234". Double-check it with your examiner.');
  }
  return code;
}

/** Student display name. */
export function validateStudentName(raw: string): string {
  const name = raw.trim();
  if (!name) reject("Please enter your name.");
  if (name.length > MAX_STUDENT_NAME)
    reject(`Name must be ${MAX_STUDENT_NAME} characters or fewer.`);
  return name;
}

/** Optional institutional ID (e.g. "24BCA10210"). Returns undefined if absent. */
export function validateStudentId(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const regNo = raw.trim().toUpperCase();
  if (!regNo) return undefined;
  if (!STUDENT_ID_PATTERN.test(regNo)) {
    reject("Student ID should be 3–24 letters/numbers (e.g. 24BCA10210).");
  }
  return regNo;
}

/** Student session token. */
export function validateClientId(raw: string): string {
  if (!raw || raw.length > MAX_CLIENT_ID) {
    reject("Invalid session — please rejoin the room.");
  }
  return raw;
}

/**
 * Opaque browser-session id (non-secret, never a permission). It exists so
 * the SERVER can tell whether a re-join describes the same attempt; anything
 * longer than the cap or empty is simply treated as absent rather than
 * rejected — the join path must keep working for browsers without storage.
 */
export function validateBrowserId(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const id = raw.trim();
  if (!id) return undefined;
  if (id.length > MAX_BROWSER_ID) return undefined;
  return id;
}

/** Submitted code body. */
export function validateSubmissionCode(raw: string): string {
  if (raw.length > MAX_SUBMISSION_CODE) {
    reject("Submission is too large (64KB limit).");
  }
  return raw;
}

/**
 * Client edit revision for stale-write protection: a non-negative integer
 * counting the student's editor changes. An autosave carrying a rev older
 * than the stored one is skipped server-side instead of overwriting newer
 * content.
 */
export function validateRevision(raw: number | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (!Number.isInteger(raw) || raw < 0 || raw > Number.MAX_SAFE_INTEGER) {
    reject("Invalid save state — please reload the exam page.");
  }
  return raw;
}

/**
 * Room-level violation limit for exam-session monitoring.
 * 0 (or blank from the UI) = zero-tolerance: the first violation flags the
 * student. >0 = warnings until the student exceeds the count.
 */
export function validateViolationLimit(raw: number | undefined): number {
  if (raw === undefined) return 0;
  const limit = Math.floor(raw);
  if (!Number.isFinite(limit) || limit < 0 || limit > MAX_VIOLATION_LIMIT) {
    reject(`Violation limit must be between 0 and ${MAX_VIOLATION_LIMIT} (0 = zero-tolerance).`);
  }
  return limit;
}

/** Examiner display name. */
export function validateExaminerName(raw: string): string {
  const name = raw.trim();
  if (!name) reject("Please enter your name.");
  if (name.length > MAX_EXAMINER_NAME)
    reject(`Name must be ${MAX_EXAMINER_NAME} characters or fewer.`);
  return name;
}

/** Privacy/grievance request free text (optional). */
export function validatePrivacyMessage(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const message = raw.trim();
  if (!message) return undefined;
  if (message.length > MAX_PRIVACY_MESSAGE) {
    reject(`Please keep your message under ${MAX_PRIVACY_MESSAGE} characters.`);
  }
  return message;
}

/**
 * Policy version string carried with a consent record — must match a version
 * published in src/lib/policy.ts. Unrecognized versions are refused so a
 * tampered client cannot fabricate consent against a policy that never
 * existed.
 */
export function validatePolicyVersion(raw: string, allowed: readonly string[]): string {
  const version = raw.trim();
  if (!allowed.includes(version)) {
    reject("Unknown policy version — please reload the page and try again.");
  }
  return version;
}
