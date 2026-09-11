import { useEffect, useRef, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Github, ArrowRight } from "lucide-react";
import { CodeVenuePage, VenueHeader } from "@/components/venue/ui";

/**
 * Reveal-on-scroll: adds .is-visible when 15% of the element enters the
 * viewport (threshold 0.15, rootMargin "0px 0px -50px 0px") — same behavior
 * the page has always had, kept for the redesign.
 */
function Reveal({ className, children }: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -50px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

type Member = {
  initials: string;
  name: string;
  role: string;
  href?: string;
};

const TEAM: Member[] = [
  { initials: "TS", name: "Tejveer Singh", role: "Engineering", href: "https://github.com/Tejveercode" },
  { initials: "AS", name: "Akashdeep Singh", role: "Engineering", href: "https://github.com/Akash-Grewal" },
  { initials: "AR", name: "Aditya Rangta", role: "Engineering", href: "https://github.com/Aditya-Rangta" },
  { initials: "DG", name: "Danish Gupta", role: "Engineering" },
];

/** The three-beat story: the problem, the belief, the proof. */
const PILLARS = [
  {
    kicker: "01 · The problem",
    title: "Four minutes, forty screens.",
    body: "One teacher, a lab full of students, and a walk-around check with no room for a second look. Working code got a glance and a zero. If that sounds familiar, you already know why Code Venue exists.",
  },
  {
    kicker: "02 · The belief",
    title: "A mark should reflect the code.",
    body: "Not how many seconds a teacher had left. Code Venue doesn't grade for you — we're not interested in replacing a teacher's judgment. We make sure that judgment gets applied properly: the full file, in the teacher's own time, with a record of exactly what happened.",
  },
  {
    kicker: "03 · The proof",
    title: "Live today, not promised.",
    body: "Rooms run for real exams right now: join by code, code in the browser, autosave on every keystroke, flagged late submits, one-click zip of every submission. Everything on this page is shipped, not on a roadmap.",
  },
];

export default function About() {
  const navigate = useNavigate();

  useEffect(() => {
    document.title = "Code Venue — About";
  }, []);

  return (
    <CodeVenuePage>
      <div className="cv-shell">
        <VenueHeader />

        <main className="about2">
          {/* Hero — the story hook, large and unmissable. */}
          <Reveal className="about2-reveal">
            <section className="about2-hero">
              <span className="cv-kicker">About Code Venue</span>
              <h1>
                You wrote working code.
                <br />
                You still got a <em>zero.</em>
              </h1>
              <p>
                Not because your logic was wrong — because one teacher had four
                minutes to check forty screens, and yours got a glance instead
                of a look. Code Venue exists to fix exactly that.
              </p>
            </section>
          </Reveal>

          {/* Three-beat narrative — problem, belief, proof. */}
          <div className="about2-pillars">
            {PILLARS.map((p, i) => (
              <Reveal key={p.kicker} className={`about2-reveal d${i}`}>
                <section className="cv-card about2-pillar">
                  <span className="about2-kicker">{p.kicker}</span>
                  <h2>{p.title}</h2>
                  <p>{p.body}</p>
                </section>
              </Reveal>
            ))}
          </div>

          {/* Team — full names, linked where available. */}
          <Reveal className="about2-reveal">
            <section className="about2-team">
              <span className="cv-kicker">The Creators</span>
              <h2>Not a company. Four students.</h2>
              <p>
                We sat through the same rushed lab checks everyone else did.
                We're the students who got the zero — and decided to fix the
                reason for it.
              </p>

              <div className="about2-team-grid">
                {TEAM.map((m) => {
                  const card = (
                    <>
                      <div className="team-avatar">{m.initials}</div>
                      <div className="about2-member">
                        <h3>{m.name}</h3>
                        <span>{m.role}</span>
                      </div>
                      {m.href && (
                        <span className="about2-member-link">
                          <Github size={13} /> GitHub
                        </span>
                      )}
                    </>
                  );
                  return m.href ? (
                    <a
                      key={m.name}
                      href={m.href}
                      target="_blank"
                      rel="noreferrer"
                      className="cv-card cv-card-hover about2-member-card"
                    >
                      {card}
                    </a>
                  ) : (
                    <div key={m.name} className="cv-card about2-member-card">
                      {card}
                    </div>
                  );
                })}
              </div>
            </section>
          </Reveal>

          {/* Clear next step. */}
          <Reveal className="about2-reveal">
            <section className="cv-card about2-cta">
              <h2>Choose your venue.</h2>
              <div className="about2-cta-row">
                <button
                  className="cv-btn cv-btn-primary"
                  onClick={() => navigate("/examiner-portal")}
                >
                  Run an exam <ArrowRight size={15} />
                </button>
                <button
                  className="cv-btn cv-btn-secondary"
                  onClick={() => navigate("/student-portal")}
                >
                  Join an exam
                </button>
              </div>
            </section>
          </Reveal>
        </main>

        <footer className="cv-footer">
          Code Venue — where live coding exams happen.
        </footer>
      </div>
    </CodeVenuePage>
  );
}
