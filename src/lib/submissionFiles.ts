/**
 * Submission download helpers (examiner side).
 *
 * Naming convention shared by the single-file and zip flows:
 *   "{student name}_{last 6 chars of ID}.txt"  e.g. "Akash_A10210.txt"
 * The ID is the student's own institutional ID (regNo) when they entered one,
 * otherwise the server-minted unique UID ("S-7F3K2Q"). The last-6 fragment
 * keeps same-named students apart (two "Akash Singh"s with different roll
 * numbers get different files); for server-minted UIDs it is exactly the
 * unique random part (the "S-" prefix is constant). A residual collision —
 * identical names AND identical last-6 — is impossible inside a zip because
 * the archive builder appends -2, -3, … to duplicates. ".txt" is used
 * because submission code is stored as plain text and no language detection
 * is attempted.
 */

/**
 * Turn a free-text name into a filesystem-safe filename fragment:
 * - trim, lowercase not applied (names are user-facing)
 * - remove path/OS-reserved characters, collapse whitespace to hyphens
 * - strip leading/trailing separators and control chars
 */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[^\w\s.-]/g, "") // drop anything but word chars, spaces, dot, hyphen
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "") // no leading/trailing separators or dots
    .slice(0, 80); // keep filenames reasonable on every OS
}

/**
 * "{name}_{last-6-of-ID}.txt" — the canonical per-student filename. `regNo`
 * (the student's own institutional ID) wins when present; `studentUid` is
 * the always-present fallback. IDs shorter than 6 chars are used whole.
 */
export function submissionFileName(
  studentName: string,
  studentUid: string,
  regNo?: string | null,
): string {
  const base = sanitizeFilename(studentName) || "student";
  const fullId = sanitizeFilename(regNo || studentUid) || studentUid;
  const id = fullId.slice(-6) || fullId;
  return `${base}_${id}.txt`;
}

/**
 * Build a safe default zip name from a room name:
 * "Intro to Algorithms — Midterm!" → "Intro-to-Algorithms--Midterm.txt"… no:
 * em-dashes are stripped by the sanitizer; result e.g. "Intro-to-Algorithms--Midterm"
 * (the sanitizer collapses runs, so em-dash becomes a single hyphen).
 */
export function defaultZipName(roomName: string): string {
  const base = sanitizeFilename(roomName) || "submissions";
  return `${base}-submissions`;
}

/**
 * Trigger a browser download of a Blob. Works in all modern browsers without
 * the File System Access API; revoke the object URL after the click.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next macrotask so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** The one import that must stay lazy — keeps JSZip (~100kB) out of the initial bundle. */
export async function loadZipLib() {
  return await import("jszip");
}
