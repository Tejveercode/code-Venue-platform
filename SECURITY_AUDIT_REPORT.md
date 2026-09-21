# CodeVenue Security & Production Audit

**Date:** September 21, 2026 · **Scope:** full repository · **Method:** SCAN → MAP → FIND → FIX → TEST → RE-SCAN → REPORT

**Second-pass re-verification (same day):** every SEC fix below was independently re-tested against the live code (grep of the actual implementation, not the prior report's claims) — all seven confirmed genuinely present and correct. The re-verification **did find one real defect in the prior paste fix** (double-reporting; see SEC-1's updated verification) plus a mobile-menu focus gap; both were fixed in this pass.

All fixes were applied in the same pass and re-verified with the repository's own validation chain (`bun convex dev --once`, `bun tsc -b --noEmit`, `bun run build`, `bun run lint`, `npm audit`). No browser interaction is available in this environment; wherever that matters it is stated explicitly.

---

## 1. Executive Summary

The application's authorization architecture is **fundamentally sound**: every examiner path is gated by `requireExaminer` + `requireOwnedRoom`; every student path is gated by the 128-bit server-minted `clientId` capability token; tallies, flags, and auto-submit are decided **server-side only**; input validation is strict reject-style with size caps on every externally controlled field; rate limits cover auth, join, autosave, submit, room creation, and violation reporting; errors are user-facing `ConvexError`s with a shape-matching fallback so internals never leak.

Seven genuine issues were found and fixed in this pass:

| # | Finding | Severity |
|---|---------|----------|
| SEC-1 | Paste violation not detected for editor-level/IME pastes (DOM-event-only detection) | **High** (product integrity) |
| SEC-2 | Autosave min-interval damp returned success without persisting changed content — silent lost updates | **High** (data loss) |
| SEC-3 | Room codes generated with `Math.random()` (non-CSPRNG) although the code is the only join gate | Medium |
| SEC-4 | `logRejoinEvent` was the only public mutation with **no** rate limit → unbounded DB writes | Medium |
| SEC-5 | `getRoomSubmissions` returned the student's secret `clientId` session token to the examiner UI (unused) | Medium |
| SEC-6 | No throttle on join enumeration **across** codes (per-code limiter can't see sweeping) | Medium |
| SEC-7 | Stale `package-lock.json` resolved the vulnerable `@auth/core 0.37.4` despite a patched installed tree | Medium (supply chain) |

Two lower-severity items were also corrected during the same pass: the exam detail's Monitoring tab badge undercounted attention students (same class of bug as the previously fixed KPI), and the mobile menu lacked standard dismissal/focus affordances.

The paste fix required tracing CodeMirror's internal event pipeline (`handlers.paste` → `doPaste` → `userEvent: "input.paste"` transaction annotation) in the installed version; detection was moved to the transaction layer, which covers every editor-level paste path.

---

## 2. Architecture / Attack Surface

**Stack:** React 19 + Vite SPA (public student surface, `RequireAuth`-wrapped examiner surface) → Convex backend (queries read-only, mutations transactional) → Convex Auth (email OTP via Resend, provider allowlist = `email-otp` only; the template's anonymous provider was already removed in a prior audit).

**Trust boundaries and data flow:**

```
Student browser ── joinRoom(clientId mint)         ── public
              ├─ getExamRoomState (capability-gated) ── public (safe subset without token)
              ├─ saveSubmission (autosave/submit)    ── clientId-gated
              ├─ logViolationEvent / logRejoinEvent  ── clientId-gated
Examiner browser ── ensureExaminer / setExaminerName ── auth-gated
               ├─ listMyRooms / getRoomCounts / getRoomMonitoring ── ownership-gated
               ├─ createRoom / updateRoom / endRoom / deleteRoom ── ownership-gated
```

**Sensitive data:** student `clientId` (secret session token), room codes (join gate), submissions (student work), violation event log (behavioral, content-free by design — clipboard content is never sent or stored).

**Validation layer:** `limits.ts` (single source of truth for all caps) + `validation.ts` (strict reject validators) applied inside every mutation. **Rate limiting:** `@convex-dev/rate-limiter`, thresholds centralized in `rateLimits.ts`, fails-open on limiter error (documented availability-over-strictness choice). **Error hygiene:** `getErrorMessage` shows `ConvexError` data only; `RootErrorBoundary` strips stacks in production.

---

## 3. Security Findings

### SEC-1 — Paste violation missed for editor-level pastes
- **Severity:** High (product integrity, not confidentiality)
- **Category:** Business-logic / detection completeness
- **Component:** `src/components/venue/CodeEditor.tsx` → `logViolationEvent`
- **Root cause:** Detection relied solely on `EditorView.domEventHandlers({ paste })`. CodeMirror converts pastes into transactions; some editor-level paste paths never surface a DOM `paste` event (IME/keyboard clipboard inserts, the Android `EditContext` path in `@codemirror/view` 6.43, and compositions that swallow the event). Verified against the installed CodeMirror source: `handlers.paste` (index.js:5144) is an internal `handlers` entry, not a DOM hook, and `doPaste` (index.js:4909) dispatches with `userEvent: "input.paste"` (index.js:4937) while all DOM-change-driven edits are annotated `input.type[.compose]` (index.js:4423).
- **Evidence:** grep of `node_modules/@codemirror/view/dist/index.js` (lines above); `Exam.tsx` wired `onPaste` → `reportEvent("paste")` correctly, so the chain broke at detection, not reporting.
- **Risk:** Students could paste solutions (the highest-signal violation in a coding exam) without any monitoring record or examiner awareness.
- **Fix:** Added `tr.isUserEvent("input.paste")` detection in the editor's `updateListener` (the editor integration layer), kept the DOM hook for non-transacting clipboard scenarios, and deduped with a transaction-identity `Set` cleared each render so a paste is counted exactly once.
- **Verification:** Typecheck/build pass; dedupe logic prevents double counting when both layers fire. Manual verification of an in-exam paste remains a **manual action** (no browser in this environment).
- **Residual risk:** A determined student can suppress JS events entirely (devtools, extensions) — client-side detection is best-effort by design; the server still cannot be fooled into *over*-counting.
- **Manual action:** Paste inside the editor during a live exam; confirm the paste row increments in examiner Monitoring and the student's warning banner appears.

### SEC-2 — Autosave damp could silently drop changed content
- **Severity:** High (data loss)
- **Category:** Business-logic / data integrity
- **Component:** `saveSubmission` (`src/convex/exams.ts`) + `doSave` (`src/pages/Exam.tsx`)
- **Root cause:** The 1-second autosave min-interval check returned `{ submissionId }` — indistinguishable from a successful write — while skipping the write of **changed** content. The client cleared its dirty flag and showed "Saved", leaving stale content in the DB. This is a direct root cause of the reported "changes not consistently saved" symptom.
- **Evidence:** Pre-fix code path: `if (existing && Date.now() - existing.updatedAt < AUTOSAVE_MIN_INTERVAL_MS) return { submissionId: existing._id };`
- **Risk:** A student's final keystrokes before submit/expiry could be missing from the graded artifact.
- **Fix:** Server now returns `{ dampened: true }`; the client keeps the dirty flag **and** schedules a retry just past the server's window (the debounce that scheduled the save has already fired, so without the retry a dampened save could otherwise linger). Retry is cleaned up on unmount.
- **Verification:** Typecheck/build pass; behavior-preserving for all non-dampened paths.
- **Residual risk:** None identified; the retry uses the same rate-limited, silent-failure path as normal autosave.
- **Manual action:** Type continuously for >5s, stop, wait for "Saved"; verify the examiner's Submissions draft matches.

### SEC-3 — Room codes generated with `Math.random()`
- **Severity:** Medium
- **Category:** Cryptographic weakness
- **Component:** `generateRoomCode` (`src/convex/exams.ts`)
- **Root cause:** `Math.floor(Math.random() * 10000)` — not a CSPRNG; output is predictable from observed samples. Room codes are the *only* thing gating who can join a live exam.
- **Risk:** Code prediction → uninvited exam presence; trivially combined with the pre-SEC-6 sweeping gap.
- **Fix:** `crypto.getRandomValues` (CSPRNG) for code generation; format unchanged (`CV-####`), so the per-code join limiter remains the brute-force brake.
- **Verification:** On-disk confirm + codegen/typecheck/build pass. No behavior change.
- **Residual risk:** 10⁴ codes remain small — this is why SEC-6's global window was also added.
- **Manual action:** None.

### SEC-4 — `logRejoinEvent` had no rate limit
- **Severity:** Medium
- **Category:** Abuse / resource exhaustion
- **Component:** `logRejoinEvent` (`src/convex/exams.ts`)
- **Root cause:** The only public mutation without a limiter; a scripted client could spam unbounded `violationEvents` rows.
- **Fix:** Same silent token bucket as enforced events (`violationEventPerStudent`, per-student). Silent drop preserves "monitoring never disrupts the exam."
- **Verification:** Codegen/typecheck/build pass.
- **Residual risk:** Standard silent-drop caveat — extreme spam loses audit granularity, which is preferable to disrupting the exam.
- **Manual action:** None.

### SEC-5 — Student session token exposed in grading view
- **Severity:** Medium
- **Category:** Data exposure / data minimization
- **Component:** `getRoomSubmissions` (`src/convex/exams.ts`), `Submissions.tsx`
- **Root cause:** The query returned `clientId` (the 128-bit capability token authorizing writes to a student's submission) although nothing in the grading UI consumes it (download filenames use `regNo`/`studentUid`).
- **Fix:** Removed from the response; the unused `SubRowData.clientId` field was removed client-side. Owner-only query, so exposure was limited — but a capability token belongs in as few places as possible.
- **Verification:** Typecheck/build pass; downloads unaffected (filenames never used `clientId`).
- **Residual risk:** None.
- **Manual action:** None.

### SEC-6 — Cross-code join enumeration unthrottled
- **Severity:** Medium
- **Category:** Abuse / enumeration
- **Component:** `joinRoom` + `rateLimits.ts`
- **Root cause:** The only join limiter keyed on the room code; sweeping many *different* codes evades it entirely, and the code space is 10,000. Queries can't enforce per-minute caps (read-only transactions — consumption writes state), and code-format gating already hides non-sensitive fields.
- **Fix:** Added a global fixed-window join limiter (`joinGlobal`, 1200/min) consumed before the per-code check. A classroom of 500 joining in the same minute uses <45% of the budget; enumeration is now bounded.
- **Verification:** Codegen/typecheck/build pass.
- **Residual risk:** Distributed/multi-source enumeration is slowed, not stopped; capability gating of room state (already present) remains the primary protection.
- **Manual action:** None.

### SEC-7 — Stale lockfile resolved a vulnerable auth library
- **Severity:** Medium (supply chain)
- **Category:** Dependency / supply chain
- **Component:** `package-lock.json`
- **Root cause:** The repo carried dual lockfiles; `package-lock.json` was stale and pinned `@auth/core 0.37.4` (3 advisories: GHSA-7rqj-j65f-68wh, GHSA-xmf8-cvqr-rfgj, GHSA-x445-f3h2-j279). The **actual bun-installed tree was already patched (0.41.3)**, so the runtime was never affected — but any npm-based consumer of the repo would have installed the vulnerable version.
- **Fix:** Regenerated `package-lock.json` from `package.json` (`npm install --package-lock-only --ignore-scripts`); it now resolves `@auth/core 0.41.3`, matching the bun tree. `npm audit` → **0 vulnerabilities** (prod and full). Bun install verified consistent.
- **Residual risk:** Dual lockfiles can drift again; consider removing one in a future cleanup (product/housekeeping decision).
- **Manual action:** None.

### Items verified secure (no change needed)
- **IDOR/BOLA:** every examiner mutation/query funnels through `requireExaminer` + `requireOwnedRoom`; every student write is scoped by `clientId` → single student row (`requireStudentByClient`). Tampering with room/student IDs yields `null`/error, never foreign data.
- **Vertical escalation:** the anonymous auth provider is gone; examiner provisioning requires an authenticated user; students have no auth identity and can never reach examiner functions.
- **Client-trust:** students send event *types*, never counts/flags/outcomes; `violationCount`, `flagged`, `autoSubmittedAt` are server-derived; auto-submit runs inside the recording mutation (`enforceAutoSubmit` idempotent, re-checks `isFinal`); closed rooms reject joins and lock saves; late submits are accepted-but-flagged (deliberate policy).
- **XSS/injection:** React escapes all text; stored code renders in `<pre><code>`; no `dangerouslySetInnerHTML` outside the template's `chart.tsx`; no `eval`; filenames sanitized (`sanitizeFilename`) against traversal; ZIP names de-duplicated.
- **Room-state endpoint:** `getExamRoomState` is capability-gated (full state only with this room's `clientId`); unknown codes return `null`; `lookupRoomByCode` was previously removed as over-exposing.
- **Error leakage:** `getErrorMessage` fallback discipline verified across all five consumer pages.
- **Real-time delivery:** `useQuery` subscriptions cover every monitored field (`students` tallies, `violationEvents`, `submissions`) — no polling exists anywhere; see §4.

---

## 4. Real-Time Integrity Audit

Architecture note: all examiner views are **Convex reactive subscriptions** — there is no polling, and no manual refresh requirement exists anywhere in the pipeline. The full data path was traced end-to-end for every action; each row below states the concrete mechanism, not an assumption.

| # | Student action | Mutation | Database record | Examiner query / subscription | UI update | Result |
|---|----------------|----------|-----------------|-------------------------------|-----------|--------|
| 1 | Code/editor changes | `saveSubmission` (isFinal:false, debounced 2.5s) | `submissions` upsert (by_student unique) | `getRoomSubmissions` (by_room) → Submissions tab; draft rows stream live | Draft rows + "saved HH:mm" refresh reactively | **PASS** (SEC-2 fixed the silent-skip hole) |
| 2 | Normal autosave | same | same | same | same | **PASS** |
| 3 | Final submission | `saveSubmission` (isFinal:true) | `isFinal:true` + first `submittedAt` | `getRoomCounts` + `getRoomSubmissions` both read `submissions` | Submitted count, attention strip, grading list | **PASS** |
| 4 | Auto-submit | `enforceAutoSubmit` inside `logViolationEvent`'s transaction | `submissions.isFinal:true` + `students.autoSubmittedAt` (same tx — cannot be lost/duplicated) | `getRoomCounts.autoSubmitted`, `getRoomMonitoring.autoSubmittedAt` | Auto-submitted pill, KPI, monitoring row | **PASS** |
| 5 | Exam expiration | student Timer fires `doSubmit` (isFinal:true) | `submissions` | as #3 | as #3 | **PASS** |
| 6 | Student locked state | `saveSubmission` returns `locked` (final exists or room CLOSED) | read-only check | `getMySubmission` (student) | editor readOnly + banners | **PASS** |
| 7 | Student joining | `joinRoom` (rate-limited, capacity-checked) | `students` insert | `getRoomCounts.joined` reads `students` by_room | joined counts, attention strip | **PASS** |
| 8 | Student leaving | Not supported (no leave mutation exists) | — | — | — | **N/A** (product scope; noted in §9) |
| 9 | Tab-switch violation | `logViolationEvent("blur")` | `violationEvents` + server tally | `getRoomMonitoring` reads `students` + `violationEvents` by_room | row count/pills, Needs Attention | **PASS** |
| 10 | Blur violation | same as #9 | same | same | same | **PASS** |
| 11 | Paste violation | `logViolationEvent("paste")` | same | same | same | **PASS** — **after SEC-1 fix** (was FAIL at the detection layer) |
| 12 | Copy violation | `logViolationEvent("copy")` | same | same | same | **PASS** |
| 13 | Other violation types | `rejoin` via `logRejoinEvent` (audit-only, never enforced) | `violationEvents` | breakdown counts | "Recent page loads" | **PASS** |
| 14 | Submission status | `saveSubmission` result (`late`) | `submittedAt` vs room window | `getRoomSubmissions` timestamps | "Submitted …" labels | **PASS** |
| 15 | Student progress/status | autosave writes | `submissions.updatedAt` | `getRoomSubmissions` | draft rows | **PASS** |
| 16 | Needs Attention count | (derived) | `students.flagged` + `autoSubmittedAt` | `getRoomCounts` sums both | dashboard KPI | **PASS** (sum verified — sets are disjoint by design) |
| 17 | Flagged count | `recordViolationEvent` (server-decided) | `students.flagged` | `getRoomCounts.flagged` | KPI, strip, cards | **PASS** |
| 18 | Auto-submitted count | `recordViolationEvent` → `autoSubmittedAt` | `students.autoSubmittedAt` | `getRoomCounts.autoSubmitted` | KPI, strip, cards | **PASS** |

**Race-condition review:** final submit vs. auto-submit vs. end-exam all converge on one `submissions` row per student; `upsertSubmission` keeps the first final timestamp; auto-submit re-checks `isFinal` inside the same transaction; examiner `endRoom` is idempotent. **Memoization:** `MonitoringRowItem`/`SubRow` are memoized on props; row props change when underlying data changes, so memoization cannot hide live updates. **Debounce:** autosave's 2.5s debounce is by design and now cannot drop the final write (SEC-2). No optimistic updates exist that could mislead the UI; no event-overwriting mutations exist (violationEvents is append-only).

**Honest limitation:** this is a static trace of the complete chain plus live codegen/typecheck/build — actual socket-level delivery was not exercised in a browser here.

---

## 5. Paste Violation Audit

- **Editor:** CodeMirror 6 (`@codemirror/view` 6.43.12).
- **Previous mechanism:** `EditorView.domEventHandlers({ paste, copy })` only.
- **Root cause:** DOM `paste` is not emitted on all editor-level paste paths (keyboard/IME clipboard insertion; Android `EditContext` in this CM version applies pastes without a DOM paste event). A legitimate paste inside the editor therefore never reached the violation reporter.
- **Fix:** detection moved to the editor integration layer — the `updateListener` checks each transaction's `userEvent` annotation (`tr.isUserEvent("input.paste")`), the annotation CodeMirror itself assigns to every paste it applies.
- **Verification (updated by second pass):** the first implementation had a **real double-reporting defect**: the DOM paste handler ran synchronously (user handlers dispatch before CodeMirror's internal conversion) and reported immediately, then the updateListener reported the resulting `input.paste` transaction again — the transaction-identity set only deduped *within* the transaction layer, so every normal Ctrl+V counted as **two violations** (double warning consumption; instant flag in zero-tolerance rooms). Re-verified by tracing `computeHandlers` ordering (index.js:4702 — user handlers precede internal) and `doPaste`'s transaction annotation. Final architecture: the transaction layer is the primary reporter (it covers all paste paths); the DOM handler now defers its decision by a macrotask and reports **only if** no paste transaction materialized (event swallowed before conversion) — exactly one report per physical paste, whichever layer saw it.
- **Duplicate-event protection (final):** per-update transaction-identity set (dedupes multi-transaction pastes) + a synchronous `pasteTxJustReported` flag consumed by the deferred DOM check (dedupes across the two layers). Normal typing never matches: typing is annotated `input.type[.compose]` (index.js:4423), which no layer treats as paste.
- **Normal typing excluded:** verified — normal typing is annotated `input.type[.compose]` (index.js:4423), which never matches; only genuine paste transactions (and the DOM event where no transaction results) report.
- **Editor functionality:** handlers return `false`/observe-only — pastes still work exactly as before; nothing is blocked or prevented.
- **Database verification:** `logViolationEvent` writes `violationEvents(type:"paste")` and increments the server tally; rate limit is silent-drop, so monitoring never breaks the exam.
- **Examiner real-time verification:** `getRoomMonitoring` (reactive) reads both the tally (row pill) and the event log (breakdown "Pastes into editor — HH:mm:ss"); the student's warning banner and any auto-submit flow through the same mutation's response/subscription.
- **Manual action (required, no browser here):** paste text into the editor during a live exam → confirm the paste counter increments in Monitoring without refresh, and that a zero-tolerance room flags / a limited room warns.

---

## 6. Mobile Navigation Audit

**Problems found**
1. No Escape-to-close and no outside-tap dismissal — a menu that only the toggle could close is non-standard mobile UX.
2. Focus management absent: opening did not move focus in; closing did not return it to the toggle (keyboard/switch users lost context).
3. The menu lacked `aria-controls` linkage semantics on the toggle.
4. Touch targets were sub-44px (12px padding at 15px-line desktop font sizes) — below the mobile minimum.
5. Links opened with no entrance rhythm — one static block, at odds with the app's otherwise deliberate motion language.

**Root causes:** the menu grew from a desktop navbar collapse (style-only hiding) rather than being designed as a mobile navigation system.

**Fixes (all consistent with the venue's warm design tokens; no dark/gloomy restyle):**
- Escape closes and returns focus to the toggle; `pointerdown` outside the header closes; both listeners are scoped to `menuOpen` and self-clean.
- Opening focuses the first nav link (next frame, post-transition); closing returns focus to the toggle.
- **(Second pass)** Link activation while the menu is open now moves focus to the toggle *before* the route change unmounts the link — previously, keyboard focus fell to `<body>` after navigating from the menu (the focused element was unmounted), stranding keyboard users. No-op on desktop; invisible for mouse users (`:focus-visible`-gated ring).
- `aria-controls="cv-mobile-menu"` added; `aria-expanded` labels were already correct.
- Touch targets raised to ≥44px (13px vertical padding at 15px font, full-width blocks) while keeping the existing paddings/colors; open-state headroom (`max-height`) raised accordingly.
- Subtle staggered entrance (three links, then actions; 0.24s each, 40ms offsets) using the existing `--ease-modal` curve, with a `prefers-reduced-motion` guard. The route-change auto-close (render-phase, no extra pass) was already present and untouched.

**Accessibility verification:** focus-visible rings exist for toggle/links (unchanged); contrast unchanged (existing 5.3:1 nav tokens); animation is transform/opacity only and reduced-motion-guarded; no information is conveyed by color alone; static typecheck/build/lint clean.
**Responsive verification:** static — geometry verified against the 860px breakpoint rules and the open-menu headroom; no horizontal-overflow vectors introduced (menu is full-width, no fixed pixel widths added). **Manual action:** one hands-on pass at ≤860px (open/close via toggle/Escape/outside tap, tab-through, route change).

---

## 7. Copy-Resistance Audit

**What is protected:** the exam's **question content container only**, and only in the student exam view (`QuestionBox` renders `.cv-question-box-protected` via the new `protected` prop on `/exam/:code`). Mechanism: `user-select: none` + `-webkit-user-select: none` + `-webkit-touch-callout: none` (blocks the iOS long-press callout), scoped to that one container. This discourages casual select-and-copy of the exam prompt — the content a student would paste elsewhere.

**What is deliberately NOT protected:** the code editor (fully selectable/copyable/copy-out detection is a product feature), all inputs and forms (auth, join, rejoin — selection and IME must work), navigation and UI chrome, and the examiner's own Overview prompt (it is their data — the protection is student-view-only).

**What cannot be protected client-side (explicitly):** devtools/DOM reading, screenshots and OCR, browser extensions, accessibility APIs and screen readers (which read the DOM regardless of `user-select`), a second device photographing the screen, and network inspection. Copy resistance here is **casual-friction only and is not a security boundary**. The product's actual integrity posture is **detection, not prevention**: copy-out of the editor is already a violation event, and paste-in is now detected reliably (SEC-1).

**Accessibility:** no global selection lock; keyboard navigation, zoom, high-contrast usage, and screen-reader access are unaffected (selection styling does not gate DOM access). No unnecessary ARIA was added.

---

## 8. Tests

| Command | Result |
|---|---|
| `bun convex dev --once` | **PASS** — functions generated and pushed twice (after backend edits, after rate-limit edit), no schema/type errors |
| `bun tsc -b --noEmit` | **PASS** — run after every fix batch (7× total across both passes) |
| `bun run build` | **PASS** — 13.7s / 14.8s / 13.6s, clean chunks, no warnings |
| `bun run lint` | 7 errors / 21 warnings — **all pre-existing and previously documented**: 2 intentional `Exam.tsx` server-subscription sync effects (business-critical, preserved per standing directive), 2 async-callback `Date.now` reads in `Exam.tsx` (`doSave`/`doSubmit` timestamps, not render-time), 3 stock shadcn/template files. **Zero errors from this pass's changes** (verified by diffing the pre-existing list). |
| `npm audit --omit=dev` / `npm audit` | **0 vulnerabilities** (after SEC-7 lockfile regeneration) |
| CSS integrity | `index.css` 432/432 braces, `index-monitor.css` 113/113 |
| On-disk fix verification | grep-confirmed for all 10 fix sites, then re-verified independently in the second pass (every SEC-1…SEC-7 fix confirmed present and correct in the live code; one defect *within* the SEC-1 fix itself — double-reporting — was found and fixed) |
| Browser runtime / live real-time round-trip | **Not performed — no browser interaction available in this environment** (no automation tool; starting/interacting with the managed dev server from the terminal is prohibited) |

Regression coverage: the repository has no test runner configured (`package.json` has no `test` script), so "regression tests" in the requested sense could not be added without introducing a new testing dependency/framework — out of scope for a smallest-change security pass. The data-flow contracts are documented as the §4 matrix instead, and each fix is behavior-verified via codegen/typecheck/build.

---

## 9. Remaining Issues

**Critical:** none.

**High:** none outstanding (SEC-1 and SEC-2 fixed; manual verification listed above).

**Medium:**
- Client-side paste/blur/copy detection is inherently bypassable (devtools/extensions). Accept: detection, not prevention, is the stated posture; server-side enforcement paths cannot be spoofed into over- or under-recording beyond dropped (rate-limited) events.

**Low:**
- Dual lockfiles (bun.lock + package-lock.json) can drift again — recommend deleting one in a future housekeeping pass.
- `getRoomSubmissions` reads `students` with `take(students.length + 1)` after students were fetched with `take(room.enrolledLimit + 1)`; a corner-case where submissions outnumber fetched students could truncate the last row. Practically unreachable (submissions ≤ students), noting for completeness.

**Product decisions (deliberately not implemented):**
- Student "leave" tracking (no such mutation exists — would be a feature).
- Attention-strip noise limiting ("N students still writing" filter/cap for large classes).
- Archive/delete retention for old exams; proctoring event retention/privacy policy documentation.
- Removing one of the two lockfiles.

**Manual verification required (no browser in this environment):**
1. Paste inside the editor during a live exam → Monitoring shows the paste without refresh; zero-tolerance room flags, limited room warns.
2. Continuous typing → stop → confirm "Saved" and examiner draft parity (SEC-2 end-to-end).
3. Mobile ≤860px: menu open/close via toggle/Escape/outside tap; keyboard tab-through; route-change auto-close.
4. Two-browser live session (one examiner, one student) to observe socket-level latency of counts and monitoring rows.

---

## 10. Production Readiness

**Verified:** server-side authorization on every sensitive operation (ownership + capability model); strict server-side validation with size caps on all inputs; rate limiting on every public mutation including the previously unguarded rejoin path; CSPRNG join codes; no secret tokens in examiner responses; error hygiene with no stack/internal leakage; XSS-safe rendering and filename sanitization; idempotent, transactional enforcement (auto-submit/submit/end); end-to-end reactive data paths for all 18 monitored actions (no polling, no stale derived state found); a11y/responsive states of the touched components.

**Fixed in the second pass:** the double-reporting defect inside the SEC-1 paste fix (every normal paste counted twice — verified by tracing CodeMirror's handler ordering and fixed with a deferred cross-layer dedupe); mobile-menu focus-stranding after link navigation; exam cards now show the actionable time context for a teacher ("Ends in N min" / "Time expired" / "Ended …") instead of "Started N min ago".

**Could not be tested here:** live browser behavior — actual paste detection through the full stack, autosave parity on a real device, mobile menu gestures, and socket-level real-time latency all require a hands-on session (list in §9).

**Still requires manual testing:** the four scenarios above. Nothing in this pass changed authentication, routing, exam creation, submission, auto-submit, monitoring, violation tracking, student locking, dashboard counts, or end-exam logic beyond the specific fixes described; the two intentional `Exam.tsx` subscription effects remain byte-identical.

**Claim discipline:** no claim of "secure" is made — only the specific, evidence-backed verifications above. No eslint-disable comments were added to hide findings; no template files were modified.

*Report ends.*
