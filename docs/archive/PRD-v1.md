# CodeVenue — Product Requirements Document

| | |
|---|---|
| **Product** | CodeVenue |
| **Document** | Product Requirements Document |
| **Version** | 1.0 |
| **Status** | Draft — for review |
| **Date** | September 17, 2026 |
| **Repository** | CodeVenue platform repository (`Tejveercode/code-Venue-platform` — name needs validation; see §29 OQ-01) |
| **Owner** | Project owner |
| **Evidence base** | `docs/prd-analysis.md` (repository analysis, Sept 2026) |

**How to read this document.** Every feature claim is labeled: **IMPLEMENTED** (verified in code), **PARTIALLY IMPLEMENTED**, **REQUIRED** (planned, not built), or **UNKNOWN — needs validation**. Priority: P0 critical → P3 low. Terms are defined in §33 Glossary.

---

## 1. Executive Summary

CodeVenue is a web platform for running **live, timed coding exams**. An examiner (teacher) signs in with email, creates an exam room, and shares a short code (**CV-####**). Students join with that code — **no account required** — receive the exam prompt, write code in a real editor (CodeMirror 6), and their work is **autosaved continuously** to the backend and finalized on submit.

While the exam runs, the platform records integrity signals (tab switches, pastes, copies, page reloads) as an append-only server-side event log, derives all tallies and enforcement (warnings, flags, automatic submission) on the server, and shows the examiner a live monitoring view. When the exam ends, the examiner downloads every submission as named text files or a zip.

The product is deliberately focused: it is a **proctoring-aware exam delivery and collection tool**, not a full judge/execution platform. Code execution, test-case grading, scores, and leaderboards do not exist today and are documented as future requirements (§32), not current features.

The current implementation is substantial and internally consistent: strict server-side validation, seven rate-limit policies, capability-token student sessions, and a warm, accessibility-audited design system.

---

## 2. Product Overview

**What CodeVenue is.** A single-page React application backed by Convex (serverless functions + document database). Two experiences:

1. **Examiner portal** (authenticated): create rooms, watch live counts, monitor integrity events, close/delete rooms, download submissions.
2. **Student exam** (unauthenticated): join by room code, take the timed exam in a code editor, autosave and submit.

**What CodeVenue is not (today).** It does not compile, run, or grade code; it does not manage courses, rosters, or schedules; it does not communicate results back to students.

| Aspect | Current reality (evidence) |
|---|---|
| Deployment model | Vercel SPA rewrite + hosted Convex backend (`vercel.json`, `convex/`) — IMPLEMENTED |
| Account model | Examiner email-OTP accounts; students are token-based sessions — IMPLEMENTED |
| Exam format | One prompt (≤10,000 chars), one code answer (≤64 KB), one timer — IMPLEMENTED |
| Integrity model | Detection + response (log, warn, flag, auto-submit), stated openly — IMPLEMENTED |

---

## 3. Problem Statement

**Problem.** Running a coding test for a class today typically means either (a) a shared document or LMS text box with no timing, autosave, or integrity signals, or (b) heavyweight online-judge platforms that require student accounts, internet-scale infrastructure, and impose a judging model the teacher may not want.

**Target users.** Teachers/instructors running in-class or remote coding assessments; students taking them, often on varied personal devices and browsers.

**Existing pain.**

- Student work is lost when a browser tab closes or a laptop dies mid-exam (no autosave).
- Exam windows are honor-system: teachers cannot see who left the tab, pasted large blocks, or reloaded repeatedly.
- Collecting 30+ code submissions means chasing files over email/LMS.
- Requiring every student to create an account adds friction exactly when the clock is ticking.

**Impact if unsolved.** Unfair or unverifiable assessments, lost student work, and hours of manual collection/collation after each exam.

**Opportunity.** CodeVenue removes the account barrier (join by code), protects work (continuous autosave), gives the examiner honest visibility (event log + live monitoring, with all enforcement decided server-side), and produces tidy downloadable submissions in one click.

---

## 4. Product Vision

CodeVenue is the fastest honest way to run a coding exam: a teacher creates a room in under a minute, students join with a four-digit code and start typing immediately, and everything they write is safely stored — while the examiner watches a live, plain-language picture of how the room is behaving. The platform prefers **transparency and signal over surveillance theater**: it records what a web app can genuinely observe, decides consequences on the server, and never pretends to prevent what browsers cannot prevent.

---

## 5. Goals & Objectives

| # | Goal | Measure (see §23) |
|---|---|---|
| G1 | Zero lost work: every keystroke interval reaches the server | Autosave success rate; draft recovery on reload |
| G2 | Join an exam in < 1 minute without an account | Time-to-editor in usability testing (TBD — validation required) |
| G3 | Give examiners actionable integrity signal, not noise | Flag precision feedback from examiners (TBD) |
| G4 | One-click collection of all submissions | Download success; naming consistency |
| G5 | Keep the exam page fast on low-end devices | Route bundle size; long-paste responsiveness (verified: 71–110 ms for 400-line paste) |
| G6 | Accessibility bar: WCAG AA contrast, keyboard operable | QA harness assertions (focus visible, touch targets ≥ 40 px) |

---

## 6. Users & Personas

### P1 — Examiner "Prof. Mehta"
- **Context:** teaches a 60-student course; runs 30-minute in-class coding quizzes on a projector + laptop.
- **Needs:** create an exam fast; share one code; see who has joined/submitted; spot suspicious behavior; collect all answers afterward.
- **Pain points:** monitoring must not require watching every student; closing an exam must be irreversible-safe; same-named students must produce distinct files.
- **Screens:** `/examiner-portal`, `/examiner/exams/:roomId`, `/submissions/:roomId`.

### P2 — Student "Aisha"
- **Context:** joins from a personal laptop or phone hotspot; may reload the page once by accident.
- **Needs:** join instantly with a code, see the question and timer clearly, write code comfortably (syntax highlighting, line numbers), never lose work, know that submit worked.
- **Pain points:** unclear capacity/full errors; losing draft on reload; ambiguous submit state.
- **Screens:** `/student-portal`, `/exam/:code`.

### P3 — Future contributor / evaluator
- **Needs:** understand the architecture quickly (this PRD + `docs/prd-analysis.md` + heavily commented sources).

*No administrator or guest persona is documented: the template's `admin/user/member` role literals exist in `schema.ts` but are unused — not evidence of a supported role.*

---

## 7. Roles & Permissions

| Role | Auth | Permissions | Enforced by |
|---|---|---|---|
| Examiner | Email OTP session | Create/edit/close/delete **own** rooms; view own monitoring; download own submissions; rename self | `requireExaminer` + `requireOwnedRoom` on every room-scoped function |
| Student | 128-bit capability token (`clientId`) minted at join | Act **only** on own session: save/submit own code, report own events, read own room state | Every student mutation resolves the row via `by_client_id` index; foreign tokens rejected |
| Public (no auth) | — | Join a room by code (rate-limited); read safe-subset room status | `getExamRoomState` capability gate; rate limiters |

**Design rule (from code):** hiding a button in the UI is never access control — every backend function re-checks ownership. *IMPLEMENTED.*

---

## 8. Current Product State

### 8.1 Implemented (verified)
- Examiner sign-up/sign-in via email OTP; one-time name prompt; rename; welcome state.
- Room CRUD with server-minted unique `CV-####` codes; per-examiner case-insensitive name uniqueness; LIVE → CLOSED lifecycle (no reopen); cascade delete of submissions/students/events.
- Student join by code with server-side capacity enforcement; refresh-safe rejoin; minted public UID (`S-XXXXXX`) + optional institutional ID.
- Timed exam with server-clock basis (`startedAt` + duration); low-time visual state; pause-when-hidden timer.
- CodeMirror 6 editor: syntax highlighting (Python, C++, Java, JS/TS, SQL — lazily loaded), line numbers, active line, bracket matching, find, auto-close brackets, font-size control, editor-only light/dark themes; fullscreen mode.
- Autosave (2.5 s debounce, ≥1 write/s server damping, silent rate-limit retry) and final submit (late submits accepted but flagged).
- Integrity monitoring: blur/paste/copy/rejoin event log (no clipboard content ever stored), server-derived tallies, warning countdown, zero-tolerance flagging, over-limit auto-submit in the same transaction.
- Examiner live monitoring panel with per-student breakdown and recent events; flagged/auto-submitted counts on the dashboard.
- Submissions list; per-student and zip downloads with collision-safe naming.
- Warm cream/caramel design system with documented WCAG AA contrast audit; reduced-motion-aware animation; responsive layout verified by automated QA harness at 390–2560 px and 67–167% zoom.

### 8.2 Partially implemented
- **Exam language** — editor infers the language from room name/prompt text; there is no examiner-facing language setting, and the stored submission is plain text (`.txt` downloads). A badge always shows the active mode. → make explicit (FR-018, future P2).
- **Time-up behavior** — the timer exposes an expiry hook; the precise end-of-time action (client auto-submit vs read-only lock) must be confirmed against the running product. *UNKNOWN — needs validation* (OQ-03).
- **Role model** — two effective roles exist by construction; the schema's unused role literals should be removed or adopted (OQ-05).

### 8.3 Not implemented (explicitly future — §32)
Code execution/sandboxing, test cases (visible or hidden), automated grading, scores, leaderboards, notifications/alerts, course/roster management, multi-file projects, file attachment, student accounts, mobile app.

---

## 9. Product Architecture Overview

```
Browser (React 19 SPA, lazy routes)
  ├── Public pages: Landing, About, StudentPortal, Exam
  ├── Examiner pages (RequireAuth): Portal, ExamDetail, Submissions
  └── ConvexAuthProvider ⇄ Convex backend (queries + mutations, reactive subscriptions)
        ├── exams.ts        — all product logic (examiners, rooms, join, submissions, monitoring)
        ├── auth/emailOtp   — OTP send/verify (provider-enforced attempt limits)
        ├── validation.ts   — reject-not-sanitize validators (user-facing messages)
        ├── limits.ts       — every input bound, single source of truth
        ├── rateLimits.ts   — 7 named policies (token bucket / fixed window)
        └── schema.ts       — 6 domain tables with explicit indexes
Hosting: Vercel (SPA rewrites) + Convex cloud (functions + document DB)
```

**Key architectural properties (evidence-based):**
- **Reactive data:** examiner dashboards subscribe to queries; counts and monitoring update without refresh.
- **Server-authoritative enforcement:** clients report *events*, never counts or outcomes; warnings/flags/auto-submit are decided in mutations.
- **Capability tokens, not accounts,** for students: a `clientId` only ever maps to one student row in one room.
- **Reject-not-sanitize validation** with user-facing messages surfaced by the UI.

---

## 10. Information Architecture

| Route | Access | Purpose |
|---|---|---|
| `/` | public | Landing: explain product, route to examiner/student flows |
| `/about` | public | Product story |
| `/auth` | public | Email OTP sign-in/up + one-time name prompt; honors `returnTo` |
| `/examiner-portal` | examiner | Dashboard: greeting, KPIs, room cards, create room |
| `/examiner/exams/:roomId` | examiner | Room detail: settings, monitoring panel, end/delete |
| `/submissions/:roomId` | examiner | Submission list + downloads |
| `/student-portal` | public | Join form (code, name, optional ID) |
| `/exam/:code` | public (token-gated data) | The exam: prompt, timer, editor, submit |
| `*` | public | 404 |

Navigation: shared `VenueHeader` (desktop row; hamburger below ~861 px). Examiner detail pages provide back-links rather than deep menus.

---

## 11. Product Modules

| Module | Purpose | Primary user | Key features | Dependencies | State |
|---|---|---|---|---|---|
| Public site | Explain + route | All | Landing, About | — | IMPLEMENTED |
| Authentication | Examiner identity | Examiner | Email OTP, name prompt, profile, route guard | Convex Auth, OTP limits | IMPLEMENTED |
| Room management | Exam lifecycle | Examiner | Create/edit/close/delete, codes, capacity, violation limit, name uniqueness | Auth, validation, rate limits | IMPLEMENTED |
| Student access | Frictionless entry | Student | Join by code, rejoin, identity fields | joinRoom, localStorage | IMPLEMENTED |
| Exam taking | The answer surface | Student | Prompt, timer, editor, autosave, submit, fullscreen | CodeEditor, saveSubmission | IMPLEMENTED (language: partial) |
| Integrity monitoring | Honest signal | Examiner | Event log, tallies, warnings, flags, auto-submit, live panel | violationEvents, limits | IMPLEMENTED |
| Submissions | Collection/export | Examiner | List, file/zip download, naming | getRoomSubmissions, JSZip | IMPLEMENTED |
| Evaluation | Grade code | Examiner | Execution, tests, scores | **none present** | REQUIRED (future) |
| Analytics / leaderboard | Insight | Examiner | Metrics, rankings | **none present** | REQUIRED (future) |
| Notifications | Push alerts | Examiner | Flag alerts | **none present** | REQUIRED (future) |

**Why this grouping:** modules split along the two trust boundaries (authenticated examiner vs token-bearing student vs public) and along lifecycle phases (setup → live → collect). Evaluation/analytics are kept out of the current modules because nothing in the schema or code supports them.

---

## 12. Dashboard Requirements

The examiner dashboard is the product's control room — it must **summarize, not swallow**, the detail views.

### 12.1 Information hierarchy (current, to be preserved)
1. **Greeting + primary action** — Welcome / Welcome back; “Create New Exam” is the single primary CTA.
2. **KPI row** — live rooms, total joined, submitted, flagged, auto-submitted (live via subscription).
3. **Room cards**, LIVE first then CLOSED: name, code pill (copy), joined/capacity, submitted count, flagged rail, actions (Open/Manage, Submissions, End).
4. **Empty state** — explicit “no rooms yet” with create CTA.

### 12.2 Dashboard rules (requirements)
| ID | Requirement | Rationale / evidence |
|---|---|---|
| DR-1 | The dashboard shows **counts only** for monitoring; per-student detail belongs to the room detail page. | Detail panels exist at `/examiner/exams/:roomId` (IMPLEMENTED) |
| DR-2 | Flagged and auto-submitted totals must be visible **at dashboard level** without opening a room. | Examiner needs immediate signal (KPI row, IMPLEMENTED) |
| DR-3 | Every destructive action (End, Delete) requires explicit confirmation and uses the destructive color, distinct from attention states. | `endRoom`/`deleteRoom` are irreversible; UI confirm modals (IMPLEMENTED) |
| DR-4 | Empty, loading, and error states are mandatory for every dashboard data region; the dashboard must never render as a blank shell. | QA harness `empty` scenario (IMPLEMENTED) |
| DR-5 | The room code must be copyable in one interaction with a ≥ 40 px touch target on mobile. | Code pill is small today on narrow screens — UX gap → requirement |
| DR-6 | Closed rooms move below live rooms and lose edit affordances (server rejects edits too). | `updateRoom` refuses non-LIVE (IMPLEMENTED) |

---

## 13. UX/UI Requirements

### 13.1 Design system (keep)
- **Theme:** warm cream background, white cards, caramel family only for brand/attention: `caramel` (chrome) → `deep` (buttons/labels) → `rich` (live/attention/CTA hover). Brick red is destructive-only. No second hue.
- **Contrast:** WCAG AA — 4.5:1 text, 3:1 UI components/borders — against **both** page and card surfaces (audited in-repo with recorded ratios).
- **Elevation:** cards read as lifted layers via border + layered shadows; hover deepens shadows (verified in QA).
- **Motion:** entrance/scroll reveals and hover lifts are opacity/transform only, reduced-motion-aware (framer `useReducedMotion`), and never delay interactivity or LCP text.

### 13.2 UX requirements
| ID | Requirement | State |
|---|---|---|
| UX-1 | All interactive elements show a visible focus indicator (≥ 3:1) and are keyboard-operable in DOM order. | IMPLEMENTED, asserted by QA harness |
| UX-2 | Touch targets ≥ 40 px height on ≤ 480 px viewports for all buttons/pills. | IMPLEMENTED (asserted); code pill needs the DR-5 fix |
| UX-3 | Forms validate inline with the exact server message text; no technical error leakage. | `getErrorMessage` fallback pattern (IMPLEMENTED) |
| UX-4 | Loading is shown per data region (spinner placeholders), never a blank page. | IMPLEMENTED |
| UX-5 | No horizontal page overflow at any supported width or 67–167% zoom; long names wrap, not clip. | QA harness assertions (IMPLEMENTED) |
| UX-6 | Editor chrome (font size, editor theme) is user-persisted and editor-only; the page theme never changes with it. | IMPLEMENTED (localStorage) |
| UX-7 | Animations must not replay on scroll-back (reveal once) and must be instant under reduced motion. | IMPLEMENTED |
| UX-8 | Status pills (Live, flagged, Closed) must meet 3:1 against their own fill and read as distinct states without color-hue changes only. | IMPLEMENTED via shade ladder |

### 13.3 Known UX gaps → tracked requirements
- Room-code copy hit-area on mobile (→ DR-5, P2).
- No examiner-facing exam language control (→ FR-018, P2).
- No notification surface when a student is flagged mid-exam beyond the live panel counts (→ future module, P3).

---

## 14. Functional Requirements

Priorities: **P0** = product fails without it; **P1** = core usability/safety; **P2** = important; **P3** = later.

| ID | Requirement | User | Priority | Current state | Acceptance criteria (summary — full Given/When/Then in §16) |
|---|---|---|---|---|---|
| FR-001 | Examiner signs up/in with email OTP; first login prompts one-time name capture | Examiner | P0 | IMPLEMENTED | Valid email receives a code; correct code → session; new accounts see name prompt exactly once; returning examiners never see it again |
| FR-002 | Only authenticated examiners reach examiner routes; unauthenticated users are redirected to `/auth?returnTo=…` and returned after sign-in | Examiner | P0 | IMPLEMENTED | Deep link to `/examiner-portal` while signed out lands on `/auth`; after sign-in, original destination restores |
| FR-003 | Examiner creates a room: name (≤120), prompt (≤10,000), duration (1–1440 min), capacity (1–500), optional violation limit (0–999) | Examiner | P0 | IMPLEMENTED | Valid input → room LIVE with unique `CV-####`; duplicate own-name (case-insensitive) rejected inline; server re-validates everything |
| FR-004 | Examiner edits a room while LIVE; closed rooms are not editable | Examiner | P0 | IMPLEMENTED | Edits persist reactively; `updateRoom` on CLOSED room errors |
| FR-005 | Examiner closes a room (final) and may delete it with all data, after explicit confirmation | Examiner | P0 | IMPLEMENTED | Closed room rejects joins; delete removes submissions/students/events and reports counts |
| FR-006 | Student joins with valid code + name (≤60) + optional institutional ID (3–24 chars) — no account | Student | P0 | IMPLEMENTED | Valid join → exam page with prompt; unknown/closed/full rooms produce specific friendly errors |
| FR-007 | Server enforces capacity; rejoining the same browser does not consume a second seat | Student | P0 | IMPLEMENTED | Join rejected at limit with clear message; refresh with token returns to same row |
| FR-008 | Exam page shows the prompt and a countdown computed from the server clock; < 5 min shows a low-time state | Student | P0 | IMPLEMENTED | Timer does not drift with device clock changes; low state appears < 5:00 |
| FR-009 | Autosave persists the draft continuously (client 2.5 s debounce; server ≥1 write/s damping) and restores it after reload | Student | P0 | IMPLEMENTED | Reload mid-exam restores code; rate-limited saves fail silently and retry on the next tick |
| FR-010 | Student finalizes with Submit; late submits (after time or close) are accepted but flagged to the examiner | Student | P0 | IMPLEMENTED | Submit locks further autosaves; late returns `late: true` and the submission is marked |
| FR-011 | The code editor provides syntax highlighting, line numbers, active-line, bracket matching, find, auto-close brackets, font-size control, and an editor-only light/dark toggle | Student | P1 | IMPLEMENTED | Toolbar controls persist across sessions; page theme unaffected; language badge shows active mode |
| FR-012 | Tab switches, pastes, copies, and reloads are recorded as individual server events; clipboard **content is never transmitted or stored** | Student/Examiner | P1 | IMPLEMENTED | Events appear in the monitoring log with type+time only |
| FR-013 | With a violation limit > 0, the student sees remaining warnings; exceeding the limit triggers server-side auto-submit of the current draft | Student/Examiner | P1 | IMPLEMENTED | Auto-submit happens in the same transaction as the over-limit event; student sees an explanation banner that survives reload |
| FR-014 | With limit 0 (zero-tolerance), the first enforced violation flags the student silently — no warning, no client-visible enforcement | Examiner | P1 | IMPLEMENTED | Student experience unchanged; examiner sees flag immediately |
| FR-015 | Examiner monitoring view lists every student with per-type breakdown, recent events, and rejoin timestamps; updates reactively | Examiner | P1 | IMPLEMENTED | Rows appear within seconds of events; foreign roomIds return errors, never data |
| FR-016 | Examiner views submissions (final + drafts shown with status) and downloads any single file or all as zip with collision-safe names | Examiner | P1 | IMPLEMENTED | Filename `{name}_{last-6-of-ID}.txt`; duplicates get -2/-3 suffixes in the zip |
| FR-017 | Room state endpoint returns full details only to a valid capability token; others get a safe subset (status only) | Public | P1 | IMPLEMENTED | Code enumeration reveals nothing beyond liveness |
| FR-018 | Examiner sets the exam language explicitly; the editor uses it instead of inference | Examiner | P2 | **REQUIRED (future)** | Language field on room; editor consumes it; legacy rooms fall back to inference with visible badge |

---

## 15. User Stories

### US-01 — Examiner creates an exam (FR-001/002/003)
> **As an** examiner, **I want to** create a timed coding room and get a shareable code, **so that** my class can start within a minute.

- **Preconditions:** signed-in examiner.
- **Main flow:** portal → Create New Exam → fill name/prompt/duration/capacity → save → card appears with `CV-####`.
- **Alternative:** cancel — nothing persists.
- **Failures:** invalid fields → inline server message; duplicate name → specific inline error; rate limit (20/h) → friendly throttled message.
- **Acceptance:** room card shows LIVE, code, counts at 0/0/0.

### US-02 — Student joins (FR-006/007)
> **As a** student, **I want to** join with just a code and my name, **so that** I can start immediately without creating an account.

- **Preconditions:** room LIVE with free seats.
- **Main flow:** student-portal → code + name (+ optional ID) → land on exam page with prompt visible.
- **Alternative:** browser already holds a token for this room → resume same session.
- **Failures:** wrong code; closed room; full room; malformed input — each with a distinct friendly message.
- **Acceptance:** dashboard joined count increments; student UID displayed.

### US-03 — Student takes the exam (FR-008/009/011)
> **As a** student, **I want to** write code in a real editor with my work continuously saved, **so that** a crash or reload never costs me my exam.

- **Main flow:** type → autosave indicator settles → timer counts down.
- **Alternative:** reload page → same draft restored from server.
- **Failures:** network loss → draft stays local, next tick retries; 64 KB cap → clear message.
- **Acceptance:** after reload, editor content identical to last successful save.

### US-04 — Student is warned / auto-submitted (FR-012/013)
> **As a** student, **I want to** know how many warnings remain, **so that** an accidental tab switch doesn't silently end my exam.

- **Main flow:** tab away → warning shows "X of N used"; return and continue.
- **Failure/edge:** exceed limit → exam locks with auto-submitted banner (persists after reload); zero-tolerance rooms give no warning (documented policy).
- **Acceptance:** examiner sees the same events in monitoring within seconds.

### US-05 — Examiner monitors live (FR-015)
> **As an** examiner, **I want to** see per-student integrity activity while the exam runs, **so that** I can act on real signals instead of suspicion.

- **Main flow:** open room detail → monitoring panel lists students, breakdown, recent events.
- **Acceptance:** new events appear without manual refresh; flagged/auto-submitted states highlighted.

### US-06 — Examiner ends and collects (FR-005/010/016)
> **As an** examiner, **I want to** close the exam and download every answer as named files, **so that** grading can start immediately.

- **Main flow:** End (confirm) → submissions page → download all zip.
- **Failures:** late student submits after close → file still present, marked late.
- **Acceptance:** zip contains one file per submitting student, unique names, late flags visible in UI.

### US-07 — Returning examiner (FR-001/002)
> **As a** returning examiner, **I want to** sign in and land directly on my dashboard, **so that** I skip setup ceremony.

- **Acceptance:** no name prompt; "Welcome back"; `returnTo` honored.

### US-08 — Examiner renames profile (FR-001)
> **As an** examiner, **I want to** correct my display name later, **so that** greetings and records show my real name.

- **Acceptance:** one deliberate rename path; legacy email-like names self-heal where safe.

### US-09 — Student on a weak connection (FR-009)
> **As a** student on flaky internet, **I want to** keep writing while saves retry, **so that** connectivity hiccups don't interrupt me.

- **Acceptance:** failed autosaves surface nothing disruptive; editor stays editable; next successful tick catches up.

### US-10 — Examiner cleans up (FR-005)
> **As an** examiner, **I want to** delete an old closed room with everything in it, **so that** my dashboard stays current.

- **Acceptance:** explicit confirm; delete reports how many submissions/students were removed.

---

## 16. Acceptance Criteria (representative Given/When/Then)

- **AC-FR003-a** Given a signed-in examiner, When they submit a room form with a name identical (ignoring case) to an existing own room, Then the form displays "You already have a room named …" and no room is created.
- **AC-FR006-a** Given a LIVE room at its capacity, When a new browser attempts to join, Then the join fails with "\"…\" is full (N enrolled)" and the seat count is unchanged.
- **AC-FR009-a** Given a student typing mid-exam, When they reload the page within the exam window, Then the editor restores the last server-saved draft and the timer continues from the server clock basis.
- **AC-FR010-a** Given a CLOSED room, When a student attempts a final submit, Then the submission is stored, flagged `late`, and the student sees confirmation — no silent rejection.
- **AC-FR013-a** Given violation limit 3 and a 4th blur event, When the server records it, Then the student's draft is auto-submitted in the same transaction and the client receives `overLimit`.
- **AC-FR017-a** Given a request to `getExamRoomState` without a valid token, When the room exists, Then the response contains only `{ registered: false, status }` plus placeholders — never the prompt, timer basis, or counts.
- **AC-DR3-a** Given the examiner clicks Delete on a room, When the confirmation dialog is not confirmed, Then nothing is deleted.
- **AC-NFR-a11y-1** Given any page at 390 px width, When tabbing through interactive elements, Then each shows a visible focus indicator and all targets are ≥ 40 px tall.

---

## 17. Non-Functional Requirements

| ID | Area | Requirement | Target / status |
|---|---|---|---|
| NFR-001 | Performance | Exam route code-split; grammars lazily fetched per language | Verified: exam chunk 356 kB (116 kB gz) + per-grammar chunks; main entry unchanged 443 kB |
| NFR-002 | Performance | Long-paste/typing responsiveness in editor | Verified 71–110 ms for 400-line paste in Chromium; ongoing regression check in QA |
| NFR-003 | Performance | Initial load of public pages | No animation-induced LCP delay; budget **TBD — validation required** |
| NFR-004 | Security | All server functions re-validate input against `limits.ts`; reject, never sanitize | IMPLEMENTED |
| NFR-005 | Security | Rate limiting on every abusable path (OTP send, join, autosave, submit, room create, violation events) | IMPLEMENTED — 7 policies in `rateLimits.ts` |
| NFR-006 | Security | Student capability tokens: 128-bit server-minted, room-scoped, required for sensitive reads | IMPLEMENTED |
| NFR-007 | Security | Secrets only as platform env vars; never in repo, docs, or client bundle | Constraint — enforced by review |
| NFR-008 | Reliability | A failed autosave must never lose the client draft (silent retry); submits must never silently vanish (late-accept policy) | IMPLEMENTED |
| NFR-009 | Reliability | Enforcement (auto-submit) atomic with the triggering event | IMPLEMENTED (single transaction) |
| NFR-010 | Scalability | Sizing baseline: rooms per examiner ≤ 200 listed; class ≤ 500 seats; counts batched via indexed reads | IMPLEMENTED; beyond this — TBD (load test required) |
| NFR-011 | Accessibility | WCAG 2.1 AA: contrast, keyboard, focus, semantic structure; reduced-motion honored | IMPLEMENTED + QA-asserted; full audit annually |
| NFR-012 | Compatibility | Evergreen desktop + mobile browsers (Chromium, Firefox, Safari); usable at 390 px–2560 px and 67–167% zoom | IMPLEMENTED, QA-asserted; explicit browser matrix **TBD** |
| NFR-013 | Maintainability | Single-source constants (`limits.ts`, `rateLimits.ts`), strict TS, documented code comments; docs/ as canonical product docs | IMPLEMENTED + this PRD |

---

## 18. Code Editor & Execution Requirements

**18.1 Editor (IMPLEMENTED).** One document per exam; single CodeMirror 6 instance reconfigured via compartments (theme/font/language/read-only) without rebuilding history or scroll. Language support lazily loaded per exam. All interactions (undo, find, tab-indent) are editor-local.

**18.2 Execution (REQUIRED — future; not built).** If/when execution is added, product requirements (implementation approach deliberately left open, isolation first):
- EXEC-1: Runs happen in an isolated, resource-limited environment (CPU/memory/time/network caps) — **never** in the application server process.
- EXEC-2: Timeouts surface as a distinct "Time limit exceeded" state; crashes as "Runtime error" — with stdout/stderr shown to the examiner, optionally to students.
- EXEC-3: Test cases (visible + hidden) belong to the room; evaluation results are stored per submission, not derived live.
- EXEC-4: Execution must be optional per room — the product remains useful without it.
- EXEC-5: New abuse surfaces (run spam) require new rate-limit policies before launch.

**18.3 Submission format (current).** Plain text, ≤ 64 KB, one answer per student; no file type detection (documented in `submissionFiles.ts`).

---

## 19. Backend/API Requirements

All backend functions are Convex queries/mutations (WebSocket-reactive to clients), not REST. Table lists the product API.

| Feature | Function | Type | Input | Output | Auth | Error cases |
|---|---|---|---|---|---|---|
| Provision examiner | `ensureExaminer` | mutation | — | `{examinerId, isNew}` | session | unauthenticated |
| Name capture / rename | `setExaminerName`, `updateExaminerName` | mutation | name | ok | session | validation |
| Auth next step | `signInNextStep` | mutation | — | `{needsName}` | session | — |
| Create room | `createRoom` | mutation | name, prompt, duration, capacity, violationLimit? | `{roomId, code}` | examiner | validation, duplicate name, rate limit |
| List rooms / counts | `listMyRooms`, `getRoomCounts` | query | roomIds ≤ 50 | rooms / counts map | examiner (ownership filter) | — |
| Edit / end / delete room | `updateRoom`, `endRoom`, `deleteRoom` | mutation | roomId | ok (+counts) | examiner owner | not found, CLOSED edit rejected |
| Join room | `joinRoom` | mutation | code, name, regNo?, existingClientId? | `{clientId, studentUid, room}` | public | validation, wrong/closed/full, per-code + per-session limits |
| Room state | `getExamRoomState` | query | code, clientId? | full state (members) / safe subset | capability token | — |
| Save / submit | `saveSubmission` | mutation | clientId, code, isFinal | `{submissionId, late?}` / locked | token | validation, unknown token, submit rate limit |
| Own submission | `getMySubmission` | query | clientId | draft/final + autoSubmittedAt | token | — |
| Report event | `logViolationEvent`, `logRejoinEvent` | mutation | clientId, type, currentCode | warningsLeft / overLimit | token | unknown type/token, silent rate-limit drop |
| Monitoring | `getRoomMonitoring` | query | roomId | rows + breakdown | examiner owner | not found |
| Submissions | `getRoomSubmissions` | query | roomId | rows + files info | examiner owner | not found |

**Missing/unknown:** no REST layer, no export endpoint (downloads are client-side), no execution endpoints (future EXEC). Document-generation for external integrations: **UNKNOWN — needs validation** (OQ-06).

---

## 20. Data Requirements

| Entity | Purpose | Key fields | Relationships |
|---|---|---|---|
| `users` | Auth identity (Convex Auth) | name, email, isAnonymous, role (unused) | 1 → 1 `examiners` |
| `examiners` | Examiner profile | userId, name, email, createdAt, welcomed | 1 → * `rooms` |
| `rooms` | Exam instance | code (unique CV-####), name, prompt, durationMinutes, status LIVE/CLOSED, enrolledLimit, startedAt, endedAt?, violationLimit? | * → 1 examiner; 1 → * students/submissions/events |
| `students` | Session + identity in one room | clientId (secret, unique), studentUid (public, unique), regNo?, name, joinedAt, violationCount?, flagged?, autoSubmittedAt? | * → 1 room; 1 → 1 submission |
| `submissions` | The answer (one row per student, ever) | code ≤ 64 KB, isFinal, updatedAt, submittedAt?, late handled via timestamps | * → 1 room, 1 → 1 student |
| `violationEvents` | Append-only integrity log | roomId, studentId, type: blur/paste/copy/rejoin, at | * → room, student |

**Conceptual model:** Examiner owns Rooms; a Room contains Student sessions and an Event log; each Student has exactly one Submission (autosave mutates it; finalize stamps it). Events are immutable facts; tallies on the student row are derived caches maintained server-side.

**Data retention:** deletion is manual per-room (cascade). No automatic retention policy — **UNKNOWN — needs validation** (OQ-07).

---

## 21. Security Requirements

| ID | Requirement | State |
|---|---|---|
| SEC-1 | Examiner-only functions verify session + room ownership on every call ("hiding a button is not access control") | IMPLEMENTED |
| SEC-2 | Student actions resolve exclusively through their own capability token; unknown/foreign tokens rejected before quota consumption | IMPLEMENTED |
| SEC-3 | Input validation is server-side and reject-not-sanitize; bounds in one file | IMPLEMENTED |
| SEC-4 | Rate limits: OTP send (per-email + global), join (per-code + per-session), autosave, submit, room create, violation events; OTP verification attempts limited natively by the auth provider | IMPLEMENTED |
| SEC-5 | Anti-enumeration: public room-state returns a safe subset; deleted the unlimited code-preview function | IMPLEMENTED |
| SEC-6 | Clipboard privacy: monitoring stores event type/time only — never pasted/copied content | IMPLEMENTED (schema-level) |
| SEC-7 | Secrets managed as deployment env vars (email provider keys, site URL); never committed; docs contain none | Constraint — verified in this PRD |
| SEC-8 | No student PII beyond name + optional institutional ID; UIDs are random, not derived | IMPLEMENTED |
| SEC-9 | Future execution features must add isolation before any student-supplied code runs | REQUIRED (EXEC-1) |

---

## 22. Error & Edge Cases

| Scenario | Expected behavior | User feedback | Recovery |
|---|---|---|---|
| Invalid/used OTP | Verification fails; provider limiter throttles after repeated failures | "Wrong code" style inline message | Re-enter; resend (rate-limited 3 burst / 5 per 10 min) |
| Wrong room code | Join rejected pre-lookup | "No room found with code …" | Re-enter |
| Closed room join | Rejected | "… has already ended …" | Contact examiner |
| Full room | Rejected server-side | "… is full (N enrolled)" | Contact examiner |
| Stale/unknown clientId (e.g., DB reset) | Mutations return error object, not crash | "Student not found — please rejoin" | Rejoin flow |
| Autosave rate-limited | Silent failure; draft kept dirty | None (by design) | Next tick retries |
| Submit rate-limited | Loud, friendly error | "Too many submit attempts." | Retry after pause |
| 64 KB code exceeded | Mutation rejects | "Submission is too large (64KB limit)." | Trim code |
| Submit after deadline/close | Accepted, flagged late | Confirmation + (examiner-side) late marker | — |
| Violation over-limit | Auto-submit in-transaction | Locking banner; persists on reload | Examiner can view submission |
| Zero-tolerance first violation | Silent flag | None to student (policy) | Examiner decides |
| Foreign/unknown roomId on examiner query | Error/null — never foreign data | "Room not found" | Navigate back |
| Enumerated code scanning | Safe subset only | — | — |
| Network loss during exam | Editor keeps working; saves retry | Subtle saved-state indicator only | Automatic |
| Empty dashboard / no submissions | Explicit empty states with CTAs | Guiding copy | Create room / wait |
| Long names, extreme zoom | Wrap/ellipsis, no overflow | — | — |

---

## 23. Analytics & Success Metrics

**Current baseline: Unknown** (no analytics instrumentation exists — future module). Proposed measurements, to be baselined after instrumentation (OQ-08):

- **Product:** exams run/week; join→start conversion; autosave success rate; late-submit rate; flagged-student rate; download completion rate.
- **UX:** time-to-editor from landing; join error rate; submit-confidence (post-submit back-nav rate); support questions per exam (proxy: rejoin spikes).
- **Technical:** mutation p95 latency (Convex dashboards); error rate by function; rate-limit hit counts (tuning signal); QA harness pass rate in CI; bundle sizes vs NFR-001 budget.

---

## 24. Scope

**In scope (this PRD):** the examiner and student exam experience as implemented and specified above — auth, rooms, join, exam-taking, editor, autosave/submit, integrity monitoring, submissions/collection, the design system, security posture, and QA requirements.

**Out of scope (intentionally excluded now):** code execution/compilation, test-case authoring or grading, scores, leaderboards, course/roster/LMS integration, payments, student accounts, multi-file projects, real-time collaboration, native apps, i18n.

**Future consideration (§32):** evaluation/execution (with isolation-first requirements), explicit language field, notifications, analytics instrumentation, retention policy, examiner-side late-submit policy controls.

---

## 25. Dependencies

| Dependency | Type | Used by | Risk | Required action |
|---|---|---|---|---|
| Convex (functions + DB + rate-limiter component) | Platform | Everything | H: vendor-coupled data+logic | Keep schema/index discipline; export paths documented |
| Convex Auth (email OTP) | Service | Examiner auth | M: OTP email deliverability/quota | Monitor send limits; provider is env-configured |
| Email provider (OTP delivery) | External | Auth | M: outages block examiner sign-in | Documented limits; status monitoring TBD |
| Vercel | Hosting | SPA | L: standard static hosting | SPA rewrites configured |
| CodeMirror 6 + language packages | Libraries | Editor | L: stable, modular | Pin versions; lazy grammars keep bundles small |
| React 19 / Vite 7 / Tailwind 4 / framer-motion | Libraries | Frontend | L | Single React copy enforced in bundler config |
| Browser localStorage | Platform | Student identity | M: cleared storage = lost token (rejoin with same name creates new row) | UX copy on rejoin; rejoin guidance documented |
| JSZip | Library | Downloads | L: lazy-loaded | — |
| Playwright + QA harness | Tooling | QA | L | Keep scenarios in CI (OQ-09) |

---

## 26. Assumptions

1. Exams are single-prompt, single-answer, one sitting (matches implementation).
2. One student uses one browser/device per exam; identity is per-browser (token), acceptable for classroom use.
3. Examiner checks their dashboard/monitoring during the exam (no push notifications assumed).
4. Classroom-scale concurrency (≤ 500 per room, ≤ 200 rooms per examiner) is adequate.
5. A CV-#### space of 10,000 with per-code rate limiting is sufficient anti-guessing for typical use.

## 27. Constraints

1. **Browser truth:** a web app cannot technically prevent tab switching or clipboard use — the product therefore commits to *detection + server-side response*, stated openly in code and UI.
2. **Convex transaction model:** queries are read-only — rate limiting inside queries is impossible; design uses capability gating instead (implemented).
3. **No server-side file storage:** submissions are text in the DB; downloads are client-assembled.
4. **64 KB / 10,000-char / 500-seat limits** are product constants (single source: `limits.ts`).
5. **No code execution infrastructure exists**; any execution feature requires new isolation infrastructure first (EXEC-1..5).
6. Documentation-only task constraint: application code was not modified to produce this PRD.

---

## 28. Risks

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-1 | OTP email provider outage blocks examiner sign-in at exam time | M | H | Status monitoring; secondary examiner device; provider failover TBD |
| R-2 | Student clears localStorage mid-exam → new session row; examiner sees a "new" student | M | M | Clear rejoin UX; regNo matching aids identification; consider token backup (future) |
| R-3 | Zero-tolerance mode flags innocent students (touchpad app-switches) | M | M | Default limits > 0; policy copy; examiner override is manual judgment |
| R-4 | Monitoring realism gap: examiner expects prevention | M | M | Explicit in-product language ("detection, not prevention") |
| R-5 | Convex/vendor coupling raises migration cost | M | M | Keep logic centralized; standard schema; export paths (OQ-06) |
| R-6 | Large classes (500) × monitoring events stress reads | L | M | Events capped/read-limited; load test before >200-student use (NFR-10) |
| R-7 | Docs drift as product evolves | M | L | PRD-README change process; version bump rule |

---

## 29. Open Questions

| ID | Question | Why it matters | Owner | Status |
|---|---|---|---|---|
| OQ-01 | Confirm canonical repository name/URL (`Tejveercode/code-Venue-platform`?) | Document identity, CI wiring | Owner | OPEN |
| OQ-02 | Confirm actual deploy URL + email provider in production | Runbooks, deliverability | Owner | OPEN |
| OQ-03 | What exactly happens at time-up on the client (auto-final vs read-only)? | Core exam policy; affects AC set | Owner + Eng | OPEN — validate against product |
| OQ-04 | Default violation policy for new rooms (0 vs 3)? | Fairness vs signal balance | Owner | OPEN |
| OQ-05 | Adopt or remove the unused `admin/user/member` role literals? | Schema hygiene, future RBAC | Eng | OPEN |
| OQ-06 | Is an external API/export format required (LMS import)? | Integration roadmap | Owner | OPEN |
| OQ-07 | Retention: auto-delete closed rooms after N days? | Privacy/PII policy | Owner | OPEN |
| OQ-08 | Approve analytics instrumentation scope (§23) | Measurement without surveillance creep | Owner | OPEN |
| OQ-09 | Run the existing Playwright QA harness in CI on every PR? | Regression safety | Eng | OPEN |

---

## 30. Testing Requirements

**Existing (IMPLEMENTED):** `qa/visual-qa.mts` — headless Chromium against the real dashboard components: widths 390/768/1024/1280/1440/2560 + zooms 67/80/100/125/150/167%; asserts no horizontal overflow, nav geometry, touch targets ≥ 40 px, focus visibility, button-height consistency, empty/long-name/many-room scenarios, mobile menu behavior, canvas+veil rendering; interaction probes for Create/Profile/End callbacks. Editor verified separately (paste latency, scroll containment, fullscreen, theme cascade).

**Required test coverage (map to ACs):**
- T-1 Unit: validators (`validation.ts`) — every bound and message. → FR-003/006, NFR-004
- T-2 Unit: rate-limit policy behavior (burst/refill semantics). → SEC-4
- T-3 Integration: join lifecycle — capacity edge, rejoin identity, closed/full paths. → FR-006/007
- T-4 Integration: autosave + submit state machine (draft→final→locked; late flag). → FR-009/010
- T-5 Integration: violation pipeline — event→tally→warn→flag→auto-submit atomicity. → FR-012/013/014
- T-6 Security: ownership matrix (foreign roomIds/tokens rejected). → SEC-1/2, FR-017
- T-7 E2E (Playwright): examiner create→monitor→close→download happy path. → US-01/05/06
- T-8 E2E (Playwright): student join→type→reload→submit. → US-02/03
- T-9 Visual/a11y: existing harness in CI. → UX-1/2/5, NFR-011/012

---

## 31. Traceability Matrix

| Goal | User story | Requirements | Acceptance criteria (examples) | Tests |
|---|---|---|---|---|
| G1 Zero lost work | US-03, US-09 | FR-009, NFR-008 | AC-FR009-a | T-4, T-8 |
| G2 Fast no-account join | US-02 | FR-006, FR-007 | AC-FR006-a | T-3 |
| G3 Honest integrity signal | US-04, US-05 | FR-012–015 | AC-FR013-a | T-5 |
| G4 One-click collection | US-06 | FR-016, FR-005 | AC-DR3-a | T-7 |
| G5 Fast exam page | US-03 | FR-011, NFR-001/002 | (bundle + paste benchmarks) | T-8 + perf checks |
| G6 Accessibility | all | UX-1/2, NFR-011/012 | AC-NFR-a11y-1 | T-9 |
| Platform trust | — | SEC-1–8, FR-017 | AC-FR017-a | T-6 |

---

## 32. Future Considerations

1. **Evaluation module** (execution + tests + scores) under EXEC-1..5 constraints — biggest scope item; keep optional per room.
2. **Explicit exam language field** (FR-018) — small, high-clarity win.
3. **Notification layer** for flags/auto-submits (email or in-app) — respects "monitoring ≠ surveillance" tone.
4. **Analytics instrumentation** per §23 with privacy review.
5. **Retention policy** and examiner data-export (privacy compliance readiness).
6. **Late-submit policy controls** (accept / reject / percent penalty).
7. **README replacement** — the current README is a placeholder; `docs/PRD.md` + `docs/PRD-README.md` are the canonical docs until then.

---

## 33. Glossary

- **Examiner** — authenticated teacher/creator of exam rooms.
- **Room** — one exam instance: prompt, timer, capacity, code, status.
- **Room code** — public `CV-####` identifier used to join.
- **clientId** — secret 128-bit capability token stored in the student's browser; grants access to exactly one student session in one room.
- **studentUid** — public short identifier (`S-XXXXXX`) shown to students and used in filenames.
- **Autosave** — periodic server persistence of the draft (client 2.5 s debounce; server damps writes to ≥ 1/s).
- **Final submit** — `isFinal` stamp that locks the submission; late submits are accepted but flagged.
- **Violation event** — immutable log record: blur (tab/window leave), paste, copy, rejoin (page load).
- **Zero-tolerance** — violation limit 0: first enforced violation flags the student, silently.
- **Auto-submit** — server-initiated finalization when the violation limit is exceeded.
- **Capability gating** — returning sensitive data only to callers presenting a valid token.
- **Convex** — serverless backend platform (functions + reactive document database) used for the entire backend.

---

## 34. Change Log

| Version | Date | Author | Changes |
|---|---|---|---|
| 1.0 | 2026-09-17 | PRD generation (repository-analysis based) | Initial PRD: full current-state analysis, 18 FRs, 13 NFRs, 10 user stories, security/QA/traceability sections |

---

*Evidence base: `docs/prd-analysis.md`. Items marked "UNKNOWN — needs validation" are tracked in §29 Open Questions; nothing in this document should be read as implemented unless labeled IMPLEMENTED.*
