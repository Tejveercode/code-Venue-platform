import { useEffect } from "react";
import { useNavigate } from "react-router";
import { motion } from "framer-motion";
import { GraduationCap, MonitorPlay, ShieldCheck, Timer, Users, Zap, ArrowRight, FileArchive, TimerReset, Wifi } from "lucide-react";
import { CodeVenuePage, VenueHeader } from "@/components/venue/ui";
import { VenueFooter } from "./Legal";
import { useVenueMotion } from "@/components/venue/motion";

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

/** Scannable proof strip — three claims a visitor can verify at a glance. */
const PROOF = [
  { icon: TimerReset, title: "No lost work", body: "Autosave every keystroke — crashes don't cost marks." },
  { icon: Wifi, title: "No exam-day setup", body: "One code joins the room. No installs, no accounts for students." },
  { icon: FileArchive, title: "One-click grading", body: "Download every submission as a zip when the exam ends." },
];

export default function Landing() {
  const navigate = useNavigate();
  const { variants, tapProps, hoverProps, mountGroup, inViewGroup } = useVenueMotion();

  useEffect(() => {
    document.title = "Code Venue — Live Coding Exams";
  }, []);

  return (
    <CodeVenuePage>
      <div className="cv-shell">
        <VenueHeader />

        {/* 02. Clear hero message — one sentence, then the next action. */}
        {/* Entrance animates opacity/transform only — headline text itself is
            never split, typed, or delayed beyond the stagger slot. */}
        <motion.section className="cv-hero" {...mountGroup}>
          <motion.span className="cv-kicker" variants={variants}>
            Live coding exams
          </motion.span>
          <motion.h1 variants={variants}>
            Run coding exams that
            <br />
            just <em>work.</em>
          </motion.h1>
          <motion.p className="cv-hero-sub" variants={variants}>
            Code Venue is the venue for live coding exams — examiners create a
            room and share a code, students join in one click and code against
            the clock. Real autosaves, real timers, real submissions.
          </motion.p>
          <motion.div className="cv-hero-cta" variants={variants}>
            <motion.button
              className="cv-btn cv-btn-primary cv-motion-btn"
              onClick={() => navigate("/student-portal")}
              {...tapProps}
            >
              Join an exam <ArrowRight size={15} />
            </motion.button>
            <motion.button
              className="cv-btn cv-btn-secondary cv-motion-btn"
              onClick={() => navigate("/examiner-portal")}
              {...tapProps}
            >
              Run an exam
            </motion.button>
          </motion.div>
        </motion.section>

        {/* 03. Logical flow — answer "what do you do?" with two obvious paths. */}
        <motion.section className="cv-role-grid" {...mountGroup}>
          <motion.div
            className="cv-card cv-card-hover cv-role-card cv-motion-card"
            role="button"
            tabIndex={0}
            onClick={() => navigate("/examiner-portal")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") navigate("/examiner-portal");
            }}
            variants={variants}
            {...hoverProps}
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
          </motion.div>

          <motion.div
            className="cv-card cv-card-hover cv-role-card cv-motion-card"
            role="button"
            tabIndex={0}
            onClick={() => navigate("/student-portal")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") navigate("/student-portal");
            }}
            variants={variants}
            {...hoverProps}
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
          </motion.div>
        </motion.section>

        {/* Proof before persuasion — the "why should I trust you?" answer. */}
        <section className="cv-feature-section" aria-label="Why Code Venue">
          <motion.div className="cv-stat-row" {...inViewGroup}>
            {PROOF.map((p) => (
              <motion.div
                key={p.title}
                className="cv-card cv-card-hover cv-stat-card cv-motion-card"
                variants={variants}
                {...hoverProps}
              >
                <span className="cv-stat-label">
                  <p.icon size={14} /> {p.title}
                </span>
                <span className="cv-stat-body">{p.body}</span>
              </motion.div>
            ))}
          </motion.div>
        </section>

        <section className="cv-feature-section">
          <h2 className="cv-section-title">Everything an exam venue needs</h2>
          <p className="cv-section-sub">
            Built for the full arc of a live exam — before, during, and after.
          </p>
          <motion.div className="cv-feature-grid" {...inViewGroup}>
            {FEATURES.map((f) => (
              <motion.div
                key={f.title}
                className="cv-card cv-card-hover cv-feature-card cv-motion-card"
                variants={variants}
                {...hoverProps}
              >
                <div className="cv-role-icon">
                  <f.icon size={20} />
                </div>
                <h4>{f.title}</h4>
                <p>{f.body}</p>
              </motion.div>
            ))}
          </motion.div>
          {/* "Tell me what to do next." */}
          <div className="cv-hero-cta" style={{ justifyContent: "center", marginTop: 34 }}>
            <motion.button
              className="cv-btn cv-btn-primary cv-motion-btn"
              onClick={() => navigate("/examiner-portal")}
              {...tapProps}
            >
              Start your first exam <ArrowRight size={15} />
            </motion.button>
          </div>
        </section>

        <VenueFooter />
      </div>
    </CodeVenuePage>
  );
}
