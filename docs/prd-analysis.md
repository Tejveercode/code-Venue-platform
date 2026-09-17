# CodeVenue — PRD Analysis (Working Document)

**Purpose:** evidence base for `docs/PRD.md`. Every claim below was verified by reading repository source during PRD generation (Sept 2026). Status labels: **IMPLEMENTED** / **PARTIALLY IMPLEMENTED** / **REQUIRED (future)** / **UNKNOWN — needs validation**.

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
