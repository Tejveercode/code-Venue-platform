import type { Id } from "@/convex/_generated/dataModel";

// ---------------------------------------------------------------------------
// Student browser identity — local storage helpers.
//
// SECURITY MODEL (fixed by the attempt-isolation audit): the browser stores
// TWO things per join flow, and NEITHER is a permission:
//
//   cv:browserId            — one opaque random id per browser. It lets the
//                             SERVER tell which stored attempt (if any) this
//                             join describes. The server only ever resumes an
//                             attempt when its own name/regNo/browser checks
//                             pass — a stolen or absent browserId can never
//                             unlock someone else's data.
//   cv:identity:<ROOMCODE>  — the attempt's secret clientId + the entered
//                             name/regNo. The clientId is the capability
//                             token; it is sent ONLY to the room it belongs
//                             to, and the server re-derives whether resuming
//                             is legitimate (identity match) on every join.
//
// A different name+UID therefore always produces a NEW attempt server-side:
// the join mutation refuses to resume a remembered token whose attempt
// identity doesn't match what was just re-typed, and mints a fresh row
// instead — the previous student's submission is never inherited or
// overwritten. localStorage is session continuity, never the boundary.
// ---------------------------------------------------------------------------

const BROWSER_ID_KEY = "cv:browserId";

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable — session-only identity
  }
}

function safeRemove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/**
 * The browser's stable random id (created on first use). 128-bit random hex,
 * same generator discipline as server tokens. Non-secret: its only power is
 * to let the server FIND a candidate attempt — resuming still requires the
 * attempt-identity match server-side.
 */
export function getBrowserId(): string {
  let id = safeGet(BROWSER_ID_KEY);
  if (!id) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    id = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    safeSet(BROWSER_ID_KEY, id);
  }
  return id;
}

/** Per-room remembered join identity (secret clientId + display fields). */
export type StudentIdentity = {
  clientId: string;
  name: string;
  uid: string;
  regNo: string;
};

function identityKey(roomCode: string): string {
  return `cv:identity:${roomCode.trim().toUpperCase()}`;
}

export function getStudentIdentity(roomCode: string): StudentIdentity | null {
  const raw = safeGet(identityKey(roomCode));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StudentIdentity>;
    if (typeof parsed.clientId !== "string" || !parsed.clientId) return null;
    return {
      clientId: parsed.clientId,
      name: typeof parsed.name === "string" ? parsed.name : "",
      uid: typeof parsed.uid === "string" ? parsed.uid : "",
      regNo: typeof parsed.regNo === "string" ? parsed.regNo : "",
    };
  } catch {
    return null;
  }
}

export function setStudentIdentity(
  roomCode: string,
  clientId: string,
  name: string,
  uid: string,
  regNo: string,
) {
  safeSet(
    identityKey(roomCode),
    JSON.stringify({ clientId, name, uid, regNo } satisfies StudentIdentity),
  );
}

/** Update only the stored UID once the server confirms it (exam page resume). */
export function persistStudentUid(roomCode: string, uid: string) {
  const existing = getStudentIdentity(roomCode);
  if (existing) {
    safeSet(
      identityKey(roomCode),
      JSON.stringify({ ...existing, uid } satisfies StudentIdentity),
    );
  }
}

/**
 * "Leave room" (student-initiated exit): clears this browser's memory of the
 * attempt. Server data stays until the examiner deletes the room — the
 * examiner's record of the exam is their legitimate retention; the student's
 * copy of the session token is what leaves the browser here.
 */
export function clearStudentIdentity(roomCode: string) {
  safeRemove(identityKey(roomCode));
}
