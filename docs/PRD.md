# CodeVenue — Product Requirements Document

**Version 2.0 — Clean restructure**

| Field | Value |
|---|---|
| Product | CodeVenue |
| Document | Product Requirements Document |
| Version | 2.0 |
| Status | Draft — for review |
| Date | September 17, 2026 |
| Owner | Project owner |
| Detailed evidence | `docs/prd-analysis.md` (repository analysis — source-level facts, traces, UX measurements, security/risk/test registers, and the v1→v2 ID cross-reference) |

**Status labels used in this document**

- **Implemented** — built and verified in the codebase.
- **Partial** — exists but incomplete (details noted).
- **Planned** — agreed direction, not yet built.
- **Needs validation** — cannot be confirmed from the repository; listed as an open question.

---

## 1. Document Control

| Item | Detail |
|---|---|
| Audience | Teacher/project guide, students, developers, UI/UX designers, evaluators, future contributors |
| Source of truth | This document defines *what the product should do*. `docs/prd-analysis.md` holds the source-code evidence behind every claim. |
| Version history | v1.0 (Sept 17, 2026) — full repository analysis. v2.0 (Sept 17, 2026) — readability restructure; no requirement content lost. |
| Word version | `docs/CodeVenue-PRD-V2.docx` |
| Change process | Edit this file, bump the version in §22, regenerate the Word version. See `docs/PRD-README.md`. |

---

## 2. Executive Summary

**What CodeVenue is.** CodeVenue is a web platform for running **live coding exams**. A teacher signs in, creates an exam, and shares a short code like **CV-1234**. Students join with that code — **no account, no installation** — read the question, write code in a real editor, and their work saves itself continuously while they type. When the exam ends, the teacher downloads every answer as neatly named files.

**Who uses it.** Two roles only:

- **Teacher (examiner)** — signed in with email; creates and controls exams.
- **Student** — no account; joins with the exam code and a name.

**What problem it solves.** Running a coding test today usually means a shared document or LMS text box: no timing, no autosave, no way to see who left the tab, and 30 answers arriving as messy email attachments. CodeVenue replaces that with one shareable code, automatic saving, honest visibility for the teacher, and one-click collection.

**How the basic workflow works.**

```
TEACHER                          STUDENT
─────────                        ───────
Sign in with email
Create exam  ──→  CV-1234  ──→  Join with code + name
Share code                       Read the question
Monitor live                     Write code (real editor)
        (autosave runs the whole time → work is never lost)
Close exam                       Submit
Download all submissions
```

**What is implemented today.** Everything above: teacher authentication, exam rooms, student joining, a professional code editor (syntax highlighting, line numbers, font controls, light/dark), continuous autosave, final submission, live integrity monitoring (tab-switch/paste/copy events with warnings, flags, and automatic submission), and submission downloads (single files or a zip).

**What is planned but not built.** Running and grading code automatically (execution, test cases, scores), leaderboards, and notifications. These are documented as future requirements (§17) so nobody mistakes the current product for the full vision.

---

## 3. Capability Status at a Glance

| Capability | Status |
|---|---|
| Examiner authentication (email) | Implemented |
| Exam creation / editing / closing / deletion | Implemented |
| Student joining with exam code (no account) | Implemented |
| Rejoin / refresh recovery | Implemented |
| Code editor (syntax highlighting, line numbers, themes) | Implemented |
| Autosave | Implemented |
| Final submission (incl. late submits) | Implemented |
| Live monitoring (events, warnings, flags, auto-submit) | Implemented |
| Submission collection (files + ZIP) | Implemented |
| Explicit exam-language setting | Partial — editor currently infers language from the exam text |
| Code execution (compile/run) | Planned |
| Automated grading (test cases, scores) | Planned |
| Leaderboard | Planned |
| Notifications | Planned |
| Course/roster integration | Planned |

---

## 4. Product Overview

CodeVenue has two sides that meet at one artifact: the **exam room**.

**Teacher side.** After signing in, the teacher lands on a dashboard that answers three questions at a glance: *Which exams are running? How many students have joined and submitted? Is anything suspicious happening?* Creating an exam takes one form: name, question, duration, capacity, and an optional integrity limit. The exam goes live instantly with its shareable code.

**Student side.** Students visit a simple join page, type the code and their name, and land directly in the exam: question on top, timer running (based on the server's clock, not the device), editor below. Everything typed is saved to the server within seconds. If the browser closes or the page reloads, the work is still there.

**Integrity approach — honest by design.** No website can technically *prevent* tab-switching or copy-paste. CodeVenue therefore does not pretend to. Instead it **records what actually happens** (tab switches, pastes, copies, page reloads), shows it to the teacher live in plain language, and **the server decides the consequences** (warnings counted down to the student, silent flagging in strict mode, or automatic submission when the limit is exceeded). Pastes and copies are logged as events — **the content is never transmitted or stored**.

**After the exam.** The teacher closes the exam (final — no reopen), opens the submissions page, and downloads answers as individual text files or one zip. Files are named after the student and their ID, so two students with the same name never collide.

---

## 5. Problem Statement

**The problem.** Teachers who run coding tests in class lack a lightweight tool that does four things at once: time the exam, protect student work, give honest visibility into exam behavior, and collect all the answers cleanly.

**What happens today (the pain).**

- Work is lost when a browser tab closes or a laptop dies — no autosave.
- The exam window is honor-system: no signal about who left the tab or pasted large blocks.
- Requiring every student to create an account adds friction at the worst moment (the clock is running).
- Collecting 30+ answers means chasing files through email or LMS downloads.

**Who feels it.** Teachers running in-class or remote coding assessments; students on varied personal devices and browsers.

**Impact if unsolved.** Unverifiable assessments, lost student work, and hours of manual collection after every exam.

**How CodeVenue improves the workflow.** Join by code in seconds (no accounts), continuous autosave (no lost work), live integrity signal with server-decided consequences (honest oversight), one-click file/zip collection (no manual chase).

---

## 6. Product Goals & Objectives

| # | Goal | Why it matters | Success measure |
|---|---|---|---|
| G1 | **Zero lost work** — every keystroke interval reaches the server | A lost draft is the worst possible exam outcome | Autosave success rate; draft restored after reload (see FR-009) |
| G2 | **Join in under a minute, no account** | Account creation during a timed exam is friction where it hurts most | Time-to-editor in usability testing — TBD — validation required |
| G3 | **Honest integrity signal** | Teachers need real signal, not surveillance theater | Teacher feedback on flag usefulness — TBD — validation required |
| G4 | **One-click collection** | Grading shouldn't start with 20 minutes of downloading and renaming | Download success; zero filename collisions |
| G5 | **Fast on low-end devices** | Students bring varied hardware | Editor stays responsive on large pastes (verified: 400-line paste handled in ~0.1 s) |
| G6 | **Accessible and readable everywhere** | Exams must work for everyone, on anything | WCAG AA contrast; keyboard operable; no overflow at 390–2560 px width and 67–167% zoom |

---

## 7. Target Users

**Teacher.** Runs coding quizzes and exams for a class (typically 10–60 students). Wants setup in under a minute, one code to share, a live picture of participation, and clean collection afterward. Uses: dashboard, exam detail page, submissions page.

**Student.** Joins from a personal laptop or phone. Wants to start instantly, see the question and timer clearly, type comfortably, and never lose work. Uses: join page, exam page.

**Evaluator / guide / future contributor.** Reads this document plus `docs/prd-analysis.md` to understand the product without reading source code.

*(Personas in v1.0 were illustrative examples; no user research exists yet — names are avoided here by design. Usability research is a planned activity, not a completed one.)*

---

## 8. Roles & Permissions

| Role | How identified | Can do | Cannot do |
|---|---|---|---|
| **Teacher (examiner)** | Email sign-in session | Create/edit/close/delete **their own** exams; monitor them live; download their submissions; change their display name | Touch anyone else's exams or data (server rejects it) |
| **Student** | Secret session token minted when they join (stored in their browser) | Write and save their own code; submit; see their own warnings | See other students' data; act on another session; read exam details without a valid token |
| **Visitor** | Nothing | See public pages; join a room if they have a valid code and the room has space | Enumerate exam content — invalid/absent tokens get only a "room live/closed" status |

**The rule behind the product:** every server function re-checks ownership before doing anything. Hiding a button in the interface is never the security mechanism.

---

## 9. Product Workflow

### 9.1 The core flow (implemented)

```
TEACHER                                STUDENT
───────                                ───────
1. Sign in (email code)
2. Create exam                          4. Enter code + name
   (name, question, duration,           5. Land in exam: question + timer + editor
   capacity, integrity limit)           6. Write code — autosave runs continuously
3. Share code (CV-####)
7. Watch dashboard:                     (if the page reloads → same draft returns)
   joined / submitted / flagged counts
8. Open exam detail: live monitoring
   per student
9. Close exam (final)                   10. Submit (before or after deadline —
                                            late submits are accepted but marked)
11. Download submissions (files or zip)
```

### 9.2 What happens during the exam (integrity model)

- A student switches tabs / pastes / copies → the browser reports **one event** to the server.
- The server logs it and decides: with a limit set, the student sees **"2 of 3 warnings used"**; exceeding the limit **auto-submits their draft** in the same instant; with zero tolerance (limit 0), the first event **silently flags** the student for the teacher.
- Reloads are logged for the teacher's audit trail but never counted as violations.
- **Clipboard content is never sent anywhere.**

### 9.3 The future flow (planned, not built)

After submission, a **Evaluation** stage would follow: run the code against visible and hidden test cases in an isolated environment, compute scores, and show results — plus leaderboards and notifications. Nothing in the current product executes student code. Requirements EXEC-1…5 and FR-018+ in §17 define the guardrails for that future.

---

## 10. Product Modules

**Examiner**

- *Authentication* — Sign in with email code · first-time name capture · rename later · protected portal
- *Exam Management* — Create exam · edit while live · close (final) · delete (removes all its data) · share code (copyable)
- *Monitoring* — Live joined/submitted counts · per-student integrity events · warning countdowns · flags · auto-submit status
- *Submission Management* — View all submissions with status · download one file · download all as ZIP

**Student**

- *Exam Access* — Join with code + name (+ optional student ID) · rejoin after refresh automatically
- *Coding* — Real code editor · syntax highlighting for 5 languages · line numbers · bracket matching · find · font-size control · editor light/dark toggle · fullscreen · timer (server clock) · autosave · submit

**Shared**

- *Public site* — Landing and About pages that explain the product
- *Design system* — Warm cream/caramel theme, accessible contrast, responsive layouts

---

## 11. Dashboard & UX Requirements

### 11.1 What the dashboard must do

The dashboard is the teacher's control room. Its job is to **answer "how are my exams?" in five seconds** and route the teacher to the right detail — not to contain every feature. Detail work (per-student monitoring, per-file downloads) lives on the exam-detail and submissions pages, one click away.

### 11.2 Information hierarchy (in priority order)

| Tier | Content | Why it sits here |
|---|---|---|
| 1. Greeting + primary action | Welcome / Welcome back; **Create New Exam** button | The main action is always visible |
| 2. Live summary (KPIs) | Running exams, joined, submitted, flagged, auto-submitted | The "how is everything" answer, updated live |
| 3. Exam cards — live first | Each exam: name, code pill (copyable), joined/capacity, submitted count, flagged rail, actions | Live exams need attention; closed ones are reference |
| 4. Secondary info | Closed exams below live ones; edit hidden for closed exams | History stays available but visually quiet |
| 5. Detail routing | "Manage" → monitoring detail; "Submissions" → collection page | Dashboard summarizes; details live elsewhere |

**Explicit separations**

- **Primary actions:** Create New Exam; per-exam Open/Submissions.
- **Secondary information:** KPIs, counts, status pills.
- **Detailed exam management:** monitoring panel, end/delete confirmations — on the exam detail page, never crammed onto the dashboard.
- No mega-dropdown: related actions stay grouped on cards; destructive actions (End, Delete) use confirmation dialogs and the destructive color.

### 11.3 Dashboard rules

| ID | Rule |
|---|---|
| DR-1 | Dashboard shows **counts only**; per-student detail belongs on the exam detail page |
| DR-2 | Flagged and auto-submitted totals visible **at dashboard level** — teacher shouldn't need to open each exam to spot trouble |
| DR-3 | Every destructive action requires explicit confirmation, visually distinct from attention states |
| DR-4 | Empty, loading, and error states exist for every data region — never a blank shell |
| DR-5 | The exam code is copyable in one interaction; touch target ≥ 40 px on phones *(gap: pill is small today — tracked in FR-019)* |
| DR-6 | Closed exams sort below live exams and lose edit affordances (the server enforces this too) |

### 11.4 UI/UX requirements (design system)

**The look.** Warm cream background, white cards, a single caramel accent family used in three depths (light chrome → deep buttons → rich attention/live states). Red is reserved for destructive actions only. All text and controls meet WCAG AA contrast on both page and card backgrounds (audited; ratios recorded in `prd-analysis.md`).

| ID | Requirement |
|---|---|
| UX-1 | Every interactive element shows a visible focus indicator and works by keyboard, in a logical order |
| UX-2 | Touch targets ≥ 40 px on small screens |
| UX-3 | Form errors show the same friendly message the server produced — never technical dumps |
| UX-4 | Every data region has a loading state (never a blank page) |
| UX-5 | No horizontal overflow at any supported width (390–2560 px) or zoom (67–167%); long names wrap, never clip |
| UX-6 | Editor preferences (font size, editor theme) persist and affect the **editor only** — the page theme never changes |
| UX-7 | Entrance/scroll animations are subtle (opacity/transform only), play once, never delay clicking, and are disabled for users with reduced-motion enabled |
| UX-8 | Status pills (Live, flagged, Closed) are distinguishable by shade/weight, not by introducing new hues |
| UX-9 | Decorative background animation must never reduce text readability (a readability veil sits over it; verified in QA) |
| UX-10 | Buttons and controls must never be low-contrast or "gloomy" — the deep/rich caramel ladder keeps hierarchy without darkening below AA |

---

## 12. Functional Requirements

Format: each requirement states *what the system shall do*, *why it matters*, and testable *acceptance criteria*. Status: **Implemented** unless marked otherwise.

### Examiner — Authentication & Profile

**FR-001 — Examiner Authentication** · Implemented
The system shall allow an examiner to sign in using an email verification code, and shall capture their display name once at first sign-in.
*Why:* only authenticated teachers may manage exams; a real name makes greetings and records readable.
- Given an unauthenticated user, When they complete email verification, Then they reach the examiner portal.
- Given a first-time examiner, When verification completes, Then a name prompt appears exactly once.
- Given a returning examiner, When they sign in, Then no name prompt appears.

**FR-002 — Protected Examiner Routes** · Implemented
The system shall require authentication for all examiner pages and return the teacher to their intended page after sign-in.
*Why:* deep links must not leak or dead-end.
- Given a signed-out visitor, When they open an examiner URL, Then they land on the sign-in page and, after signing in, are returned to the original destination.

**FR-003 — Create Exam** · Implemented
The system shall let an examiner create an exam with a name (≤120 chars), question (≤10,000 chars), duration (1–1440 min), capacity (1–500), and optional integrity limit (0–999), and shall issue a unique exam code (CV-####).
*Why:* this is the product's core setup action.
- Given valid fields, When the teacher saves, Then a live exam appears with a new CV-#### code.
- Given a name duplicating (ignoring case) another of the teacher's exams, When saving, Then a clear inline error appears and nothing is created.
- Given invalid input (too long, out of range), When submitted, Then the server rejects it with a friendly message — the server re-validates everything.

**FR-004 — Edit Live Exam** · Implemented
The system shall allow editing an exam while it is live, and shall refuse edits to closed exams.
- Given a live exam, When the teacher saves changes, Then updates appear for them (and connected students' timers adjust by the new duration basis).
- Given a closed exam, When an edit is attempted, Then it is rejected (client and server).

**FR-005 — Close and Delete Exam** · Implemented
The system shall let an examiner close an exam (final, no reopen) and delete it with all its data after explicit confirmation.
- Given a closed exam, When a student tries to join, Then the join is refused with a clear message.
- Given delete confirmation, When confirmed, Then the exam, its submissions, student sessions, and events are all removed, and the teacher sees what was deleted.

### Examiner — Monitoring

**FR-006 — Live Participation Counts** · Implemented
The system shall show the teacher live counts of joined, submitted, flagged, and auto-submitted students per exam, updated without refresh.
- Given students joining/submitting, When it happens, Then the dashboard numbers change within seconds.

**FR-007 — Live Monitoring View** · Implemented
The system shall provide a per-student monitoring view showing each integrity event (what happened and when), per-type totals, and reload timestamps.
*Why:* the teacher needs plain-language facts, not just numbers.
- Given a monitored exam, When events occur, Then the list updates reactively; foreign exam IDs return errors, never another teacher's data.

**FR-008 — Warning Countdown** · Implemented
With a limit above zero, the system shall show the student how many integrity warnings remain, and shall auto-submit their current draft server-side when the limit is exceeded.
- Given limit 3 and a 4th violation, When the server records it, Then the draft is submitted automatically in the same transaction and the student sees an explanation that survives page reloads.

**FR-009 — Zero-Tolerance Flagging** · Implemented
With limit 0, the system shall silently flag the student on the first violation — no student-visible warning.
*Why:* strict mode is a teacher choice; silence prevents gaming the warning system.
- Given limit 0 and any violation, When recorded, Then the teacher sees the flag immediately and the student sees nothing.

*(Monitoring event capture — tab switches, pastes, copies, reloads with no clipboard content — is specified by FR-013 in the Student section.)*

### Examiner — Submissions

**FR-010 — View Submissions** · Implemented
The system shall list every submission for the teacher's exam with status (draft vs final, late marking).
- Given an exam with submissions, When the teacher opens the submissions page, Then each student's file and status is visible.

**FR-011 — Download Submissions** · Implemented
The system shall let the teacher download any single submission, or all as a ZIP, with collision-safe file names (`Name_ID.txt`; duplicates get suffixes).
- Given two students named identically, When the zip is built, Then both files exist with distinct names.

### Student — Exam Access

**FR-012 — Join by Code** · Implemented
The system shall let anyone join an exam with a valid code and display name (≤60 chars; optional student ID, 3–24 chars) — no account.
- Given a valid live exam with free seats, When a student joins, Then they enter the exam and see the question.
- Given a wrong code, a closed exam, or a full exam, When joining, Then a specific friendly message explains which (never a generic failure).

**FR-013 — Rejoin & Session Recovery** · Implemented
The system shall identify a returning browser by its secret session token so that refreshes and accidental closes return the student to the same session and the same draft.
- Given a student mid-exam, When they reload, Then the same draft and session resume; rejoining never consumes a second seat.

**FR-014 — Capacity Enforcement** · Implemented
The system shall enforce the exam's capacity on the server; rejoining students never consume extra seats.
- Given an exam at capacity, When a new browser tries to join, Then it is refused with the count shown.

### Student — Taking the Exam

**FR-015 — Exam Presentation & Timer** · Implemented
The system shall present the question and a countdown computed from the **server's** clock, with a visual low-time state under five minutes.
*Why:* device clocks lie; server time doesn't.
- Given the exam duration, When time passes, Then the timer reflects server time; under 5:00 the low-time style appears.

**FR-016 — Autosave** · Implemented
The system shall continuously save the student's draft (a couple of seconds after typing pauses; at most one write per second), and shall restore it after any reload, without ever showing disruptive errors when a save is rate-limited.
- Given a student typing, When they reload mid-exam, Then the editor shows the last saved draft.
- Given rapid saving, When limits are hit, Then saving resumes silently on the next attempt — the student is never blocked from typing.

**FR-017 — Final Submit & Late Acceptance** · Implemented
The system shall let the student finalize their exam, locking further edits; submissions after the deadline or closure shall be **accepted but marked late** — never silently rejected.
*Why:* clock drift or a dropped connection should never cost a student their work.
- Given a submitted exam, When the student tries to edit, Then the editor is locked.
- Given a submit after time, When accepted, Then the teacher sees the late marker.

**FR-018 — Code Editor** · Implemented
The system shall provide a real code editor: syntax highlighting (Python, C++, Java, JavaScript/TypeScript, SQL — loaded only when needed), line numbers, active-line highlight, bracket matching, search, auto-closing brackets, tab indent, font-size control, editor-only light/dark themes, and fullscreen.
- Given any exam, When the editor opens, Then the toolbar shows the active language mode; preferences persist between sessions.

**FR-019 — Integrity Event Capture** · Implemented
The system shall record tab switches, pastes, copies, and page reloads as individual server events — and shall **never** transmit or store pasted/copied content.
*Why:* honest signal without surveillance overreach.
- Given a paste during the exam, When it happens, Then only "paste at HH:MM" is recorded; content is not.

**FR-020 — Explicit Exam Language (planned)** · Planned
The system shall let the examiner choose the exam's language explicitly; the editor shall use it instead of inferring from the exam text.
*Why:* inference can mismatch; a badge already shows the active mode today (partial support).
- Given an exam with a chosen language, When the editor opens, Then highlighting matches that language.

**FR-021 — Code Execution & Grading (planned)** · Planned
The system shall optionally run submitted code against visible and hidden test cases in an isolated environment and report results — only when the examiner enables it for the exam.
*Why:* grading automation is the product's future, gated by safety (see EXEC rules in §17).
- Given execution enabled and a submission, When run, Then results (pass/fail per test, output, errors) are stored and viewable by the teacher.

### Shared

**FR-022 — Anti-Enumeration Protection** · Implemented
The system shall return full exam details only to callers with a valid student session token for **that** exam; everyone else receives only live/closed status.
- Given code guessing attempts, When an invalid token is used, Then no question text, timing, or counts are revealed.

---

## 13. User Stories

**Teacher**

- **US-01** — As a teacher, I want to create an exam quickly so that I can start an assessment without unnecessary setup. *(FR-001–003)*
- **US-02** — As a teacher, I want to see live participation and integrity counts so that I know how the room is doing without walking around. *(FR-006, FR-007)*
- **US-03** — As a teacher, I want per-student event details in plain language so that I can act on facts instead of suspicion. *(FR-007–009)*
- **US-04** — As a teacher, I want to close the exam and download every answer as named files so that grading can start immediately. *(FR-005, FR-010, FR-011)*
- **US-05** — As a teacher, I want to correct my display name and reuse my account every term so that my portal feels like mine. *(FR-001, FR-002)*
- **US-06** — As a teacher, I want to delete old exams with everything in them so that my dashboard stays current. *(FR-005)*

**Student**

- **US-07** — As a student, I want to join with just a code and my name so that I can start immediately without creating an account. *(FR-012)*
- **US-08** — As a student, I want my code continuously saved so that a crash or reload never costs me my exam. *(FR-013, FR-016)*
- **US-09** — As a student, I want a real editor with highlighting and a visible timer so that I can focus on the problem, not the tooling. *(FR-015, FR-018)*
- **US-10** — As a student, I want to know how many warnings remain so that an accidental tab switch doesn't silently end my exam. *(FR-008)*
- **US-11** — As a student on weak internet, I want saves to retry quietly so that connectivity hiccups never interrupt my typing. *(FR-016)*
- **US-12** — As a student, I want my late submission accepted and marked rather than rejected so that clock drift doesn't erase my work. *(FR-017)*

*(Acceptance criteria for every story are the FR criteria referenced above; §19 collects the key Given/When/Then checks.)*

---

## 14. Non-Functional Requirements

**Performance**

| ID | Requirement | Target |
|---|---|---|
| NFR-01 | The exam page loads as its own optimized bundle; editor language packs fetch only when needed | Verified: main app unchanged; exam bundle ~356 kB (≈116 kB gz) + small per-language chunks |
| NFR-02 | Typing and large pastes stay smooth | Verified: 400-line paste ≈ 0.1 s; regression-check in QA |
| NFR-03 | Public pages render without animation delaying content | Budget TBD — validation required |

**Reliability**

| ID | Requirement | Target |
|---|---|---|
| NFR-04 | A failed autosave never loses the client draft; submits are never silently dropped | Implemented — silent retry; late-accept policy |
| NFR-05 | Enforcement actions are atomic with their trigger | Implemented — auto-submit happens in the same server transaction as the over-limit event |

**Security**

| ID | Requirement | Target |
|---|---|---|
| NFR-06 | Every server function re-validates input and re-checks ownership | Implemented (reject-not-sanitize; bounds in one shared file) |
| NFR-07 | Rate limits protect every abusable path (sign-in codes, joins, saves, submits, exam creation, events) | Implemented — 7 policies |
| NFR-08 | Student sessions use secret 128-bit server-minted tokens scoped to one exam | Implemented |
| NFR-09 | Secrets live only in platform environment variables — never in code, docs, or client bundles | Constraint — enforced by review |

**Accessibility**

| ID | Requirement | Target |
|---|---|---|
| NFR-10 | WCAG 2.1 AA: contrast, keyboard operation, visible focus, semantic structure; reduced-motion honored | Implemented + asserted by the automated QA harness |

**Responsiveness**

| ID | Requirement | Target |
|---|---|---|
| NFR-11 | Usable at 390–2560 px width and 67–167% zoom on evergreen desktop and mobile browsers | Implemented + asserted; explicit browser matrix TBD — validation required |

**Maintainability & Scalability**

| ID | Requirement | Target |
|---|---|---|
| NFR-12 | All input bounds and rate limits live in single-source files; strict typing; documented code | Implemented |
| NFR-13 | Sizing baseline: ≤ 500 students per exam, ≤ 200 exams listed per teacher, batched indexed reads | Implemented; beyond this TBD — load test required |

---

## 15. Technical Overview

Concise summary — detailed, source-level evidence lives in `docs/prd-analysis.md`.

- **Frontend:** React + TypeScript + Vite (single-page app, lazy-loaded routes)
- **Backend:** Convex serverless functions (queries + mutations, reactive updates)
- **Database:** Convex document database (6 domain tables with explicit indexes)
- **Editor:** CodeMirror 6 with 5 language grammars
- **Hosting:** Vercel (frontend) + Convex cloud (backend)
- **Authentication:** Examiner email-code authentication; students identified by secret session tokens (no accounts)
- **Design system:** Custom warm cream/caramel theme; Tailwind CSS; framer-motion (reduced-motion aware)
- **QA tooling:** Playwright-based layout/interaction harness covering widths 390–2560 px and zooms 67–167%

**Architecture in one paragraph.** The browser app talks to Convex functions. Everything a student does is a mutation authorized by their session token; everything a teacher sees is a reactive query scoped to their own exams. All input limits and rate limits are defined once in shared server files, so client checks can never drift from server rules. Student integrity events are append-only log entries; the tallies shown to teachers are derived on the server. No student code is ever executed anywhere.

---

## 16. Security & Reliability

**Security posture (all implemented):**

1. **Ownership everywhere** — every teacher function verifies the exam belongs to them; every student function resolves through their own token.
2. **Reject, don't sanitize** — invalid input is refused with a friendly message; nothing is silently trimmed into acceptance.
3. **Rate limiting** — strictest on sign-in code sending (per-email + global), moderate on joins (per-exam-code + per-browser), generous-but-capped on autosave; event spam silently capped so monitoring never disrupts an exam.
4. **Capability gating** — exam content (question, timer, counts) unlocks only with a valid session token for that exam; code-scanning attempts learn nothing but liveness.
5. **Clipboard privacy** — monitoring stores event type and time only.
6. **Minimal PII** — a name, an optional institutional ID, and a random public identifier; nothing else.

**Reliability posture (all implemented):**

- Autosave failures are silent and self-healing; the draft stays in the editor and retries.
- Auto-submit is transactional — it can never be lost or duplicated.
- Late submits are accepted and flagged, never dropped.
- Deletion is explicit and cascading, with a summary of what was removed.

---

## 17. Scope & Future Work

**In scope (this PRD).** Everything labeled Implemented in §3: teacher auth, exam lifecycle, student joining, exam-taking, editor, autosave/submit, integrity monitoring, submission collection, design system, security posture, QA requirements.

**Out of scope (intentionally excluded now).** Course/roster/LMS management, payments, student accounts, multi-file projects, real-time collaboration, native apps, translations.

**Future work (planned, in priority order):**

1. **FR-020 — explicit exam language** (small, high clarity).
2. **FR-021 — optional code execution & grading**, under these non-negotiable rules:
   - EXEC-1: runs happen in an isolated, resource-limited environment — never inside the application server.
   - EXEC-2: timeouts and crashes are distinct, readable results.
   - EXEC-3: test cases (visible + hidden) belong to the exam; results are stored per submission.
   - EXEC-4: execution stays optional per exam — the product works without it.
   - EXEC-5: new abuse surfaces (run spam) get new rate limits before launch.
3. Leaderboards and score analytics.
4. Notifications (flag alerts) — respecting the "signal, not surveillance" tone.
5. Usage analytics instrumentation (per §18) with a privacy review.
6. Data retention policy and teacher data export.

---

## 18. Analytics & Success Metrics

**Current baseline: Unknown** — no analytics instrumentation exists yet (that is future work). When added, measure:

- **Product:** exams run per week; join→start conversion; autosave success rate; late-submit rate; flag rate; download completion rate.
- **UX:** time from landing to editor; join error rate; post-submit confidence (back-navigation rate); rejoin spikes as a proxy for confusion.
- **Technical:** server function latency and error rates; rate-limit hit counts (tuning signal); QA harness pass rate; bundle sizes vs NFR-01.

---

## 19. Acceptance Criteria (key checks)

The full criteria live inside each FR (§12). The checks most likely to be tested first:

1. Given a duplicate exam name (ignoring case), When saving, Then an inline error appears and no exam is created. *(FR-003)*
2. Given an exam at capacity, When a new browser joins, Then refusal message shows the count and no seat is consumed. *(FR-012, FR-014)*
3. Given a student typing mid-exam, When they reload, Then the same draft and timer resume. *(FR-013, FR-015, FR-016)*
4. Given a submit after the deadline, When accepted, Then the submission is stored and marked late. *(FR-017)*
5. Given limit 3 and a 4th violation, When recorded, Then auto-submit happens in that instant and the student's explanation survives reload. *(FR-008)*
6. Given limit 0 and any violation, When recorded, Then the student sees nothing and the teacher sees a flag. *(FR-009)*
7. Given code-scanning without a valid token, When exam state is queried, Then only live/closed status is returned. *(FR-022)*
8. Given any page at 390 px, When tabbing through controls, Then focus is visible and targets are ≥ 40 px. *(NFR-10, NFR-11, UX-1/2)*

---

## 20. Requirements Traceability

| Goal (§6) | User story (§13) | Requirements (§12) | Key acceptance checks (§19) |
|---|---|---|---|
| G1 Zero lost work | US-08, US-11 | FR-013, FR-016, NFR-04 | #3 |
| G2 Fast no-account join | US-07 | FR-012, FR-014 | #2 |
| G3 Honest integrity signal | US-02, US-03, US-10 | FR-006–009, FR-019, FR-022 | #5, #6, #7 |
| G4 One-click collection | US-04 | FR-005, FR-010, FR-011 | #4 (late handling) |
| G5 Fast on low-end devices | US-09 | FR-018, NFR-01/02 | perf checks |
| G6 Accessible everywhere | all | NFR-10/11, UX-1…10, DR-1…6 | #8 |
| Future value | — | FR-020, FR-021 (+EXEC-1…5) | — |

---

## 21. Glossary

- **Exam (room)** — one exam instance: question, duration, capacity, code, status.
- **Exam code** — public identifier like CV-1234 used to join.
- **Session token** — secret 128-bit identifier minted when a student joins; stored in their browser; grants access to exactly their own session in one exam.
- **Student UID** — public short identifier (e.g. S-7F3K2Q) shown to the student and used in file names.
- **Autosave** — continuous saving of the draft a couple of seconds after typing pauses (at most one write per second).
- **Final submit** — locks the submission; late submits are accepted but marked.
- **Integrity event** — an immutable log record: tab switch, paste, copy, or page reload. Content is never recorded.
- **Zero tolerance** — integrity limit 0: the first violation silently flags the student.
- **Auto-submit** — server-initiated submission when the integrity limit is exceeded.
- **Capability gating** — showing sensitive data only to callers presenting a valid session token.
- **Convex** — the serverless backend platform (functions + reactive database) used for the entire backend.

---

## 22. Change Log

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-09-17 | Initial PRD from full repository analysis (34 sections; evidence labels; FR-001…018, NFR-001…013, US-01…10). |
| 2.0 | 2026-09-17 | Readability restructure: 22 sections in the WHY → WHO → PROBLEM → PRODUCT → WORKFLOW → REQUIREMENTS → VALIDATION order. All requirement IDs remapped consistently; full cross-reference table in `prd-analysis.md`. FR-019–022 are renumbered v1 requirements (no new scope); NFR/SEC/OQ/R/T registers relocated to `prd-analysis.md` with their content intact. No requirement content lost; no repository re-analysis performed. |

---

*Evidence base: `docs/prd-analysis.md`. Anything not labeled Implemented is planned or needs validation; open items are owned in that document's Open Questions list.*
