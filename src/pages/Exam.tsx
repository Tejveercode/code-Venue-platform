import { api } from "@/convex/_generated/api";
import {
  ClosedPill,
  CodeVenuePage,
  LivePill,
  Modal,
  QuestionBox,
  VenueHeader,
} from "@/components/venue/ui";
import { format } from "date-fns";
import { Loader2, Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link, useParams } from "react-router";
import { getStudentIdentity, setStudentIdentity } from "./StudentPortal";

function fmtClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function ExamLoading() {
  return (
    <CodeVenuePage>
      <div className="cv-center">
        <Loader2 className="animate-spin" style={{ color: "var(--accent-caramel)" }} />
      </div>
    </CodeVenuePage>
  );
}

export default function Exam() {
  const params = useParams<{ code: string }>();
  const code = decodeURIComponent(params.code ?? "").toUpperCase();

  // Durable identity: a random token minted by the server at join time and
  // stored locally, scoped per room code. Never identify by name.
  const [clientId, setClientId] = useState<string | null>(
    () => getStudentIdentity(code).clientId,
  );

  const roomState = useQuery(api.exams.getExamRoomState, code ? { code } : "skip");
  const mySub = useQuery(
    api.exams.getMySubmission,
    clientId ? { clientId } : "skip",
  ) as
    | {
        studentName: string;
        submission: {
          code: string;
          isFinal: boolean;
          submittedAt: number | null;
        } | null;
      }
    | null
    | undefined;

  const save = useMutation(api.exams.saveSubmission);
  const join = useMutation(api.exams.joinRoom);

  // Editor state
  const [codeValue, setCodeValue] = useState("");
  const codeRef = useRef("");
  const [initialized, setInitialized] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lateFlag, setLateFlag] = useState(false);
  const autoRef = useRef(false);
  const lockedRef = useRef(false);

  // Rejoin flow state
  const [rejoinName, setRejoinName] = useState("");
  const [rejoinError, setRejoinError] = useState<string | null>(null);
  const [rejoining, setRejoining] = useState(false);

  // 500ms ticker drives the countdown from the server-anchored basis:
  // remaining = durationMinutes*60 - (now - startedAt)
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    document.title = roomState?.name ? `${roomState.name} — Code Venue` : "Exam — Code Venue";
  }, [roomState?.name]);

  // Restore the autosaved draft exactly once, from the DB — not the tab.
  useEffect(() => {
    if (mySub !== undefined && !initialized) {
      const restored = mySub?.submission?.code ?? "";
      setCodeValue(restored);
      codeRef.current = restored;
      setInitialized(true);
    }
  }, [mySub, initialized]);

  const isFinal = mySub?.submission?.isFinal ?? false;
  const roomClosed = roomState?.status === "CLOSED";
  const locked = isFinal || roomClosed;
  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);

  const remainingMs = roomState
    ? Math.max(0, roomState.durationMinutes * 60_000 - (now - roomState.startedAt))
    : 0;
  const timeUp = roomState ? remainingMs <= 0 : false;

  const doSave = async () => {
    if (!clientId || lockedRef.current) return;
    setSaving(true);
    try {
      const res: { error?: string; locked?: boolean } = await save({
        clientId,
        code: codeRef.current,
        isFinal: false,
      });
      if (res.locked) return;
      setSavedAt(Date.now());
      setDirty(false);
    } catch {
      // transient failure — the next keystroke reschedules the save
    } finally {
      setSaving(false);
    }
  };

  const doSubmit = async () => {
    if (!clientId) return;
    setSubmitting(true);
    try {
      const res: { error?: string; late?: boolean } = await save({
        clientId,
        code: codeRef.current,
        isFinal: true,
      });
      if (res.error) {
        autoRef.current = false; // allow the auto-submit effect to retry
        return;
      }
      setLateFlag(res.late === true);
      setConfirming(false);
      setDirty(false);
      setSavedAt(Date.now());
    } catch {
      autoRef.current = false; // allow the auto-submit effect to retry
      // keep the editor unlocked so the student can retry the submit
    } finally {
      setSubmitting(false);
    }
  };

  // Debounced autosave while typing.
  useEffect(() => {
    if (locked || !dirty || !clientId) return;
    const t = setTimeout(() => void doSave(), 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeValue, dirty, locked, clientId]);

  // Auto-submit on timer expiry or when the examiner ends the room — never
  // leave the student's work in an ambiguous state.
  useEffect(() => {
    if (!roomState || !clientId || locked) return;
    if ((roomClosed || timeUp) && !autoRef.current) {
      autoRef.current = true;
      void doSubmit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomState, roomClosed, timeUp, locked, clientId, codeValue]);

  // Leave-warning while the exam is active (standard browser dialog).
  useEffect(() => {
    if (locked) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [locked]);

  // Escape exits fullscreen.
  useEffect(() => {
    if (!fullscreen) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [fullscreen]);

  // --- Early states (all hooks above) -------------------------------------

  if (roomState === undefined || (mySub === undefined && clientId !== null)) {
    return <ExamLoading />;
  }

  if (roomState === null) {
    return (
      <CodeVenuePage>
        <div className="cv-shell">
          <VenueHeader />
          <div className="cv-center">
            <div className="cv-card cv-auth-card">
              <h1 className="cv-auth-title">Room not found</h1>
              <span className="cv-error">
                {`No room found with code "${code}". Double-check it with your examiner.`}
              </span>
              <Link to="/student-portal" className="cv-btn cv-btn-primary cv-btn-block">
                Back to join page
              </Link>
            </div>
          </div>
        </div>
      </CodeVenuePage>
    );
  }

  const studentMissing =
    mySub === null || (mySub === undefined && clientId === null);

  if (studentMissing && roomState.status === "CLOSED") {
    return (
      <CodeVenuePage>
        <div className="cv-shell">
          <VenueHeader />
          <div className="cv-center">
            <div className="cv-card cv-auth-card">
              <h1 className="cv-auth-title">
                {roomState.name} <ClosedPill />
              </h1>
              <span className="cv-error">
                {`"${roomState.name}" has already ended and is no longer accepting students.`}
              </span>
              <Link to="/student-portal" className="cv-btn cv-btn-primary cv-btn-block">
                Back to join page
              </Link>
            </div>
          </div>
        </div>
      </CodeVenuePage>
    );
  }

  if (studentMissing) {
    return (
      <CodeVenuePage>
        <div className="cv-shell">
          <VenueHeader />
          <div className="cv-center">
            <div className="cv-card cv-auth-card">
              <h1 className="cv-auth-title">Rejoin exam</h1>
              <p className="cv-auth-sub">
                This browser isn't linked to "{roomState.name}" yet. Enter your
                name to continue the exam.
              </p>
              {rejoinError && <span className="cv-error">{rejoinError}</span>}
              <form onSubmit={handleRejoin}>
                <div className="cv-field">
                  <label className="cv-label" htmlFor="rejoin-name">
                    Your Name
                  </label>
                  <input
                    id="rejoin-name"
                    className="cv-input"
                    value={rejoinName}
                    onChange={(e) => setRejoinName(e.target.value)}
                    placeholder="Your name"
                    autoComplete="name"
                    disabled={rejoining}
                  />
                </div>
                <button
                  type="submit"
                  className="cv-btn cv-btn-primary cv-btn-block"
                  disabled={rejoining}
                >
                  {rejoining ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> Rejoining…
                    </>
                  ) : (
                    "Rejoin Exam"
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>
      </CodeVenuePage>
    );
  }

  // --- Main exam UI --------------------------------------------------------

  const savedLabel = isFinal
    ? "Submitted"
    : saving
      ? "Saving…"
      : savedAt
        ? now - savedAt < 15_000
          ? "Saved just now"
          : `Saved ${format(savedAt, "HH:mm")}`
        : "Not saved yet";

  return (
    <CodeVenuePage>
      <div className="cv-shell">
        <VenueHeader />
        <main className="cv-exam-wrap">
          <div className="cv-exam-head">
            <div className="cv-exam-title">
              <h1>{roomState.name}</h1>
              {roomClosed ? <ClosedPill /> : <LivePill />}
            </div>
            <div
              className={"cv-timer" + (remainingMs < 5 * 60_000 && !locked ? " low" : "")}
            >
              {fmtClock(remainingMs)}
            </div>
          </div>

          {isFinal ? (
            <>
              <div className="cv-banner cv-banner-success">
                Submitted — you may close this tab.
              </div>
              {lateFlag && (
                <div className="cv-banner cv-banner-warn">
                  Your submission was recorded after the time limit and flagged
                  as late for your examiner.
                </div>
              )}
            </>
          ) : roomClosed ? (
            <div className="cv-banner cv-banner-warn">
              This exam has ended. Your editor is locked.
            </div>
          ) : null}

          <QuestionBox prompt={roomState.prompt} />

          <div
            className={
              "cv-card cv-editor-card" + (fullscreen ? " cv-editor-fullscreen" : "")
            }
          >
            <div className="cv-editor-head">
              <span className="cv-save-state">{savedLabel}</span>
              <div className="cv-action-row">
                {locked ? (
                  <span className="cv-save-state">Read-only</span>
                ) : (
                  <button
                    className="cv-btn cv-btn-secondary cv-btn-sm"
                    onClick={() => setFullscreen((f) => !f)}
                  >
                    {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                    {fullscreen ? "Exit Fullscreen" : "Fullscreen"}
                  </button>
                )}
                {!locked && (
                  <button
                    className="cv-btn cv-btn-primary cv-btn-sm"
                    onClick={() => setConfirming(true)}
                    disabled={submitting}
                  >
                    Submit Code
                  </button>
                )}
              </div>
            </div>
            <textarea
              className="cv-editor"
              value={codeValue}
              readOnly={locked}
              onChange={(e) => {
                setCodeValue(e.target.value);
                codeRef.current = e.target.value;
                setDirty(true);
              }}
              onBlur={() => {
                if (dirty) void doSave();
              }}
              spellCheck={false}
              placeholder="// Write your solution here — your code autosaves as you type"
              aria-label="Code editor"
            />
          </div>
        </main>
      </div>

      <Modal
        open={confirming}
        onClose={() => {
          if (!submitting) setConfirming(false);
        }}
        title="Submit your code?"
        subtitle="Your current code will be recorded as your final submission. You won't be able to edit it afterwards."
        footer={
          <>
            <button
              className="cv-btn cv-btn-secondary"
              onClick={() => setConfirming(false)}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              className="cv-btn cv-btn-primary"
              onClick={() => void doSubmit()}
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <Loader2 size={15} className="animate-spin" /> Submitting…
                </>
              ) : (
                "Submit Code"
              )}
            </button>
          </>
        }
      >
        <p className="cv-modal-sub" style={{ marginBottom: 0 }}>
          Time remaining: {fmtClock(remainingMs)}
        </p>
      </Modal>
    </CodeVenuePage>
  );

  // --- Rejoin handler (declared after render for readability; stable) ------

  async function handleRejoin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = rejoinName.trim();
    if (!name) {
      setRejoinError("Please enter your name.");
      return;
    }
    setRejoining(true);
    setRejoinError(null);
    try {
      const res: { error?: string; clientId?: string } = await join({ code, name });
      if (res.error) {
        setRejoinError(res.error);
        return;
      }
      if (res.clientId) {
        setStudentIdentity(code, res.clientId, name);
        setClientId(res.clientId);
      }
    } catch {
      setRejoinError("Could not rejoin. Please try again.");
    } finally {
      setRejoining(false);
    }
  }
}
