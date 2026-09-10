import { useEffect } from "react";
import {
  Cpu,
  Eye,
  Gauge,
  MonitorPlay,
  ServerCog,
  ShieldCheck,
  Timer,
} from "lucide-react";
import { CodeVenuePage, VenueHeader } from "@/components/venue/ui";

const FEATURES = [
  {
    icon: Gauge,
    title: "Instant rooms",
    body: "Create an exam room in one click and get a shareable CV-code. No provisioning, no setup ceremony — open the portal and go.",
  },
  {
    icon: MonitorPlay,
    title: "Live exam venue",
    body: "Students join with a name and a code, meet the question above their editor, and start coding immediately.",
  },
  {
    icon: Timer,
    title: "Server-anchored clock",
    body: "The countdown is computed from the room's start time, so refreshing, switching tabs, or changing devices never buys extra time.",
  },
  {
    icon: ShieldCheck,
    title: "Honest submissions",
    body: "One submission record per student. Final submits are timestamped, late work is flagged instead of rejected, and drafts autosave.",
  },
  {
    icon: ServerCog,
    title: "Real persistence",
    body: "Every keystroke interval lands in the database. A crashed laptop or a dead battery doesn't erase a student's work.",
  },
  {
    icon: Eye,
    title: "Focused grading",
    body: "Open a room's submissions and read each student's final code in one clean view — pick a name, read the code.",
  },
];

const STACK = [
  "React + TypeScript",
  "Convex real-time backend",
  "Convex Auth (email OTP)",
  "Canvas2D pixel ambience",
  "Custom CSS design system",
  "Poppins typeface",
];

const TEAM = [
  {
    name: "Product & Design",
    role: "The venue concept",
    body: "Mapped the examiner's whole ritual — create, share, watch, grade — and shaped the interface around it with a warm, calm palette.",
  },
  {
    name: "Engineering",
    role: "Real-time exam engine",
    body: "Built the room lifecycle, autosave pipeline, and server-anchored timers on Convex so every client sees the same exam truth.",
  },
  {
    name: "Fairness & Integrity",
    role: "Rules that hold up",
    body: "Defined capacity limits, late-submit flagging, and immutable final submissions — honest mechanics over surveillance theater.",
  },
];

export default function About() {
  useEffect(() => {
    document.title = "About — Code Venue";
  }, []);

  return (
    <CodeVenuePage>
      <div className="cv-shell">
        <VenueHeader />
        <main className="cv-about-wrap">
          <span className="cv-kicker">About the venue</span>
          <h1 className="cv-about-title">
            A calm place to run
            <br />
            live coding <em>exams.</em>
          </h1>
          <p className="cv-about-lede">
            Code Venue exists because live coding exams deserve better than a
            shared doc and a broken clock. We built a single venue where
            examiners create a room, write the problem, and share a short code —
            and students join with just their name, no accounts, no setup. Work
            autosaves as it's typed, submissions are timestamped and locked, and
            grading happens in one focused view.
          </p>

          <div className="cv-about-grid">
            <div className="cv-card cv-card-hover cv-feature-card">
              <div className="cv-role-icon">
                <MonitorPlay size={20} />
              </div>
              <h4>The idea</h4>
              <p>
                Running a live coding exam shouldn't require juggling screens,
                files, and pasted snippets. A room, a code, and a clock — that's
                the whole workflow.
              </p>
            </div>
            <div className="cv-card cv-card-hover cv-feature-card">
              <div className="cv-role-icon">
                <ShieldCheck size={20} />
              </div>
              <h4>Fair by design</h4>
              <p>
                Timers live on the server, identity is a durable client key —
                not a name — and late submissions are flagged rather than
                rejected. The system is honest with everyone in the room.
              </p>
            </div>
            <div className="cv-card cv-card-hover cv-feature-card">
              <div className="cv-role-icon">
                <Timer size={20} />
              </div>
              <h4>What's next</h4>
              <p>
                This first version covers one room, end to end: create, join,
                code, autosave, submit, end, and grade. Deeper examiner tools
                and code execution are on the roadmap.
              </p>
            </div>
          </div>

          <section className="cv-about-section">
            <h2 className="cv-section-title">What you get</h2>
            <p className="cv-section-sub">
              The full arc of a live exam — before, during, and after — handled
              by the venue itself.
            </p>
            <div className="cv-feature-grid">
              {FEATURES.map((f) => (
                <div key={f.title} className="cv-card cv-card-hover cv-feature-card">
                  <div className="cv-role-icon">
                    <f.icon size={20} />
                  </div>
                  <h4>{f.title}</h4>
                  <p>{f.body}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="cv-about-section">
            <h2 className="cv-section-title">Built with</h2>
            <p className="cv-section-sub">
              A deliberately small stack, chosen so the venue stays fast and
              dependable under exam pressure.
            </p>
            <div className="cv-stack-row">
              {STACK.map((item) => (
                <span key={item} className="cv-stack-pill">
                  <Cpu size={13} /> {item}
                </span>
              ))}
            </div>
          </section>

          <section className="cv-about-section">
            <h2 className="cv-section-title">The team</h2>
            <p className="cv-section-sub">
              Built by a small crew of exam survivors who wanted better for
              everyone in the room.
            </p>
            <div className="cv-about-grid">
              {TEAM.map((m) => (
                <div key={m.name} className="cv-card cv-card-hover cv-feature-card">
                  <div className="cv-role-icon">
                    <span className="cv-team-initials">
                      {m.name.slice(0, 1)}
                    </span>
                  </div>
                  <h4>{m.name}</h4>
                  <p className="cv-team-role">{m.role}</p>
                  <p>{m.body}</p>
                </div>
              ))}
            </div>
          </section>
        </main>
        <footer className="cv-footer">
          Code Venue — where live coding exams happen.
        </footer>
      </div>
    </CodeVenuePage>
  );
}
