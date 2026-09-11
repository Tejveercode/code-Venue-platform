import { useEffect, useRef, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { ArrowUpRight, ArrowRight } from "lucide-react";
import { CodeVenuePage, VenueHeader } from "@/components/venue/ui";

/**
 * Reveal-on-scroll: adds .is-visible when 15% of the element enters the
 * viewport (threshold 0.15, rootMargin "0px 0px -50px 0px"). Transform and
 * opacity only.
 */
function Reveal({ className, children }: { className?: string; children: ReactNode }) {
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
    <div ref={ref} className={"ab-reveal" + (className ? ` ${className}` : "")}>
      {children}
    </div>
  );
}

const PILLARS = [
  {
    n: "01",
    title: "Four minutes, forty screens.",
    body: "One teacher, a lab full of students, and a walk-around check with no room for a second look. Working code got a glance — and a glance is where marks go to die. If that sounds familiar, you already know why Code Venue exists.",
  },
  {
    n: "02",
    title: "A mark should reflect the code.",
    body: "Not how many seconds a teacher had left. Code Venue doesn't grade for you — we're not interested in replacing a teacher's judgment. We make sure the judgment lands properly: the full file, read in the teacher's own time, with a record of exactly what happened during the exam.",
  },
  {
    n: "03",
    title: "Live today, not promised.",
    body: "Rooms run for real exams right now. Join by code, write in the browser, autosave on every keystroke, late submits flagged automatically, every submission zipped with one click when the exam ends. Everything on this page is shipped — nothing is on a roadmap.",
  },
];

type Member = { initials: string; name: string; role: string; href?: string };

const TEAM: Member[] = [
  { initials: "TS", name: "Tejveer Singh", role: "Co-founder · Engineering", href: "https://github.com/Tejveercode" },
  { initials: "AS", name: "Akashdeep Singh", role: "Co-founder · Engineering", href: "https://github.com/Akash-Grewal" },
  { initials: "AR", name: "Aditya Rangta", role: "Engineering", href: "https://github.com/Aditya-Rangta" },
  { initials: "DG", name: "Danish Gupta", role: "Engineering" },
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

        <main className="ab">
          {/* ---- Hero: the hook, set like an editorial opener ---- */}
          <Reveal>
            <header className="ab-hero">
              <p className="ab-eyebrow">About Code Venue</p>
              <h1>
                You wrote working code.
                <br />
                You still got a <em>zero.</em>
              </h1>
              <p className="ab-lede">
                Not because your logic was wrong — because one teacher had four
                minutes to check forty screens, and yours got a glance instead
                of a look. Code Venue exists to fix exactly that.
              </p>
            </header>
          </Reveal>

          <hr className="ab-rule" />

          {/* ---- The story: three beats, oversized ghost numerals ---- */}
          <section className="ab-story" aria-label="Our story">
            {PILLARS.map((p, i) => (
              <Reveal key={p.n} className={`ab-d${i}`}>
                <article className="ab-beat">
                  <span className="ab-num" aria-hidden="true">
                    {p.n}
                  </span>
                  <div className="ab-beat-body">
                    <h2>{p.title}</h2>
                    <p>{p.body}</p>
                  </div>
                </article>
              </Reveal>
            ))}
          </section>

          <hr className="ab-rule" />

          {/* ---- Team: two-column identity cards, no cramping ---- */}
          <Reveal>
            <section className="ab-team" aria-label="The creators">
              <p className="ab-eyebrow">The Creators</p>
              <h2 className="ab-team-title">Not a company. Four students.</h2>
              <p className="ab-lede">
                We sat through the same rushed lab checks everyone else did.
                We're the students who got the zero — and decided to fix the
                reason for it.
              </p>

              <ul className="ab-people">
                {TEAM.map((m) => {
                  const body = (
                    <>
                      <span className="ab-person-avatar">{m.initials}</span>
                      <span className="ab-person-meta">
                        <h3>{m.name}</h3>
                        <span>{m.role}</span>
                        {m.href ? (
                          <span className="ab-person-link">
                            GitHub <ArrowUpRight size={12} />
                          </span>
                        ) : null}
                      </span>
                    </>
                  );
                  return (
                    <li key={m.name}>
                      {m.href ? (
                        <a
                          className="ab-person ab-linked"
                          href={m.href}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {body}
                        </a>
                      ) : (
                        <div className="ab-person">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          </Reveal>

          {/* ---- Closing: one dark card, one decision ---- */}
          <Reveal>
            <section className="ab-cta">
              <h2>Choose your venue.</h2>
              <p>
                A room takes under a minute to set up. See the other side of
                the zero.
              </p>
              <div className="ab-cta-actions">
                <button
                  className="ab-btn-light"
                  onClick={() => navigate("/examiner-portal")}
                >
                  Run an exam <ArrowRight size={15} />
                </button>
                <button
                  className="ab-btn-ghost"
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
