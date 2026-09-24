import { api } from "@/convex/_generated/api";
import { CodeVenuePage, VenueHeader } from "@/components/venue/ui";
import { useAuth } from "@/hooks/use-auth";
import {
  DATA_INVENTORY,
  POLICY_EFFECTIVE_DATE,
  POLICY_VERSIONS,
  PRIVACY_CONTACT,
  PROCESSORS,
  STORAGE_DISCLOSURE,
  CHILDREN_NOTE,
} from "@/lib/policy";
import { format } from "date-fns";
import { Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useMutation } from "convex/react";
import { getErrorMessage } from "@/lib/errors";

// ---------------------------------------------------------------------------
// Policy pages — the written surface of the DPDP-readiness controls. The
// wording describes EXACTLY what the platform does (see DATA_INVENTORY, the
// processors list, and the codebase itself). No compliance claims: legal
// applicability and final language require human/legal review.
//
// One file, five small components — they share the shell, footer, and
// typography; splitting them into five files would duplicate the shell for
// no benefit at this size.
// ---------------------------------------------------------------------------

function PolicyShell({ title, lede, children }: { title: string; lede: string; children: ReactNode }) {
  return (
    <CodeVenuePage>
      <div className="cv-shell">
        <VenueHeader />
        <main className="cv-page-wrap">
          <article className="cv-policy">
            <h1>{title}</h1>
            <p className="cv-policy-version">
              Version {POLICY_VERSIONS.privacy === POLICY_VERSIONS.terms ? POLICY_VERSIONS.privacy : POLICY_VERSIONS.privacy} · Effective {POLICY_EFFECTIVE_DATE}
            </p>
            <p className="cv-policy-lede">{lede}</p>
            {children}
          </article>
        </main>
        <VenueFooter />
      </div>
    </CodeVenuePage>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="cv-policy-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Privacy Notice
// ---------------------------------------------------------------------------

export function PrivacyNotice() {
  useEffect(() => {
    document.title = "Privacy Notice — Code Venue";
  }, []);
  return (
    <PolicyShell
      title="Privacy Notice"
      lede="What personal data Code Venue processes, why, where it lives, who can see it, and how it goes away. Written to match the platform's actual behavior — the data inventory below is the codebase's own."
    >
      <Section title="The short version">
        <ul className="cv-policy-list">
          <li>Students need no account. They join with a name (and optional ID) their examiner gives them a code for; a random exam ID (like S-7F3K2Q) labels their work.</li>
          <li>Examiners sign in with an email one-time code. Their email and chosen name form the account.</li>
          <li>Everything a student writes, and the exam's monitoring events, are visible to <strong>their own examiner only</strong> — and are deleted when the examiner deletes the exam room or erases their account.</li>
          <li>No advertising, no tracking pixels, no analytics, no data sales. Ever.</li>
        </ul>
      </Section>

      <Section title="Data inventory — every category we process">
        <div className="cv-policy-tablewrap">
          <table className="cv-policy-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>What</th>
                <th>Why</th>
                <th>Where / who / processors</th>
                <th>Retention &amp; deletion</th>
              </tr>
            </thead>
            <tbody>
              {DATA_INVENTORY.map((d) => (
                <tr key={d.category}>
                  <td>{d.category}</td>
                  <td>{d.collected}</td>
                  <td>{d.purpose}</td>
                  <td>
                    {d.stored}. Access: {d.access}. Processors: {d.processors}.
                  </td>
                  <td>
                    {d.retention}. {d.deletion}.
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="cv-policy-note">
          We collect nothing beyond what running and grading an exam requires
          (data minimization). We do not collect IP addresses, device
          fingerprints, or location, and monitoring events never contain
          clipboard content — only that a paste, copy, tab switch, or page
          reload happened, and when.
        </p>
      </Section>

      <Section title="Exam monitoring (integrity events)">
        <p>
          At the examiner's discretion, the exam records integrity events: tab
          switches, pastes into the code editor, copies out of it, and page
          reloads — each as a type and a timestamp. The examiner decides what
          the counts mean for their exam. This is detection for a legitimate
          purpose (exam integrity), scoped to the exam, never shared, and gone
          with the room. It cannot be avoided while the exam runs; if that
          bothers you, raise it with your institution before the exam.
        </p>
      </Section>

      <Section title="Service providers (processors)">
        <ul className="cv-policy-list">
          {PROCESSORS.map((p) => (
            <li key={p.name}>
              <strong>{p.name}</strong> — {p.role}
            </li>
          ))}
        </ul>
        <p className="cv-policy-note">
          No other third parties receive personal data. Nothing optional
          (analytics, marketing) is loaded before — or after — any consent
          choice, because no such processing exists.
        </p>
      </Section>

      <Section title="Children (under 18)">
        <p>{CHILDREN_NOTE}</p>
      </Section>

      <Section title="Security practices">
        <ul className="cv-policy-list">
          <li>Exam-session access uses a random 128-bit capability token minted server-side at join; every read and write re-checks it server-side.</li>
          <li>Examiner routes re-verify room ownership on every request; students can only ever reach their own attempt's data.</li>
          <li>Rate limiting protects sign-in, joining, autosave, and monitoring paths.</li>
          <li>Authorization-boundary denials are logged (event class, time, ids — never tokens or content) so incidents can be investigated.</li>
        </ul>
      </Section>

      <Section title="Your rights and how to use them">
        <p>
          You can ask for access to your data, correction, or erasure, raise a
          grievance, or withdraw consent — see the{" "}
          <Link to="/data-rights" className="cv-link">Data Rights page</Link>.
          Signed-in examiners can file and track requests there directly;
          erasure of an examiner account deletes every exam room they own,
          with all student data inside. Students: your exam data is held by
          your examiner — contact them (or us via the grievance route) and the
          examiner can delete the room and everything in it.
        </p>
      </Section>

      <Section title={`Grievances and contact — ${PRIVACY_CONTACT.responseAim}`}>
        <p>
          {PRIVACY_CONTACT.role}:{" "}
          <a className="cv-link" href={`mailto:${PRIVACY_CONTACT.email}`}>{PRIVACY_CONTACT.email}</a>
          . We aim to respond {PRIVACY_CONTACT.responseAim}. Code Venue has not
          appointed a Data Protection Officer (none is currently required for
          this product); this designated privacy contact handles privacy and
          grievance matters.
        </p>
      </Section>

      <Section title="Consent, and withdrawing it">
        <p>
          Where we rely on consent (for example, the acknowledgements at join
          or sign-up), the notice version and timestamp are recorded with the
          consent. Withdrawing examiner consent happens on the Data Rights
          page and is never harder than giving it. Note that withdrawal ends
          future consent-based processing; exam records already created serve
          the exam's purpose and remain under the examiner's control until
          deleted (see retention above).
        </p>
      </Section>
    </PolicyShell>
  );
}

// ---------------------------------------------------------------------------
// Terms of Service
// ---------------------------------------------------------------------------

export function TermsOfService() {
  useEffect(() => {
    document.title = "Terms of Service — Code Venue";
  }, []);
  return (
    <PolicyShell
      title="Terms of Service"
      lede="The rules for using Code Venue, written to match how the platform actually behaves."
    >
      <Section title="1. Roles">
        <p>
          <strong>Examiners</strong> create exam rooms, share their codes, and
          are responsible for the exams they run and for the student data
          those rooms contain. <strong>Students</strong> join rooms with a
          code and do not create an account. Code Venue is the venue that runs
          the exam; the examiner directs what happens in their room.
        </p>
      </Section>
      <Section title="2. Exam integrity monitoring">
        <p>
          Exam rooms may record integrity events (tab switches, pastes,
          copies, page reloads) as timestamped counts, visible to the
          examiner. The platform cannot technically prevent such actions; it
          detects and reports them to the examiner, who decides any response.
          Using Code Venue in an exam means accepting that monitoring for that
          exam.
        </p>
      </Section>
      <Section title="3. Submissions and autosave">
        <p>
          Work autosaves as the student types, and final submission locks the
          attempt. Submissions persist until the examiner deletes the room.
          The examiner's database record is the authoritative submission; any
          downloaded document (PDF export) is a readable representation of it.
        </p>
      </Section>
      <Section title="4. Acceptable use">
        <ul className="cv-policy-list">
          <li>Don't disrupt exams you're not part of, probe other users' rooms, attempts, or data, or attempt to bypass rate limits or access controls.</li>
          <li>Don't use Code Venue where it would break your institution's rules or applicable law.</li>
          <li>Examiners: obtain whatever consent/notice your institution requires from participants before running an exam that monitors integrity events.</li>
        </ul>
      </Section>
      <Section title="5. Availability">
        <p>
          The service aims to be dependable during exams (autosave is designed
          so a crashed tab doesn't lose work), but no uptime guarantee is
          made. Report problems via the grievance route on the Data Rights
          page or to your examiner.
        </p>
      </Section>
      <Section title="6. Data handling">
        <p>
          Personal data is handled as described in the{" "}
          <Link className="cv-link" to="/privacy">Privacy Notice</Link>, which
          forms part of these terms.
        </p>
      </Section>
    </PolicyShell>
  );
}

// ---------------------------------------------------------------------------
// Cookie & Storage Policy
// ---------------------------------------------------------------------------

export function CookiePolicy() {
  useEffect(() => {
    document.title = "Cookie & Storage Policy — Code Venue";
  }, []);
  return (
    <PolicyShell
      title="Cookie & Storage Policy"
      lede="Everything Code Venue stores in your browser, classified. Nothing optional, nothing tracking, nothing waiting for a consent banner."
    >
      <Section title="Why there is no consent banner">
        <p>
          Code Venue sets no advertising, analytics, or marketing cookies — so
          there is nothing that requires a pre-consent choice. The only things
          stored are <strong>essential technical storage</strong>: items that
          deliver the exam service you asked for. A banner over that would be
          theatre.
        </p>
      </Section>
      <Section title="Storage inventory">
        <div className="cv-policy-tablewrap">
          <table className="cv-policy-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Class</th>
                <th>Purpose</th>
              </tr>
            </thead>
            <tbody>
              {STORAGE_DISCLOSURE.map((s) => (
                <tr key={s.name}>
                  <td>{s.name}</td>
                  <td>{s.kind}</td>
                  <td>{s.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title="Clearing it">
        <p>
          A signed-in examiner's session cookie clears on sign-out or via
          browser settings. A student's exam session clears via the
          &quot;Leave room&quot; button on the exam page after submitting, or
          by clearing site data. Clearing the exam session doesn't erase the
          exam record — the examiner's copy is governed by the{" "}
          <Link className="cv-link" to="/privacy">Privacy Notice</Link>.
        </p>
      </Section>
    </PolicyShell>
  );
}

// ---------------------------------------------------------------------------
// Data Rights — access / correction / erasure / withdrawal / grievance
// ---------------------------------------------------------------------------

type RequestKind = "access" | "correction" | "erasure" | "grievance";

const REQUEST_LABELS: { kind: RequestKind; title: string; blurb: string }[] = [
  { kind: "access", title: "Access my data", blurb: "Ask what data we hold about the identity you name, and get a copy of it." },
  { kind: "correction", title: "Correct my data", blurb: "Fix something that's wrong (e.g. your name or email)." },
  { kind: "erasure", title: "Erase my data", blurb: "Examiners: deletes every room you own (with all student data), then your account. This cannot be undone." },
  { kind: "grievance", title: "Raise a grievance", blurb: "Something about our data handling isn't right. We respond within the contact window." },
];

function DataRightsInner() {
  const { isLoading, isAuthenticated } = useAuth();
  const fileRequest = useMutation(api.privacy.filePrivacyRequest);
  const withdrawConsent = useMutation(api.privacy.withdrawExaminerConsent);
  const [kind, setKind] = useState<RequestKind>("access");
  const [subjectType, setSubjectType] = useState<"examiner" | "student">("examiner");
  const [studentKey, setStudentKey] = useState("");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  if (isLoading) {
    return <div className="cv-empty">Loading…</div>;
  }

  if (!isAuthenticated) {
    return (
      <div className="cv-card cv-policy-card">
        <p className="cv-modal-sub">
          Sign in as an examiner to file and track requests for your account,
          or for a student's exam data you're responsible for.
        </p>
        <Link to="/auth?returnTo=%2Fdata-rights" className="cv-btn cv-btn-primary cv-btn-block">
          Examiner Sign In
        </Link>
        <p className="cv-policy-note">
          Students: you don't have an account here by design — your exam data
          is held under your examiner's account. Email{" "}
          <a className="cv-link" href={`mailto:${PRIVACY_CONTACT.email}`}>{PRIVACY_CONTACT.email}</a>{" "}
          or use the grievance route via your examiner; the examiner can
          delete your exam room (and everything in it) directly.
        </p>
      </div>
    );
  }

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setState("sending");
    setError(null);
    try {
      await fileRequest({
        kind,
        subjectType,
        subjectKey: subjectType === "examiner" ? "self" : studentKey.trim(),
        message: message.trim() || undefined,
      });
      setState("done");
    } catch (err) {
      setError(getErrorMessage(err, "Could not file the request. Please try again."));
      setState("idle");
    }
  };

  const selected = REQUEST_LABELS.find((r) => r.kind === kind)!;

  return (
    <>
      <div className="cv-card cv-policy-card">
        <h3 className="cv-policy-h3">File a request</h3>
        {state === "done" ? (
          <div className="cv-policy-done">
            <ShieldCheck size={18} />
            <p>
              Request recorded. You'll hear back at your account email within{" "}
              {PRIVACY_CONTACT.responseAim}.
            </p>
            <button className="cv-btn cv-btn-secondary cv-btn-sm" onClick={() => setState("idle")}>
              File another
            </button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="cv-field">
              <span className="cv-label">What are you asking for?</span>
              <div className="cv-policy-choices" role="radiogroup" aria-label="Request type">
                {REQUEST_LABELS.map((r) => (
                  <label key={r.kind} className={"cv-policy-choice" + (kind === r.kind ? " on" : "")}>
                    <input
                      type="radio"
                      name="kind"
                      checked={kind === r.kind}
                      onChange={() => setKind(r.kind)}
                    />
                    <span>
                      <strong>{r.title}</strong>
                      <em>{r.blurb}</em>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="cv-field">
              <span className="cv-label">About whose data?</span>
              <div className="cv-policy-choices" role="radiogroup" aria-label="Subject">
                <label className={"cv-policy-choice" + (subjectType === "examiner" ? " on" : "")}>
                  <input
                    type="radio"
                    name="subject"
                    checked={subjectType === "examiner"}
                    onChange={() => setSubjectType("examiner")}
                  />
                  <span><strong>My examiner account</strong></span>
                </label>
                <label className={"cv-policy-choice" + (subjectType === "student" ? " on" : "")}>
                  <input
                    type="radio"
                    name="subject"
                    checked={subjectType === "student"}
                    onChange={() => setSubjectType("student")}
                  />
                  <span>
                    <strong>A student's exam data</strong>
                    <em>Use the student's exam ID (S-XXXXXX) or institutional ID.</em>
                  </span>
                </label>
              </div>
              {subjectType === "student" && (
                <input
                  className="cv-input"
                  style={{ marginTop: 8 }}
                  value={studentKey}
                  onChange={(e) => setStudentKey(e.target.value.toUpperCase())}
                  placeholder="S-7F3K2Q or 24BCA10210"
                  maxLength={24}
                />
              )}
            </div>

            <div className="cv-field">
              <label className="cv-label" htmlFor="rights-message">
                Details <span>· optional</span>
              </label>
              <textarea
                id="rights-message"
                className="cv-textarea"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={2000}
                placeholder={selected.blurb}
              />
            </div>

            {error && <span className="cv-error">{error}</span>}
            <button className="cv-btn cv-btn-primary cv-btn-block" disabled={state === "sending"}>
              {state === "sending" ? (
                <><Loader2 size={15} className="animate-spin" /> Filing…</>
              ) : (
                `Submit ${selected.title.toLowerCase()} request`
              )}
            </button>
            {kind === "erasure" && (
              <p className="cv-policy-note">
                Erasure of your examiner account permanently deletes every
                exam room you own — submissions, student identities, and
                monitoring events included. The platform does this the moment
                the request is processed.
              </p>
            )}
          </form>
        )}
      </div>

      <div className="cv-card cv-policy-card">
        <h3 className="cv-policy-h3">Withdraw consent</h3>
        <p className="cv-modal-sub">
          Withdraws your examiner privacy-consent record (a withdrawal event is
          recorded). This doesn't delete your account — use erasure above for
          that — but it ends consent-based processing going forward.
        </p>
        <button
          className="cv-btn cv-btn-secondary"
          onClick={() => void withdrawConsent().catch(() => {})}
        >
          Withdraw my consent
        </button>
      </div>
    </>
  );
}

export function DataRights() {
  useEffect(() => {
    document.title = "Data Rights & Privacy Requests — Code Venue";
  }, []);
  return (
    <PolicyShell
      title="Data Rights & Privacy Requests"
      lede="Access, correction, erasure, consent withdrawal, and grievances — filed in the app, answered from the privacy contact."
    >
      <DataRightsInner />
      <div className="cv-card cv-policy-card">
        <h3 className="cv-policy-h3">Contact</h3>
        <p className="cv-modal-sub" style={{ marginBottom: 0 }}>
          {PRIVACY_CONTACT.role} ·{" "}
          <a className="cv-link" href={`mailto:${PRIVACY_CONTACT.email}`}>{PRIVACY_CONTACT.email}</a>{" "}
          · responses {PRIVACY_CONTACT.responseAim}.
        </p>
      </div>
    </PolicyShell>
  );
}

// ---------------------------------------------------------------------------
// Grievance / Contact
// ---------------------------------------------------------------------------

export function Grievance() {
  useEffect(() => {
    document.title = "Privacy Contact & Grievance — Code Venue";
  }, []);
  return (
    <PolicyShell
      title="Privacy Contact & Grievance"
      lede="One route for every privacy question, concern, or complaint — with an expected handling window."
    >
      <div className="cv-card cv-policy-card">
        <p className="cv-modal-sub">
          <strong>{PRIVACY_CONTACT.role}</strong>
          <br />
          <a className="cv-link" href={`mailto:${PRIVACY_CONTACT.email}`}>{PRIVACY_CONTACT.email}</a>
        </p>
        <p className="cv-modal-sub">
          We aim to acknowledge every grievance within 48 hours and resolve it{" "}
          {PRIVACY_CONTACT.responseAim}. Include your exam ID (students) or
          account email (examiners) so we can find the right records.
        </p>
        <p className="cv-policy-note">
          Code Venue has not appointed a Data Protection Officer (none is
          currently required for this product); the designated privacy contact
          above handles grievances. Before writing to us, students may prefer
          to contact their examiner directly — examiners can resolve most
          things (including deleting an exam room with all its data)
          immediately from their dashboard.
        </p>
        <Link to="/data-rights" className="cv-btn cv-btn-primary">
          File a formal request instead
        </Link>
      </div>
    </PolicyShell>
  );
}

// ---------------------------------------------------------------------------
// Footer — linked from every policy page (and reusable elsewhere).
// ---------------------------------------------------------------------------

export function VenueFooter() {
  return (
    <footer className="cv-footer cv-footer-rich">
      <nav className="cv-footer-nav" aria-label="Legal and privacy">
        <Link to="/privacy">Privacy Notice</Link>
        <Link to="/terms">Terms of Service</Link>
        <Link to="/cookies">Cookie &amp; Storage Policy</Link>
        <Link to="/data-rights">Data Rights</Link>
        <Link to="/grievance">Grievance / Contact</Link>
      </nav>
      <p className="cv-footer-fine">
        Policy version {POLICY_VERSIONS.privacy} · effective{" "}
        {format(new Date(POLICY_EFFECTIVE_DATE), "MMMM d, yyyy")} · Code Venue
        — where live coding exams happen.
      </p>
    </footer>
  );
}
