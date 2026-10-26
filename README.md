# Code Venue

Live coding exams for examiners and students.

- **Examiners** sign in with an email verification code, create a timed exam room, get a room code (`CV-####`), and monitor students live (tab switches, pastes, copies) from a dashboard. Submissions can be downloaded as files or a ZIP when the exam ends.
- **Students** join with the room code (no account), write code in the browser editor with autosave, and submit before the timer runs out. Rejoining restores the ongoing attempt.

## Stack

Vite · React 19 · Convex (database + backend) · Convex Auth (email OTP via Resend) · Tailwind CSS v4 · CodeMirror 6. Deployed on Vercel.

## Development

```bash
npm install
npx convex dev          # runs codegen + syncs the Convex deployment
npm run dev             # Vite dev server on :5173
```

Environment: copy `.env.example` to `.env.local` and set `VITE_CONVEX_URL`. `RESEND_API_KEY` (for OTP emails) is set on the Convex deployment with `npx convex env set`, not in the repo.

## Build & checks

```bash
npm run build           # convex codegen + tsc + vite build
npm run lint
```

## Privacy & monitoring

Exam monitoring is detection, not prevention: the server tallies tab-switch/paste/copy events, students never send counts. Clipboard *content* is never sent or stored. Consent records, data-rights requests, and erasure are self-service (DPDP Act 2023 readiness). See `/privacy`, `/terms`, `/data-rights`, `/grievance` in the app.
....
