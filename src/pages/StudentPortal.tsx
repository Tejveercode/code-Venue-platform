import { api } from "@/convex/_generated/api";
import { CodeVenuePage, VenueHeader } from "@/components/venue/ui";
import { Loader2, GraduationCap } from "lucide-react";
import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { useNavigate } from "react-router";

export function getStudentIdentity(roomCode: string): {
  clientId: string | null;
  name: string | null;
  uid: string | null;
} {
  try {
    const key = roomCode.trim().toUpperCase();
    return {
      clientId: localStorage.getItem(`cv:clientId:${key}`),
      name: localStorage.getItem(`cv:name:${key}`),
      uid: localStorage.getItem(`cv:uid:${key}`),
    };
  } catch {
    return { clientId: null, name: null, uid: null };
  }
}

export function setStudentIdentity(
  roomCode: string,
  clientId: string,
  name: string,
  uid: string,
) {
  try {
    const key = roomCode.trim().toUpperCase();
    localStorage.setItem(`cv:clientId:${key}`, clientId);
    localStorage.setItem(`cv:name:${key}`, name);
    localStorage.setItem(`cv:uid:${key}`, uid);
  } catch {
    // storage unavailable — session-only identity
  }
}

/** Store just the UID (the exam page calls this once the server confirms it). */
export function persistStudentUid(roomCode: string, uid: string) {
  try {
    localStorage.setItem(`cv:uid:${roomCode.trim().toUpperCase()}`, uid);
  } catch {
    // storage unavailable — the UID still shows live on the exam screen
  }
}

export default function StudentPortal() {
  const navigate = useNavigate();
  const lookup = useMutation(api.exams.joinRoom);

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
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
      const { clientId } = getStudentIdentity(trimmedCode);
      const result = await lookup({
        code: trimmedCode,
        name: trimmedName,
        existingClientId: clientId ?? undefined,
      });
      if (typeof result.clientId !== "string") {
        setError(result.error ?? "Could not join the room.");
        return;
      }
      setStudentIdentity(trimmedCode, result.clientId, trimmedName, result.studentUid);
      navigate(`/exam/${encodeURIComponent(trimmedCode)}`);
    } catch {
      setError("Could not join the room. Please try again.");
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
              <button
                type="submit"
                className="cv-btn cv-btn-primary cv-btn-block"
                disabled={joining}
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

            <p className="cv-form-footer">
              No account needed — your exam identity is tied to this browser.
              You'll receive a unique ID (e.g. <strong>S-7F3K2Q</strong>) after
              joining; use it to identify your submission file.
            </p>
          </div>
        </div>
      </div>
    </CodeVenuePage>
  );
}
