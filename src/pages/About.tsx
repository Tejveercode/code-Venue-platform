import { useEffect } from "react";
import { useNavigate } from "react-router";
import { motion } from "framer-motion";
import { ArrowUpRight, ArrowRight } from "lucide-react";
import { CodeVenuePage, VenueHeader } from "@/components/venue/ui";
import { VenueFooter } from "./Legal";
import { useVenueMotion } from "@/components/venue/motion";

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
  { initials: "DG", name: "Danish Gupta", role: "Engineering", href: "https://github.com/Craftedcode623" },
];

export default function About() {
  const navigate = useNavigate();
  const { variants, variantsScale, tapProps, hoverProps, inViewGroup, inViewGroupScale } =
    useVenueMotion();

  useEffect(() => {
    document.title = "Code Venue — About";
  }, []);

  return (
    <CodeVenuePage>
      <div className="cv-shell">
        <VenueHeader />

        <main className="ab">
          {/* ---- Hero: the hook, set like an editorial opener ---- */}
          <motion.div {...inViewGroup}>
            <header className="ab-hero">
              <motion.p className="ab-eyebrow" variants={variants}>
                About Code Venue
              </motion.p>
              <motion.h1 variants={variants}>
                You wrote working code.
                <br />
                You still got a <em>zero.</em>
              </motion.h1>
              <motion.p className="ab-lede" variants={variants}>
                Not because your logic was wrong — because one teacher had four
                minutes to check forty screens, and yours got a glance instead
                of a look. Code Venue exists to fix exactly that.
              </motion.p>
            </header>
          </motion.div>

          <hr className="ab-rule" />

          {/* ---- The story: three beats, oversized ghost numerals ---- */}
          <section className="ab-story" aria-label="Our story">
            <motion.div className="ab-story-inner" {...inViewGroup}>
              {PILLARS.map((p) => (
                <motion.article key={p.n} className="ab-beat" variants={variants}>
                  <span className="ab-num" aria-hidden="true">
                    {p.n}
                  </span>
                  <div className="ab-beat-body">
                    <h2>{p.title}</h2>
                    <p>{p.body}</p>
                  </div>
                </motion.article>
              ))}
            </motion.div>
          </section>

          <hr className="ab-rule" />

          {/* ---- Team: two-column identity cards, no cramping ---- */}
          <motion.section className="ab-team" aria-label="The creators" {...inViewGroup}>
            <motion.p className="ab-eyebrow" variants={variants}>
              The Creators
            </motion.p>
            <motion.h2 className="ab-team-title" variants={variants}>
              Not a company. Four students.
            </motion.h2>
            <motion.p className="ab-lede" variants={variants}>
              We sat through the same rushed lab checks everyone else did.
              We're the students who got the zero — and decided to fix the
              reason for it.
            </motion.p>

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
                  <motion.li
                    key={m.name}
                    className="ab-person-li"
                    variants={variants}
                    {...hoverProps}
                  >
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
                  </motion.li>
                );
              })}
            </ul>
          </motion.section>

          {/* ---- Closing: one dark card, one decision ---- */}
          <motion.section className="ab-cta" aria-label="Choose your venue" {...inViewGroupScale}>
            <motion.h2 variants={variantsScale}>Choose your venue.</motion.h2>
            <motion.p variants={variantsScale}>
              A room takes under a minute to set up. See the other side of
              the zero.
            </motion.p>
            <motion.div className="ab-cta-actions" variants={variantsScale}>
              <motion.button
                className="ab-btn-light"
                onClick={() => navigate("/examiner-portal")}
                {...tapProps}
              >
                Run an exam <ArrowRight size={15} />
              </motion.button>
              <motion.button
                className="ab-btn-ghost"
                onClick={() => navigate("/student-portal")}
                {...tapProps}
              >
                Join an exam
              </motion.button>
            </motion.div>
          </motion.section>
        </main>

        <VenueFooter />
      </div>
    </CodeVenuePage>
  );
}
