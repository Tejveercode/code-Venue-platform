// ---------------------------------------------------------------------------
// Versioned policy constants + DPDP data inventory (single source of truth).
//
// WHY CONSTANTS: the consent/notice flow records a policyVersion string at
// consent time (see schema.consentRecords). Keeping the version ids and the
// "what we process" inventory in ONE module guarantees the recorded version
// always corresponds to the notice the person actually saw — bump the
// version here whenever the linked policy page's substance changes.
//
// LEGAL STATUS: these are technical controls implementing the DPDP Act 2023
// requirements identified for this product. Legal applicability and the
// final policy wording require human/legal review before launch. Nothing
// here claims compliance, DPO status, or Significant Data Fiduciary status.
// ---------------------------------------------------------------------------

/** Currently published policy versions. Bump when the notice substance changes. */
export const POLICY_VERSIONS = {
  privacy: "2026-09-24.1",
  terms: "2026-09-24.1",
  cookies: "2026-09-24.1",
} as const;

/** Effective date shown on every policy page. */
export const POLICY_EFFECTIVE_DATE = "24 September 2026";

/**
 * Grievance / privacy contact. Code Venue is not appointed as a Data
 * Fiduciary with a government-registered DPO (no such appointment has been
 * made for this product), so the notice offers a designated privacy contact
 * — not a fabricated DPO. Wire this to a real monitored inbox before launch.
 */
export const PRIVACY_CONTACT = {
  role: "Designated privacy contact (Code Venue)",
  email: "privacy@codevenue.app",
  responseAim: "within 30 days",
};

/**
 * DPDP data inventory — every personal-data category the product actually
 * processes today, with purpose, location, access, processors, retention,
 * and the deletion path. This is the audit-facing inventory; each entry maps
 * to a concrete table or browser key in this codebase. Anything not listed
 * here is not collected (data minimization by construction).
 */
export const DATA_INVENTORY: {
  category: string;
  collected: string;
  purpose: string;
  stored: string;
  access: string;
  processors: string;
  retention: string;
  deletion: string;
}[] = [
  {
    category: "Examiner account",
    collected: "Email address, chosen display name",
    purpose: "Account creation and sign-in (email OTP); addressing the person",
    stored: "Convex `users` + `examiners` tables",
    access: "The examiner (own row via auth); platform operators of the deployment",
    processors: "Convex (database/hosting), Resend (delivers OTP email)",
    retention: "Until the account is erased via a privacy request, or the deployment is retired",
    deletion: "Privacy request → erasure (rooms cascade first, then account row)",
  },
  {
    category: "Student exam identity",
    collected: "Name typed at join; optional institutional ID (regNo); server-minted public ID (S-XXXXXX)",
    purpose: "Identifying attempts within one exam room; matching downloads to students",
    stored: "Convex `students` table (one row per attempt)",
    access: "The owning examiner (roster, monitoring, submissions); the student themselves on their own exam page",
    processors: "Convex only",
    retention: "While the room exists; removed with the room",
    deletion: "Examiner deletes the room (deleteRoom) or erases their account",
  },
  {
    category: "Submissions and answers",
    collected: "Autosaved and final code text, edit revision counters, save/submit timestamps",
    purpose: "Delivering the exam and enabling grading — the core service",
    stored: "Convex `submissions` table",
    access: "The owning examiner; the student via their own secret session token",
    processors: "Convex only",
    retention: "While the room exists (grading may run after the exam ends)",
    deletion: "Examiner deletes the room or erases their account",
  },
  {
    category: "Session capability token",
    collected: "A random 128-bit token (clientId) kept in the browser's local storage per joined room",
    purpose: "Authenticating this attempt's reads/writes — essential technical storage",
    stored: "Browser local storage (`cv:identity:<CODE>`); the token lives in Convex `students.clientId`",
    access: "The browser that joined; server-side resolution by token",
    processors: "None beyond hosting",
    retention: "Until the student leaves the room, the room is deleted, or browser data is cleared",
    deletion: "\"Leave room\" locally clears it; room deletion removes the server row",
  },
  {
    category: "Browser session id",
    collected: "An opaque random id (browserId) kept in local storage for the current join flow",
    purpose: "Letting the SERVER decide whether a re-join resumes the same attempt — prevents one browser's students from inheriting each other's submissions (essential, non-tracking)",
    stored: "Browser local storage (`cv:browserId`); mirrored in `students.browserId`",
    access: "The browser that generated it; server-side join logic only",
    processors: "None beyond hosting",
    retention: "Until browser data is cleared; per-attempt copies go with the room",
    deletion: "\"Leave room\" clears it; room deletion removes per-attempt copies",
  },
  {
    category: "Editor preferences",
    collected: "Code editor theme (light/dark) and font size",
    purpose: "Remembering the student's accessibility settings — essential technical storage",
    stored: "Browser local storage only (`cv:editor:*`)",
    access: "The browser only — never transmitted",
    processors: "None",
    retention: "Until browser data is cleared",
    deletion: "Browser settings / \"Leave room\" clear",
  },
  {
    category: "Exam monitoring events",
    collected: "Event type + timestamp (tab switch, paste, copy, page reload); per-student tally; zero-tolerance flags",
    purpose: "Exam integrity at the examiner's discretion — detecting, not preventing, and never recording content",
    stored: "Convex `violationEvents` + tallies on `students`",
    access: "The owning examiner only",
    processors: "Convex only",
    retention: "While the room exists",
    deletion: "Room deletion cascades to events",
  },
  {
    category: "Consent records",
    collected: "Subject identifier (email or S-UID), purpose, policy version, granted/withdrawn, timestamp",
    purpose: "Evidencing consent and its withdrawal for the version actually shown",
    stored: "Convex `consentRecords` table",
    access: "Platform operators; the examiner for their own records",
    processors: "Convex only",
    retention: "Retained as the record of the consent lifecycle (evidence purpose)",
    deletion: "Removed only with a justified erasure of the related account record",
  },
  {
    category: "Privacy/grievance requests",
    collected: "Request kind, message text, filing identity",
    purpose: "Handling access/correction/erasure/grievance requests",
    stored: "Convex `privacyRequests` table",
    access: "Platform operators; the requester sees their own requests",
    processors: "Convex only",
    retention: "Retained as the record of handling",
    deletion: "Retention is the point (evidencing the response); reviewed periodically",
  },
  {
    category: "Security event log",
    collected: "Event class, short detail, optional ids, timestamp — no tokens, no personal content",
    purpose: "Breach readiness: reconstructing what happened, when, and who was affected",
    stored: "Convex `securityEvents` table + Convex function logs",
    access: "Platform operators only",
    processors: "Convex (logs)",
    retention: "Rolling operational window; sized to the incident-response need",
    deletion: "Periodic review/pruning by the operator",
  },
];

/**
 * Cookie/storage classification. There are no marketing or analytics
 * cookies; nothing optional is loaded before or after consent. These three
 * items are essential technical storage (they deliver the service the user
 * asked for) — which is why the notice says no consent banner is needed.
 */
export const STORAGE_DISCLOSURE = [
  { name: "cv:identity:<room code>", kind: "Essential", purpose: "Secret session token for the joined exam attempt (resume without re-joining)" },
  { name: "cv:browserId", kind: "Essential", purpose: "Opaque per-browser id so the server can tell attempts apart securely" },
  { name: "cv:editor:theme / cv:editor:fontSize", kind: "Essential", purpose: "Remembers the student's editor accessibility preferences" },
  { name: "Convex Auth session", kind: "Essential", purpose: "Keeps examiners signed in (httpOnly cookie managed by Convex Auth)" },
] as const;

/** Third-party processors actually in the chain today. */
export const PROCESSORS = [
  { name: "Convex", role: "Database, backend functions, hosting of the app and its data" },
  { name: "Resend", role: "Delivers one-time sign-in codes by email (examiner accounts only). Receives: the examiner's email address and the code." },
] as const;

/** Students under 18: what the notice says (children's data safeguards). */
export const CHILDREN_NOTE =
  "Code Venue is used in classrooms, and examiners may direct it at students under 18. " +
  "Students' personal data is limited to what the exam needs (name, optional institutional ID, " +
  "their code submissions), it is visible to their own examiner, and it disappears with the exam " +
  "room. If you are a parent or guardian and want your child's exam data deleted, contact the " +
  "examiner who ran the exam — they can delete the room and everything in it — or reach our " +
  "privacy contact above.";
