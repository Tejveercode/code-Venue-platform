import { useEffect } from "react";
import { MonitorPlay, ShieldCheck, Timer } from "lucide-react";
import { CodeVenuePage, VenueHeader } from "@/components/venue/ui";

export default function About() {
  useEffect(() => {
    document.title = "About — Code Venue";
  }, []);

  return (
    <CodeVenuePage>
      <div className="cv-shell">
        <VenueHeader />
        <main className="cv-about-wrap">
          <h1>About Code Venue</h1>
          <p className="cv-about-lede">
            Code Venue is a focused platform for running live coding exams.
            Examiners create a room, write the problem, and share a short
            code. Students join with just their name — no accounts, no setup —
            and write code against a server-anchored countdown. Everything is
            autosaved as they type, submitted work is timestamped and locked,
            and examiners grade from a single clean view.
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
        </main>
        <footer className="cv-footer">
          Code Venue — where live coding exams happen.
        </footer>
      </div>
    </CodeVenuePage>
  );
}
