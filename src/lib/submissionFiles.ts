/**
 * Submission download helpers (examiner side).
 *
 * DOWNLOAD SECURITY MODEL: documents are fetched from the server (the Convex
 * deployment's HTTP router, NOT this app's origin — see exportUrl below).
 * The examiner's client requests short-lived, single-use export tickets from
 * a server mutation (which owner-checks every room+student pair and computes
 * the authoritative filename), then downloads from /export/submission with
 * the examiner's Convex Auth JWT in an Authorization header. The route
 * re-authenticates the session, the ticket is consumed single-use, and the
 * internal action re-verifies ownership before returning the submission's
 * ORIGINAL bytes — contents, formatting, and encoding preserved, no
 * conversion. A student can neither mint a ticket nor reach the route.
 */

/**
 * Absolute URL base for Convex HTTP routes.
 *
 * ROOT-CAUSE NOTE (the historical 404): the download route lives on the
 * CONVEX deployment's *.convex.site host. A relative path such as
 * "/export/submission" resolves against the APP's origin, where only the
 * SPA exists — the server answered with index.html and the router rendered
 * the NotFound page. Building the absolute URL from VITE_CONVEX_URL (the
 * https://<deployment>.convex.cloud backend, converted to .convex.site)
 * points the request at the route that actually exists.
 */
export function convexHttpBase(): string {
  const raw = import.meta.env.VITE_CONVEX_URL ?? "";
  if (!raw) return "";
  return raw.replace(/\.convex\.cloud/, ".convex.site").replace(/\/+$/, "");
}

/**
 * Full URL + auth headers for one export download. `token` is the examiner's
 * Convex Auth JWT (useAuthToken) — the route rejects requests without it,
 * so a plain navigation could never download anything.
 */
export function exportUrl(
  ticket: string,
  token: string | null,
): { url: string; init: RequestInit } {
  const url = `${convexHttpBase()}/export/submission?ticket=${encodeURIComponent(ticket)}`;
  return {
    url,
    init: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
  };
}

/**
 * Turn a free-text name into a filesystem-safe filename fragment:
 * - trim (names stay user-facing; no case folding)
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
 * ZIP folder per student: "{ID}-{Name}" e.g. "24BCA10222-Tejveer-Singh".
 * The student's own institutional ID (regNo) wins when present, else the
 * server-minted unique UID — so same-named students never collide and IDs
 * sort naturally. The per-file name inside comes from the server.
 */
export function submissionFolderName(
  studentName: string,
  studentUid: string,
  regNo?: string | null,
): string {
  const id = sanitizeFilename(regNo || studentUid) || studentUid;
  const name = sanitizeFilename(studentName) || "student";
  return `${id}-${name}`;
}

/**
 * Build a safe default zip name from a room name:
 * "Intro to Algorithms — Midterm!" → "Intro-to-Algorithms-Midterm-submissions"
 * (the sanitizer collapses runs, so an em-dash becomes a single hyphen).
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
