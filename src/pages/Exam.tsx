import { api } from "@/convex/_generated/api";
import { CodeEditor } from "@/components/venue/CodeEditor";
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
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link, useParams } from "react-router";
import type { ViolationType } from "@/lib/violationEvents";
import {
  getStudentIdentity,
  persistStudentUid,
  setStudentIdentity,
} from "./StudentPortal";
import { getErrorMessage } from "@/lib/errors";

function fmtClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Self-ticking countdown. Isolates the 1s re-render to this small component
 * (with a tabular-num span) instead of re-rendering the whole Exam page twice
 * per second. Stops when the tab is hidden; recomputes on visibility return.
 * Computes its own `low` (<5 min) state per tick, so the parent never needs
 * a live remaining-time value.
 */
const Timer = memo(function Timer({
  endsAt,
  onExpire,
}: {
  endsAt: number;
  onExpire?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;

  const remaining = Math.max(0, endsAt - now);
  const expired = remaining <= 0;
  const low = remaining < 5 * 60_000;

  useEffect(() => {
    if (expired) return;
    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (interval === null) {
        setNow(Date.now());
        interval = setInterval(() => setNow(Date.now()), 1000);
      }
    };
    const stop = () => {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [expired]);

  useEffect(() => {
    if (expired) expireRef.current?.();
  }, [expired]);

  return (
    <div className={"cv-timer" + (low && !expired ? " low" : "")}>
      {fmtClock(remaining)}
    </div>
  );
});

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

  // Public, unique identifier shown to the student so they can identify
  // their file in the examiner's downloads. Prefers the student's own
  // institutional ID (e.g. 24BCA10210); falls back to the server-minted
  // UID (e.g. S-7F3K2Q) when no ID was entered.
  const [studentUid, setStudentUid] = useState<string | null>(null);

  // Capability-gated state (see getExamRoomState): the prompt/timer/count
  // fields unlock only because we present this browser's join token; without
  // it the query returns a safe subset (registered: false).
  const roomState = useQuery(
    api.exams.getExamRoomState,
    code ? { code, clientId: clientId ?? undefined } : "skip",
  );
  const mySub = useQuery(
    api.exams.getMySubmission,
    clientId ? { clientId } : "skip",
  ) as
    | {
        studentName: string;
        studentUid: string;
        regNo: string | null;
        autoSubmittedAt: number | null;
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
  const logEvent = useMutation(api.exams.logViolationEvent);
  const logRejoin = useMutation(api.exams.logRejoinEvent);

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
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lateFlag, setLateFlag] = useState(false);
  const autoRef = useRef(false);
  const lockedRef = useRef(false);

  // Rejoin flow state
  const [rejoinName, setRejoinName] = useState("");
  const [rejoinError, setRejoinError] = useState<string | null>(null);
  const [rejoining, setRejoining] = useState(false);

  // Exam-session monitoring. The client only REPORTS events as they happen
  // (one mutation per occurrence); the server tallies and enforces. All we
  // render here is what the server tells us back.
  const [warning, setWarning] = useState<string | null>(null);
  const [autoSubmitted, setAutoSubmitted] = useState(false);

  useEffect(() => {
    document.title = roomState?.name ? `${roomState.name} — Code Venue` : "Exam — Code Venue";
  }, [roomState?.name]);

  // Adopt the identifier (own ID if entered, else the minted UID) once the
  // submission query provides it.
  useEffect(() => {
    if (mySub?.studentUid) {
      setStudentUid(mySub.regNo ?? mySub.studentUid);
      if (clientId) persistStudentUid(code, mySub.studentUid);
    }
  }, [mySub?.studentUid, mySub?.regNo, clientId, code]);

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
  // Server-set when the violation limit was exceeded — keeps the explanation
  // visible across reloads, not only in the session where enforcement ran.
  const serverAutoSubmitted = mySub?.autoSubmittedAt != null;
  const roomClosed = roomState?.status === "CLOSED";
  const locked = isFinal || roomClosed;
  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);

  const endsAt = roomState
    ? roomState.startedAt + roomState.durationMinutes * 60_000
    : 0;

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
        setSubmitError(res.error);
        return;
      }
      setSubmitError(null);
      setLateFlag(res.late === true);
      setConfirming(false);
      setDirty(false);
      setSavedAt(Date.now());
    } catch (err) {
      autoRef.current = false; // allow the auto-submit effect to retry
      // Rate limits / validation arrive as ConvexError with safe messages;
      // anything internal becomes generic. Never a raw stack trace.
      setSubmitError(
        getErrorMessage(err, "Something went wrong. Please try again."),
      );
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

  // Auto-submit when the examiner ends the room, or on timer expiry via the
  // Timer's onExpire callback (a single timeout instead of a 500ms polling
  // loop re-rendering the whole page).
  useEffect(() => {
    if (!roomState || !clientId || locked) return;
    if (roomClosed && !autoRef.current) {
      autoRef.current = true;
      void doSubmit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomState, roomClosed, locked, clientId]);

  const handleTimerExpire = useCallback(() => {
    if (!autoRef.current) {
      autoRef.current = true;
      void doSubmit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // --- Exam-session monitoring (client REPORTS, server DECIDES) ------------

  const reportRef = useRef(logEvent);
  reportRef.current = logEvent;

  const reportEvent = useCallback(
    (type: ViolationType) => {
      if (!clientId || lockedRef.current) return;
      void reportRef
        .current({
          clientId,
          type,
          currentCode: codeRef.current,
        })
        .then(
          (res: {
            warningsLeft?: number | null;
            limit?: number;
            overLimit?: boolean;
            error?: string;
            dropped?: boolean;
          }) => {
            if (res.error || res.dropped) return;
            if (res.overLimit) {
              // The server auto-submitted this exam and locked the editor.
              // mySub flips to isFinal: true reactively; add the reason.
              setAutoSubmitted(true);
              setWarning(null);
              return;
            }
            if (
              typeof res.warningsLeft === "number" &&
              typeof res.limit === "number" &&
              res.limit > 0
            ) {
              const label =
                type === "blur"
                  ? "Tab switch detected"
                  : type === "paste"
                    ? "Paste detected"
                    : "Copy detected";
              const used = res.limit - res.warningsLeft;
              setWarning(
                `${label} — ${used} of ${res.limit} warnings before your exam is auto-submitted.`,
              );
            }
          },
        )
        .catch(() => {
          // Transient failure to report an event: never block the exam.
        });
    },
    [clientId],
  );

  // Tab-switch / window-blur count.
  useEffect(() => {
    if (!clientId || locked) return;
    const onBlur = () => reportEvent("blur");
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [clientId, locked, reportEvent]);

  // Rejoin count: one event per exam-page load for this clientId (including
  // the very first join). Fire-and-forget — failures never block the exam.
  const rejoinLoggedRef = useRef(false);
  useEffect(() => {
    if (!clientId || rejoinLoggedRef.current) return;
    rejoinLoggedRef.current = true;
    void logRejoin({ clientId }).catch(() => {});
  }, [clientId, logRejoin]);

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
                {code} <ClosedPill />
              </h1>
              <span className="cv-error">
                {`This exam (code ${code}) has already ended and is no longer accepting students.`}
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
                This browser isn't linked to this exam yet. Enter your name to
                continue.
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

  // Computed per render — parent re-renders on keystrokes/saves, which is
  // exactly when this label can change. The ticking lives in <Timer/>.
  const savedLabel = isFinal
    ? "Submitted"
    : saving
      ? "Saving…"
      : savedAt
        ? Date.now() - savedAt < 15_000
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
              {studentUid && (
                <span
                  className="cv-pill cv-pill-code"
                  title="Your ID — your examiner's downloaded file is named with it"
                >
                  ID: {studentUid}
                </span>
              )}
            </div>
            {!locked && <Timer endsAt={endsAt} onExpire={handleTimerExpire} />}
            {locked && <div className="cv-timer">00:00</div>}
          </div>

          {isFinal ? (
            <>
              <div className="cv-banner cv-banner-success">
                Submitted — you may close this tab.
              </div>
              {lateFlag && (
                <div className="cv-banner cv-banner-warn" role="alert">
                  Your submission was recorded after the time limit and flagged
                  as late for your examiner.
                </div>
              )}
            </>
          ) : roomClosed ? (
            <div className="cv-banner cv-banner-warn" role="alert">
              This exam has ended. Your editor is locked.
            </div>
          ) : null}

          {submitError && !confirming && (
            <div className="cv-banner cv-banner-warn" role="alert">
              {submitError}
            </div>
          )}

          {warning && !locked && (
            <div className="cv-banner cv-banner-warn" role="alert">
              {warning}
            </div>
          )}

          {(autoSubmitted || serverAutoSubmitted) && (
            <div className="cv-banner cv-banner-danger" role="alert">
              Your exam was auto-submitted because you exceeded the violation
              limit set by your examiner. Your current code has been recorded as
              your final submission.
            </div>
          )}

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
            <CodeEditor
              value={codeValue}
              readOnly={locked}
              languageHint={`${roomState.name} ${roomState.prompt}`}
              onChange={(next) => {
                setCodeValue(next);
                codeRef.current = next;
                setDirty(true);
              }}
              onBlur={() => {
                if (dirty) void doSave();
              }}
              onPaste={() => {
                // Detection-only: the paste proceeds normally. We report the
                // EVENT (type + count) — never the clipboard content, which
                // is deliberately never read or transmitted.
                reportEvent("paste");
              }}
              onCopy={() => {
                reportEvent("copy");
              }}
              placeholder="// Write your solution here — your code autosaves as you type"
              ariaLabel="Code editor"
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
          Time remaining: {fmtClock(Math.max(0, endsAt - Date.now()))}
        </p>
        {submitError && (
          <span className="cv-error" style={{ marginTop: 12, display: "block" }}>
            {submitError}
          </span>
        )}
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
      const { regNo: savedRegNo } = getStudentIdentity(code);
      const res: {
        error?: string;
        clientId?: string;
        studentUid?: string;
        regNo?: string | null;
      } = await join({ code, name, regNo: savedRegNo ?? undefined });
      if (res.error) {
        setRejoinError(res.error);
        return;
      }
      if (res.clientId) {
        const uid = res.regNo ?? res.studentUid ?? "";
        setStudentIdentity(code, res.clientId, name, res.studentUid ?? "", res.regNo ?? savedRegNo ?? "");
        setStudentUid(uid || null);
        setClientId(res.clientId);
      }
      setRejoinError(null);
    } catch (err) {
      // ConvexError messages (rate limits, validation) are safe to show.
      setRejoinError(getErrorMessage(err, "Could not rejoin. Please try again."));
    } finally {
      setRejoining(false);
    }
  }
}
