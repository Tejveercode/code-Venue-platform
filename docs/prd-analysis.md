# CodeVenue — PRD Analysis (Working Document)

**Purpose:** evidence base for the PRD. Every claim below was verified by reading repository source during PRD generation (Sept 2026). Status labels: **IMPLEMENTED** / **PARTIALLY IMPLEMENTED** / **REQUIRED (future)** / **UNKNOWN — needs validation**.

> **v2.0 note (Sept 17, 2026):** the main PRD was restructured for readability (now `docs/PRD.md` v2.0, 22 sections; v1 archived at `docs/archive/PRD-v1.md`). The engineering-registers below are the relocated home for v1 content that did not belong in the product narrative: Security Requirements (SEC-1…9), Open Questions (OQ-01…09), Risks (R-1…7), and Test Requirements (T-1…9) retain their v1 numbering and full text in the sections appended at the end of this file. The v1→v2 requirement ID cross-reference is in the section "v1 → v2 requirement ID map".

---

## Checkpoint 0 — Repository Access

| Item | Finding |
|---|---|
| Repository access | ✅ Accessible (local working tree of the CodeVenue project; the prompt's expected name `Tejveercode/code-Venue-platform` could not be confirmed — see Unknown Features) |
| Default / current branch | ⚠️ Git commands are blocked in this environment ("Git and GitHub commands are blocked; Vly manages version control"). Branch inspection and creation were **not possible via CLI**. Recorded honestly; see Checkpoint 13. |
| Repository structure | ✅ Inspected (single full-stack JS/TS app) |
| docs/ directory | Did not exist prior to this task. Root has `README.md` (placeholder dots only — no real content) and `integrations.md`. No documentation convention to inherit. |
| Existing PRD | None. |

**Access failure recorded:** git CLI blocked → Checkpoint 13 (branch/commit/push/PR) could not be executed. No retries were attempted beyond a single confirmation. Work continues because later checkpoints do not depend on git.

---

## Checkpoint 1 — Repository Inventory

### Technology Stack (verified in `package.json`, `vite.config.ts`, `src/convex/*`)

| Layer | Technology | Evidence |
|---|---|---|
| Frontend | React 19 + TypeScript 5.9 (strict), Vite 7 | `package.json`, `tsconfig.app.json` |
| Routing | react-router 7, lazy-loaded route chunks | `src/main.tsx` |
| Styling | Tailwind CSS 4 + hand-rolled warm cream/caramel design-token system (`src/index.css`, `src/index-monitor.css`) | stylesheet sources |
| UI kit | shadcn/ui on Radix primitives (installed, used selectively — app's own `cv-*` component system dominates) | `src/components/ui/*`, `src/components/venue/ui.tsx` |
| Animation | framer-motion (Landing + About pages) | `src/pages/*.tsx` |
| Code editor | CodeMirror 6 (`state/view/commands/language/search/autocomplete`, `theme-one-dark`) + 5 language grammars (Python, C++, Java, JS/TS, SQL), code-split | `src/components/venue/CodeEditor.tsx`, `package.json` |
| Backend | Convex functions (queries/mutations) — no separate server | `src/convex/*.ts` |
| Database | Convex document store with explicit indexes | `src/convex/schema.ts` |
| Auth | Convex Auth: examiner = email OTP; students = no account (capability token) | `src/convex/auth.ts`, `auth/emailOtp.ts`, `auth.config.ts` |
| Rate limiting | `@convex-dev/rate-limiter` (7 named policies) | `src/convex/rateLimits.ts` |
| File export | client-side JSZip (lazy) for submission downloads | `src/lib/submissionFiles.ts` |
| Hosting | vercel.json SPA rewrite; Convex-managed backend | `vercel.json` |
| Dev tooling | Bun, ESLint, Prettier, Playwright (QA harness) | `package.json`, `qa/` |

### Project Structure (Layer 1–2)

```
src/
  main.tsx                 # entry, providers (ConvexAuthProvider), routes, RootErrorBoundary
  convex/
    schema.ts              # 6 domain tables + auth tables
    exams.ts               # 1,283 lines — ALL product logic (examiners, rooms, join,
                           #   submissions, monitoring) 
    auth.ts / auth/emailOtp.ts / auth.config.ts / http.ts
    validation.ts          # reject-not-sanitize validators with user-facing messages
    limits.ts              # single source of truth for all input bounds
    rateLimits.ts          # all 7 rate-limit policies with rationale comments
    users.ts               # read-only current-user helper
  pages/                   # 9 lazy routes (see IA below)
  components/
    venue/ui.tsx           # shared shell: CodeVenuePage, VenueHeader, pills, Modal, QuestionBox
    venue/CodeEditor.tsx   # CodeMirror 6 wrapper (compartments, lazy grammars)
    venue/motion.ts        # shared framer-motion presets (reduced-motion aware)
    venue/PixelCanvas.tsx / VoidFieldCanvas.tsx   # decorative animated background + readability veil
    examiner/              # ExaminerDashboard, ExamSummaryCard, MonitoringPanel, RoomFormModal
  lib/                     # errors.ts, submissionFiles.ts, violationEvents.ts, utils.ts
qa/                        # Playwright visual/interaction QA harness + dashboard scenarios
vercel.json, vite.config.ts, index.html
```

**Not present (verified):** Docker/docker-compose, CI workflows, test runner/unit tests, `.env.example`, admin UI, multi-file projects, code execution service, leaderboard, notifications.

### Feature State Summary

| Feature | State | Evidence |
|---|---|---|
| Examiner sign-up/sign-in (email OTP) | IMPLEMENTED | `auth/emailOtp.ts`, `/auth` page, `signInNextStep` |
| One-time name prompt + rename + profile | IMPLEMENTED | `setExaminerName`, `updateExaminerName`, Profile modal |
| Room create/edit/close/delete | IMPLEMENTED | `createRoom`/`updateRoom`/`endRoom`/`deleteRoom` |
| Server-minted room codes CV-#### | IMPLEMENTED | `generateRoomCode`, `by_code` unique index |
| Case-insensitive room-name uniqueness | IMPLEMENTED | `assertUniqueRoomName` |
| Student join by code (no account) | IMPLEMENTED | `joinRoom` |
| Capacity enforcement (server-side) | IMPLEMENTED | `joinRoom` joined-length check |
| Rejoin/refresh recovery | IMPLEMENTED | `existingClientId` → same row; `getMySubmission` |
| Timed exam, server-clock timer | IMPLEMENTED | `startedAt` basis, `Timer` component (pauses when tab hidden) |
| Autosave (2.5 s debounce, server-damped 1/s) | IMPLEMENTED | `Exam.tsx` debounce; `AUTOSAVE_MIN_INTERVAL_MS` |
| Final submit; late submits accepted-but-flagged | IMPLEMENTED | `saveSubmission isFinal`, `late` return |
| Time-up client behavior (auto-final?) | PARTIALLY KNOWN — `Timer.onExpire` exists; exact expiry action needs code-confirm at test time | `Exam.tsx` |
| CodeMirror 6 editor (highlighting, line numbers, bracket match, find, font-size, editor-only light/dark) | IMPLEMENTED | `CodeEditor.tsx` |
| Language selection for the exam | PARTIALLY IMPLEMENTED — editor infers language from room name/prompt text; no schema field; badge shows active mode | `CodeEditor.tsx` inference, no `language` column |
| Monitoring: blur/paste/copy/rejoin event log | IMPLEMENTED | `logViolationEvent`, `logRejoinEvent`, `violationEvents` |
| Server-side tallies + warnings + auto-submit | IMPLEMENTED | `recordViolationEvent`, `enforceAutoSubmit` |
| Live examiner monitoring panel | IMPLEMENTED | `getRoomMonitoring`, `MonitoringPanel.tsx` |
| Flagging (zero-tolerance) | IMPLEMENTED | `limit === 0 → flagged` |
| Submissions list + downloads + zip | IMPLEMENTED | `getRoomSubmissions`, `Submissions.tsx`, `submissionFiles.ts` |
| Role/permission model (RBAC) | PARTIALLY IMPLEMENTED — two roles enforced by construction (auth examiner / token student); template's `users.role` (admin/user/member) exists but is unused | `schema.ts ROLES`, `requireExaminer`, `requireOwnedRoom` |
| Code execution, test cases, grading | NOT IMPLEMENTED | no execution code; PRD marks REQUIRED-future |
| Leaderboards, scores, notifications, analytics | NOT IMPLEMENTED | nothing in schema |
| Multi-file projects / file management | NOT IMPLEMENTED | single code string, 64 KB cap |
| Student identity: name + optional regNo + minted UID | IMPLEMENTED | `students` fields, `generateStudentUid` |
| Anti-enumeration room-state gating | IMPLEMENTED | `getExamRoomState` capability gate; `lookupRoomByCode` deleted |

### Important Files (priority order for future readers)

1. `src/convex/exams.ts` — entire product backend
2. `src/convex/schema.ts` — data model
3. `src/convex/limits.ts` + `validation.ts` + `rateLimits.ts` — the security contract
4. `src/pages/Exam.tsx` — student exam surface (timer, autosave, violations)
5. `src/components/venue/CodeEditor.tsx` — editor integration
6. `src/components/examiner/ExaminerDashboard.tsx` + `MonitoringPanel.tsx`
7. `qa/visual-qa.mts` — existing automated checks (widths 390→2560, zooms 67–167%, keyboard, touch targets, focus visibility, overflow)

---

## Checkpoint 2 — Workflow Traces (UI → state → mutation → DB → reactive UI)

**Trace A — Create exam room**
`ExaminerPortal` “Create New Exam” → `RoomFormModal` (client validation) → `createRoom` mutation → `requireExaminer` (auth) → rate limit `createRoomPerExaminer` (20/h) → validators → name-uniqueness check → code mint w/ 10 retries on `by_code` collision → `rooms` insert (status LIVE, `startedAt = now`) → returns `{roomId, code}` → dashboard list reacts (Convex subscription) and new card appears.

**Trace B — Student join**
`StudentPortal` → code+name+optional regNo → `joinRoom` → input validation (reject-first) → per-code fixed window 60/min + per-session token bucket 5 burst → room lookup by code → CLOSED/full checks (server-side capacity) → existing `clientId` reuses row (rejoin) or mints 128-bit `clientId` + public UID → response stored in localStorage per room code → navigate `/exam/:code`.

**Trace C — Exam taking**
`/exam/:code` → `getExamRoomState` with clientId (capability gate: prompt/timer only for members) → CodeEditor mounts → keystrokes update local state → 2.5 s debounced `saveSubmission(isFinal:false)` (server damps to 1 write/s; silent rate-limit failures keep draft dirty for retry) → blur/paste/copy events → `logViolationEvent` (event only; no clipboard content) → server tallies, warns, auto-submits on limit → student sees warning countdown / auto-submit banner.

**Trace D — Monitoring & submission**
`ExaminerExamDetail` → `getRoomMonitoring` (owner-gated) → reactive per-student rows with per-type breakdown, recent events, rejoin timestamps → `Submissions` page → `getRoomSubmissions` → per-file download `{name}_{last6ofID}.txt` or JSZip all (lazy import).

**Trace E — Auth**
Email → OTP (provider-enforced 10 failed attempts/h; send limits 3 burst/5-per-10min per email, 120/h global) → verify → `signInNextStep` (deliberately a mutation to avoid reactive flash) → name prompt if first time → `RequireAuth` guards `/examiner-portal`, `/examiner/exams/:roomId`, `/submissions/:roomId`, preserving returnTo.

---

## Checkpoint 3 — UX/UI & Dashboard Analysis

**Design system (existing):** warm cream page (`--bg-color`) with white cards, caramel (`#b5734a`) brand accent, deep (`#8a4f2a`) for small labels/buttons, rich (`#7a3b12`) for live/attention/hover states, brick red reserved for destructive. All text tokens audited to ≥ WCAG AA (4.5:1 text; 3:1 UI components) with before/after ratios tracked in-repo (css comments). Elevation via card borders + layered shadows. Animated canvas background with a readability veil (`aria-hidden`), tested in QA.

**Dashboard = Examiner portal. Verified behaviors:**
- Information hierarchy: greeting (Welcome vs Welcome back via `welcomed`), KPI row (live rooms, joined, submitted, flagged, auto-submitted), room cards grouped LIVE first then CLOSED.
- Card carries: name, CV-code pill (click-to-copy), joined/capacity, submitted count, flagged rail (rich-caramel attention treatment), End action (destructive, confirm), Open/Manage, Submissions links.
- Detail separation (correct "not a dumping ground" pattern): monitoring panel and per-student submissions live on `/examiner/exams/:roomId` and `/submissions/:roomId` — dashboard only summarizes counts.
- Empty state: explicit "no rooms yet" with create CTA (`qa` scenario `empty`).
- Loading: spinner placeholders; Convex queries are reactive so updates arrive without refresh.
- Responsive: desktop nav → hamburger ≤ ~860px; card grid collapses to single column; QA harness asserts no horizontal overflow at 390/768/1024/1280/1440/2560, zoom 67–167%, touch targets ≥40px on mobile, focus outline visible, nav centering.

**UX observations → requirements (Problem → Evidence → Impact → Requirement):**
1. Room-code copy affordance is small on mobile → code pill present but hit-area limited → error-prone when broadcasting code to class → **R:** code pill must be copyable and ≥40px touch target on ≤480px.
2. Monitoring is per-room reactive within seconds — examiner must keep detail page open → no global alert surface → **R:** flagged/auto-submit counts must be visible at dashboard level (they are) and detail drill-in must be one click (it is). A push/notification layer is future scope.
3. Language inference (editor) can mismatch prompt intent → student may get wrong highlighting; badge shows mode → **R:** make language an explicit examiner field (future FR).
4. Zero-tolerance rooms flag silently (by design, anti-gaming) → students get no warning; examiner sees flag → documented as intentional; needs product-owner validation for classroom policy.
5. README is placeholder → onboarding for contributors relies on code comments (excellent) → **R:** ship this PRD + PRD-README as canonical docs.

---

## Product Modules (Checkpoint 4)

| Module | Purpose | Primary User | Features | Dependencies | State |
|---|---|---|---|---|---|
| Public site | Explain product; route users | All | Landing, About | none | IMPLEMENTED |
| Authentication | Examiner identity | Examiner | Email OTP, name prompt, profile/rename, RequireAuth | Convex Auth, OTP rate limits | IMPLEMENTED |
| Room management | Exam lifecycle | Examiner | Create/edit/close/delete, codes, capacity, violation limit, uniqueness | Auth, validation, rate limits | IMPLEMENTED |
| Student access | No-account exam entry | Student | Join by code, rejoin/refresh recovery, identity (name/regNo/UID) | joinRoom, localStorage | IMPLEMENTED |
| Exam taking | Answer surface | Student | Prompt, server-clock timer, CodeEditor 6, autosave, submit, fullscreen | editor, saveSubmission | IMPLEMENTED (language field: PARTIAL) |
| Monitoring | Integrity signals | Examiner | Event log, tallies, warnings, flags, auto-submit, live panel | violationEvents, rate limits | IMPLEMENTED |
| Submissions | Collection & export | Examiner | List, single/zip download, naming conventions | getRoomSubmissions, JSZip | IMPLEMENTED |
| Evaluation / execution | Grade code | Examiner | Compile/run, tests, scores | **none present** | REQUIRED (future) |
| Analytics / leaderboard | Insights | Examiner | Metrics, rankings | **none present** | REQUIRED (future) |
| Notifications | Alerts | Examiner | Flag alerts | **none present** | REQUIRED (future) |

**Information architecture (routes):** `/` Landing · `/about` About · `/auth` Auth · `/examiner-portal` (protected) · `/examiner/exams/:roomId` (protected) · `/submissions/:roomId` (protected) · `/student-portal` (public) · `/exam/:code` (public) · `*` NotFound.

**Roles:** Examiner (authenticated teacher), Student (unauthenticated exam-taker with capability token), plus template `admin/user/member` role literals present but unused — not documented as supported roles.

## Requirements summary (Checkpoints 5–7)

- **18 functional requirements (FR-001…FR-018)** across auth, rooms, join, exam, editor, monitoring, submissions — full table with current state and acceptance criteria lives in `docs/PRD.md` §14.
- **13 non-functional requirements (NFR-001…NFR-013)** — performance, security, reliability, scalability, accessibility, compatibility, maintainability; unknown targets marked *TBD — validation required* (PRD §17).
- **10 user stories (US-01…US-10)** with preconditions, main/alternative flows, failure cases, and FR links (PRD §15).

## QA & edge cases (Checkpoint 9 — highlights; full table PRD §22)

Invalid/duplicate login OTP (provider limiter), wrong/full/closed room code, stale clientId (rejoin banner), 64 KB code cap, submit-when-closed (late flag), rate-limit hits (silent autosave retry vs loud submit error), zero-tolerance first-event flag, over-limit auto-submit transaction, foreign roomId (null — never data), enumeration attempts (safe subset), network loss during autosave (dirty draft + retry), 400-line paste performance (verified 71–110 ms, internal scroll), empty dashboard, long room names, mobile touch targets.

## Failure log (Checkpoint 13)

- git CLI blocked by environment policy → **no branch, commit, push, or PR was created.** Files were saved to the working tree; the platform's own version-control sync handles persistence. Exact action required: run `git checkout -b docs/codevenue-prd && git add docs/ && git commit -m "docs: add CodeVenue product requirements document"` outside this environment (or enable git in the tool policy).

## Validation performed

- Typecheck baseline verified in prior session (`bun tsc -b --noEmit` exit 0); docs-only changes do not affect it.
- DOCX validated by unzipping the OOXML package and parsing `word/document.xml` (well-formed XML; heading/table/section counts match PRD.md).
- No application code modified during this documentation task.

## Change Log (analysis file)

- 2026-09-17 — v1.0 created: full repository analysis for PRD v1.0.
- 2026-09-17 — v2.0: received relocated registers (SEC, OQ, R, T) from the PRD restructure; added the v1→v2 ID cross-reference; PRD v1 archived under `docs/archive/`.

---

## v1 → v2 requirement ID map

Renumbering kept IDs stable within families wherever possible; v1 FR-012+ shifted to make room for grouped examiner/student sections. v2 introduces **no new scope** — FR-019…022 are renumbered v1 requirements.

| v1 ID | v2 ID | Note |
|---|---|---|
| FR-001…FR-011 | FR-001…FR-011 | Unchanged IDs (grouped under Examiner — Authentication/Exams; some v1 FRs reassigned to different headings only) |
| FR-012 | FR-019 | Integrity event capture (student-side; v1 had it mid-sequence) |
| FR-013 | FR-008 | Warning countdown / auto-submit (grouped under Examiner — Monitoring) |
| FR-014 | FR-009 | Zero-tolerance flagging |
| FR-015 | FR-007 | Live monitoring view |
| FR-016 | FR-011 | Submission downloads |
| FR-017 | FR-022 | Anti-enumeration / capability gating (moved to Shared) |
| FR-006 | FR-006 | Live counts (unchanged) |
| FR-018 (language, planned) | FR-020 | Same requirement, still Planned |
| — (v1 §18.2 EXEC-1…5 prose) | FR-021 + EXEC-1…5 | Execution/grading promoted to a numbered Planned requirement; EXEC guardrails unchanged |
| NFR-001…013 | NFR-01…13 | Zero-padded; same mapping in order |
| US-01…10 | US-01…12 | v1 stories retained; US-11/12 split out weak-connection and late-submit concerns explicitly (content existed in v1 §15 narratives) |
| DR-1…6, UX-1…8 | DR-1…6, UX-1…10 | UX-9 (background/veil readability) and UX-10 (no low-contrast controls) made explicit from v1 §13 findings |
| SEC-1…9 | §16 of PRD (narrative) + register below | Security posture told as narrative; register retains IDs |
| OQ-01…09, R-1…7, T-1…9 | Relocated here (registers below) | Owner owns resolution; PRD points here |

---

## Register — Security Requirements (v1 SEC numbering, full text)

| ID | Requirement | State |
|---|---|---|
| SEC-1 | Examiner-only functions verify session + room ownership on every call ("hiding a button is not access control") | IMPLEMENTED |
| SEC-2 | Student actions resolve exclusively through their own capability token; unknown/foreign tokens rejected before quota consumption | IMPLEMENTED |
| SEC-3 | Input validation is server-side and reject-not-sanitize; bounds in one file | IMPLEMENTED |
| SEC-4 | Rate limits: OTP send (per-email + global), join (per-code + per-session), autosave, submit, room create, violation events; OTP verification attempts limited natively by the auth provider | IMPLEMENTED |
| SEC-5 | Anti-enumeration: public room-state returns a safe subset; deleted the unlimited code-preview function | IMPLEMENTED |
| SEC-6 | Clipboard privacy: monitoring stores event type/time only — never pasted/copied content | IMPLEMENTED (schema-level) |
| SEC-7 | Secrets managed as deployment env vars (email provider keys, site URL); never committed; docs contain none | Constraint — verified |
| SEC-8 | No student PII beyond name + optional institutional ID; UIDs are random, not derived | IMPLEMENTED |
| SEC-9 | Future execution features must add isolation before any student-supplied code runs | REQUIRED (EXEC-1) |

## Register — Open Questions (v1 OQ numbering)

| ID | Question | Why it matters | Owner | Status |
|---|---|---|---|---|
| OQ-01 | Confirm canonical repository name/URL (`Tejveercode/code-Venue-platform`?) | Document identity, CI wiring | Owner | OPEN |
| OQ-02 | Confirm actual deploy URL + email provider in production | Runbooks, deliverability | Owner | OPEN |
| OQ-03 | What exactly happens at time-up on the client (auto-final vs read-only)? | Core exam policy; affects acceptance criteria | Owner + Eng | OPEN — validate against product |
| OQ-04 | Default violation policy for new rooms (0 vs 3)? | Fairness vs signal balance | Owner | OPEN |
| OQ-05 | Adopt or remove the unused `admin/user/member` role literals? | Schema hygiene, future RBAC | Eng | OPEN |
| OQ-06 | Is an external API/export format required (LMS import)? | Integration roadmap | Owner | OPEN |
| OQ-07 | Retention: auto-delete closed rooms after N days? | Privacy/PII policy | Owner | OPEN |
| OQ-08 | Approve analytics instrumentation scope (see PRD §18) | Measurement without surveillance creep | Owner | OPEN |
| OQ-09 | Run the existing Playwright QA harness in CI on every PR? | Regression safety | Eng | OPEN |

## Register — Risks (v1 R numbering)

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-1 | OTP email provider outage blocks examiner sign-in at exam time | M | H | Status monitoring; secondary examiner device; provider failover TBD |
| R-2 | Student clears localStorage mid-exam → new session row; examiner sees a "new" student | M | M | Clear rejoin UX; regNo matching aids identification; consider token backup (future) |
| R-3 | Zero-tolerance mode flags innocent students (touchpad app-switches) | M | M | Default limits > 0; policy copy; examiner override is manual judgment |
| R-4 | Monitoring realism gap: examiner expects prevention | M | M | Explicit in-product language ("detection, not prevention") |
| R-5 | Convex/vendor coupling raises migration cost | M | M | Keep logic centralized; standard schema; export paths (OQ-06) |
| R-6 | Large classes (500) × monitoring events stress reads | L | M | Events capped/read-limited; load test before >200-student use |
| R-7 | Docs drift as product evolves | M | L | PRD-README change process; version bump rule |

## Register — Test Requirements (v1 T numbering)

- **T-1** Unit: validators (`validation.ts`) — every bound and message. → FR-003/006, SEC-3
- **T-2** Unit: rate-limit policy behavior (burst/refill semantics). → SEC-4
- **T-3** Integration: join lifecycle — capacity edge, rejoin identity, closed/full paths. → FR-012/014 (v2)
- **T-4** Integration: autosave + submit state machine (draft→final→locked; late flag). → FR-016/017 (v2)
- **T-5** Integration: violation pipeline — event→tally→warn→flag→auto-submit atomicity. → FR-008/009/019 (v2)
- **T-6** Security: ownership matrix (foreign roomIds/tokens rejected). → SEC-1/2
- **T-7** E2E (Playwright): examiner create→monitor→close→download happy path. → US-01/05/06 (v1)
- **T-8** E2E (Playwright): student join→type→reload→submit. → US-07/08 (v2)
- **T-9** Visual/a11y: existing QA harness in CI. → UX-1/2/5, NFR-10/11
