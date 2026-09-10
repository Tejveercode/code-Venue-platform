import { useEffect } from "react";
import { useNavigate } from "react-router";
import { GraduationCap, MonitorPlay, ShieldCheck, Timer, Users, Zap, ArrowRight } from "lucide-react";
import { CodeVenuePage, VenueHeader } from "@/components/venue/ui";

const FEATURES = [
  {
    icon: MonitorPlay,
    title: "Live exam rooms",
    body: "Examiners spin up a room in seconds and get a unique code. Students join with just their name — no accounts needed.",
  },
  {
    icon: Timer,
    title: "Server-anchored timers",
    body: "Countdowns are computed from the room's start time and duration, so refreshing or switching devices never buys extra time.",
  },
  {
    icon: Zap,
    title: "Autosaved work",
    body: "Code saves to the database as students type. A crashed tab, a dead battery, a spotty connection — nothing is ever lost.",
  },
  {
    icon: ShieldCheck,
    title: "Honest submissions",
    body: "One submission record per student. Final submits are timestamped, late arrivals are flagged, and nothing is silently rejected.",
  },
  {
    icon: Users,
    title: "Real-time rosters",
    body: "The examiner dashboard updates the moment a student joins or submits — no manual refreshing, no stale counts.",
  },
  {
    icon: GraduationCap,
    title: "Grading made simple",
    body: "Open a room's submissions and read each student's final code in a clean, focused viewer. Pick a name, read the code.",
  },
];

export default function Landing() {
  const navigate = useNavigate();

  // Ensure a signed-in examiner lands somewhere useful instead of a dead end.
  useEffect(() => {
    document.title = "Code Venue — Live Coding Exams";
  }, []);

  return (
    <CodeVenuePage>
      <div className="cv-shell">
        <VenueHeader />

        <section className="cv-hero">
          <span className="cv-kicker">Live coding exams</span>
          <h1>
            Run coding exams that
            <br />
            just <em>work.</em>
          </h1>
          <p className="cv-hero-sub">
            Code Venue is the venue for live coding exams — examiners create a
            room and share a code, students join in one click and code against
            the clock. Real autosaves, real timers, real submissions.
          </p>
        </section>

        <section className="cv-role-grid">
          <div
            className="cv-card cv-card-hover cv-role-card"
            role="button"
            tabIndex={0}
            onClick={() => navigate("/examiner-portal")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") navigate("/examiner-portal");
            }}
          >
            <div className="cv-role-icon">
              <MonitorPlay size={22} />
            </div>
            <h3>I'm an Examiner</h3>
            <p>
              Create live exam rooms, share the code, watch submissions roll in
              and grade them in one place.
            </p>
            <span className="cv-role-cta">
              Enter examiner portal <ArrowRight size={15} />
            </span>
          </div>

          <div
            className="cv-card cv-card-hover cv-role-card"
            role="button"
            tabIndex={0}
            onClick={() => navigate("/student-portal")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") navigate("/student-portal");
            }}
          >
            <div className="cv-role-icon">
              <GraduationCap size={22} />
            </div>
            <h3>I'm a Student</h3>
            <p>
              Got a room code from your examiner? Jump straight into the exam —
              your work autosaves as you go.
            </p>
            <span className="cv-role-cta">
              Join an exam <ArrowRight size={15} />
            </span>
          </div>
        </section>

        <section className="cv-feature-section">
          <h2 className="cv-section-title">Everything an exam venue needs</h2>
          <p className="cv-section-sub">
            Built for the full arc of a live exam — before, during, and after.
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

        <footer className="cv-footer">
          Code Venue — where live coding exams happen.
        </footer>
      </div>
    </CodeVenuePage>
  );
}
