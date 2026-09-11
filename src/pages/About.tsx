import { useEffect, useRef, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { CodeVenuePage, VenueHeader } from "@/components/venue/ui";

/**
 * React equivalent of the original about.html <script> IntersectionObserver:
 * observes each section and adds .is-visible when 15% enters the viewport
 * (threshold: 0.15, rootMargin: "0px 0px -50px 0px").
 */
function Reveal({ className, children }: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLElement | null>(null);

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
    <section ref={ref} className={className}>
      {children}
    </section>
  );
}

export default function About() {
  const navigate = useNavigate();

  useEffect(() => {
    document.title = "Code Venue — About";
  }, []);

  return (
    <CodeVenuePage>
      <div className="cv-shell">
        <VenueHeader />

        <main className="about-container">
          {/* Block 1: Their Problem (Hero) */}
          <Reveal className="about-section reveal-up">
            <h1
              className="glitch-text"
              data-text="You wrote working code. You still got a zero."
            >
              You wrote working code.
              <br />
              You still got a zero.
            </h1>
            <p className="about-lead">
              Not because your logic was wrong — because one teacher had four
              minutes to check forty screens, and yours got a glance instead of a
              look. If that sounds familiar, you already know why Code Venue
              exists.
            </p>
          </Reveal>

          {/* Block 2: Why We Started */}
          <Reveal className="about-section split-section reveal-left">
            <div className="section-content card-glass">
              <div className="badge">The Origin</div>
              <h2>Why We Started</h2>
              <p>
                We didn't set out to build an exam platform. We sat through one
                lab test where a teammate — code fully working — walked away
                with zero marks, because a rushed, walk-around check has no room
                for a second look.
              </p>
              <p className="highlight-quote">
                "That's not a grading problem. That's a time problem wearing a
                grading problem's face."
              </p>
            </div>
          </Reveal>

          {/* Block 3: What We Stand For */}
          <Reveal className="about-section split-section reverse reveal-right">
            <div className="section-content card-glass border-glow">
              <div className="badge">The Philosophy</div>
              <h2>What We Stand For</h2>
              <p>
                We believe a mark should reflect what you actually wrote, not
                how many seconds a teacher had left. Code Venue doesn't grade
                for you — we're not interested in replacing a teacher's
                judgment.
              </p>
              <p>
                We just make sure that judgment gets applied properly: with the
                full file, in the teacher's own time, with a record of exactly
                what happened during the exam. Teacher runs the room. We just
                make sure nothing gets lost in the rush.
              </p>
            </div>
          </Reveal>

          {/* Block 4: Proof */}
          <Reveal className="about-section text-center reveal-zoom">
            <h2>This isn't a pitch deck idea.</h2>
            <p className="about-sub">
              Code Venue is live. Examiners create rooms and run real exams
              today — students join with a code, write code in the browser,
              and every submission autosaves as they type.
            </p>
            <p className="about-sub">
              Every feature on this site — the one-code rooms, the autosave
              with late-submit flagging, the one-click zip download — is
              something we've actually built, not something we're promising.
            </p>

            <div className="tech-stack">
              <span className="tech-pill float-1">React</span>
              <span className="tech-pill float-2">TypeScript</span>
              <span className="tech-pill float-3">Convex</span>
              <span className="tech-pill float-1">Convex Auth</span>
              <span className="tech-pill float-2">Realtime</span>
              <span className="tech-pill float-3">Live Exams</span>
            </div>
          </Reveal>

          {/* Bonus: The Team */}
          <Reveal className="about-section team-section reveal-up">
            <div className="text-center" style={{ marginBottom: 40 }}>
              <div className="badge">The Creators</div>
              <h2>We're not a company.</h2>
              <p className="about-sub">
                Built by four BCA students under Mr. Arvinder Singh at
                Chandigarh University. We're the students who got the zero, and
                decided to fix the reason for it.
              </p>
            </div>

            <div className="team-grid">
              <a
                href="https://github.com/Tejveercode"
                target="_blank"
                rel="noreferrer"
                className="team-card hover-glow"
              >
                <div className="team-avatar">TS</div>
                <h3>Tejveer</h3>
                <span>BCA Student</span>
              </a>
              <div className="team-card hover-glow">
                <div className="team-avatar">AS</div>
                <h3>Akashdeep</h3>
                <span>BCA Student</span>
              </div>
              <div className="team-card hover-glow">
                <div className="team-avatar">A</div>
                <h3>Aditya</h3>
                <span>BCA Student</span>
              </div>
              <div className="team-card hover-glow">
                <div className="team-avatar">D</div>
                <h3>Danish</h3>
                <span>BCA Student</span>
              </div>
            </div>
          </Reveal>

          {/* Block 5: Clear Next Step */}
          <Reveal className="about-section text-center cta-section reveal-zoom">
            <h2 style={{ marginBottom: 30 }}>Choose Your Venue</h2>

            <div className="cta-grid">
              <div className="cta-card examiner-cta">
                <h3>For Teachers</h3>
                <p>
                  Create a room and see what a monitored, unhurried grading
                  process actually feels like.
                </p>
                <button
                  className="terminal-btn"
                  onClick={() => navigate("/examiner-portal")}
                >
                  <span className="prompt">$</span> examiner-portal --enter
                </button>
              </div>

              <div className="cta-card student-cta">
                <h3>For Students</h3>
                <p>
                  The next test you sit shouldn't come down to how fast someone
                  can glance at your screen.
                </p>
                <button
                  className="terminal-btn"
                  onClick={() => navigate("/student-portal")}
                >
                  <span className="prompt">$</span> student-portal --enter
                </button>
              </div>
            </div>
          </Reveal>
        </main>

        <footer className="cv-footer">
          Code Venue — where live coding exams happen.
        </footer>
      </div>
    </CodeVenuePage>
  );
}
