import { api } from "@/convex/_generated/api";
import { CodeVenuePage, VenueHeader } from "@/components/venue/ui";
import { Loader2, GraduationCap, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { useNavigate } from "react-router";
import { getErrorMessage } from "@/lib/errors";
import { POLICY_VERSIONS } from "@/lib/policy";
import {
  getBrowserId,
  getStudentIdentity,
  setStudentIdentity,
} from "@/lib/studentIdentity";

// Re-exports kept so the exam page's existing imports keep working.
export { getStudentIdentity, setStudentIdentity } from "@/lib/studentIdentity";

export default function StudentPortal() {
  const navigate = useNavigate();
  const lookup = useMutation(api.exams.joinRoom);
  const recordConsent = useMutation(api.privacy.recordStudentConsent);

  const [name, setName] = useState("");
  const [regNo, setRegNo] = useState("");
  const [code, setCode] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    document.title = "Join an Exam — Code Venue";
  }, []);

  const handleJoin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const trimmedName = name.trim();
    const trimmedCode = code.trim().toUpperCase();
    if (!trimmedName) return setError("Please enter your name.");
    if (!trimmedCode) return setError("Please enter the room code from your examiner.");

    setJoining(true);
    try {
      const remembered = getStudentIdentity(trimmedCode);
      const typedRegNo = (regNo.trim() || undefined)?.toUpperCase();
      const result = await lookup({
        code: trimmedCode,
        name: trimmedName,
        regNo: typedRegNo,
        existingClientId: remembered?.clientId ?? undefined,
        // Opaque browser-session id: the SERVER uses it to decide whether
        // this join resumes the remembered attempt or describes a new one.
        // It is not a permission and never identifies the person.
        browserId: getBrowserId(),
      });
      if (typeof result.clientId !== "string") {
        setError(result.error ?? "Could not join the room.");
        return;
      }

      // The server's authoritative answer is stored verbatim — including
      // the S-UID for THIS attempt, so the exam page shows the identity the
      // server assigned, never one remembered from another attempt.
      setStudentIdentity(
        trimmedCode,
        result.clientId,
        trimmedName,
        result.studentUid,
        result.regNo ?? "",
      );

      // Consent is recorded AFTER the attempt resolves (its key is this
      // attempt's public S-UID) and only for the checkbox the person
      // actually ticked. The server refuses to record without explicit=true.
      if (agreed) {
        try {
          await recordConsent({
            studentUid: result.studentUid,
            explicit: true,
            termsVersion: POLICY_VERSIONS.terms,
            privacyVersion: POLICY_VERSIONS.privacy,
          });
        } catch {
          // Never block an exam over a consent-record failure; the notice
          // remains visible on this page either way.
        }
      }

      navigate(`/exam/${encodeURIComponent(trimmedCode)}`);
    } catch (err) {
      // ConvexError messages (rate limits, validation) are safe to show;
      // anything internal becomes generic.
      setError(getErrorMessage(err, "Could not join the room. Please try again."));
    } finally {
      setJoining(false);
    }
  };

  return (
    <CodeVenuePage>
      <div className="cv-shell">
        <VenueHeader />
        <div className="cv-center">
          <div className="cv-card cv-auth-card">
            <div style={{ display: "flex", justifyContent: "center" }}>
              <div className="cv-role-icon">
                <GraduationCap size={22} />
              </div>
            </div>
            <h1 className="cv-auth-title">Join an exam</h1>
            <p className="cv-auth-sub">
              Enter your name and the room code your examiner shared with you.
            </p>

            {error && <span className="cv-error">{error}</span>}

            <form onSubmit={handleJoin}>
              <div className="cv-field">
                <label className="cv-label" htmlFor="student-name">
                  Your Name
                </label>
                <input
                  id="student-name"
                  className="cv-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Jordan Lee"
                  autoComplete="name"
                  disabled={joining}
                />
              </div>
              <div className="cv-field">
                <label className="cv-label" htmlFor="student-regno">
                  Student ID <span>· optional</span>
                </label>
                <input
                  id="student-regno"
                  className="cv-input"
                  value={regNo}
                  onChange={(e) => setRegNo(e.target.value.toUpperCase())}
                  placeholder="e.g. 24BCA10210"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={joining}
                />
              </div>
              <div className="cv-field">
                <label className="cv-label" htmlFor="student-code">
                  Room Code
                </label>
                <input
                  id="student-code"
                  className="cv-input"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="CV-0000"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={joining}
                />
              </div>

              {/* CONSENT (DPDP readiness): a single, unbundled, plain-language
                  choice with an easy decline path — declining only means the
                  join doesn't proceed. Terms acceptance and the privacy
                  acknowledgement are listed separately inside one required
                  acknowledgement (neither is optional for running an exam,
                  so a fake "optional" split would be the darker pattern).
                  Recorded server-side with the policy version shown here. */}
              <div className="cv-consent">
                <div className="cv-consent-row">
                  <input
                    id="student-consent"
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                    disabled={joining}
                  />
                  <label htmlFor="student-consent">
                    I accept the{" "}
                    <a href="/terms" target="_blank" rel="noreferrer">Terms</a>
                    {" "}and understand how my exam data is handled in the{" "}
                    <a href="/privacy" target="_blank" rel="noreferrer">Privacy Notice</a>{" "}
                    (name, ID, code and monitoring events are visible to my
                    examiner; deleted with the exam room).
                  </label>
                </div>
                <p className="cv-consent-hint">
                  <ShieldCheck size={12} /> You'll get a unique exam ID (e.g.
                  S-7F3K2Q) right after joining.
                </p>
              </div>

              <button
                type="submit"
                className="cv-btn cv-btn-primary cv-btn-block"
                disabled={joining || !agreed}
              >
                {joining ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Joining…
                  </>
                ) : (
                  "Join Exam"
                )}
              </button>
            </form>

            {/* Three scannable steps instead of a run-on paragraph. */}
            <div className="cv-join-guide" aria-label="How joining works">
              <p>
                <span className="cv-guide-num" aria-hidden="true">1</span>
                <span>No account needed — your exam identity stays in this browser.</span>
              </p>
              <p>
                <span className="cv-guide-num" aria-hidden="true">2</span>
                <span>You'll get a unique ID right after joining (e.g. <strong>S-7F3K2Q</strong>).</span>
              </p>
              <p>
                <span className="cv-guide-num" aria-hidden="true">3</span>
                <span>Your examiner can download your work, named with your ID.</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </CodeVenuePage>
  );
}
