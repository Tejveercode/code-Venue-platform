import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import {
  ClosedPill,
  CodePill,
  CodeVenuePage,
  LivePill,
  Modal,
  QuestionBox,
  VenueHeader,
} from "@/components/venue/ui";
import { MonitoringPanel } from "@/components/examiner/MonitoringPanel";
import { RoomFormModal } from "@/components/examiner/RoomFormModal";
import { SubmissionsView } from "@/pages/Submissions";
import { format } from "date-fns";
import { ArrowLeft, Check, ChevronRight, Copy, Loader2, Pencil, Square, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link, useNavigate, useParams } from "react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { getErrorMessage } from "@/lib/errors";

type Room = Doc<"rooms">;

type Counts = {
  joined: number;
  submitted: number;
  flagged: number;
  autoSubmitted: number;
};

const EMPTY_COUNT: Counts = {
  joined: 0,
  submitted: 0,
  flagged: 0,
  autoSubmitted: 0,
};

type TabKey = "overview" | "monitoring" | "submissions" | "settings";

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "monitoring", label: "Monitoring" },
  { key: "submissions", label: "Submissions" },
  { key: "settings", label: "Settings" },
];

/**
 * One exam's deep-work surface — the room's information, separated by task:
 *
 *   Overview    — participation, completion, exam facts
 *   Monitoring  — the live subscription (ONLY while this tab is open)
 *   Submissions — the existing grading workflow (shared component, zero dup)
 *   Settings    — edit modal, end, delete (destructives confirmed)
 */
function ExaminerExamDetailInner() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();

  const typedRoomId = roomId as Id<"rooms"> | undefined;
  const room = useQuery(
    api.exams.getRoom,
    typedRoomId ? { roomId: typedRoomId } : "skip",
  ) as Room | null | undefined;
  const counts = useQuery(
    api.exams.getRoomCounts,
    typedRoomId ? { roomIds: [typedRoomId] } : "skip",
  ) as Record<string, Counts> | undefined;
  const listMyRooms = useQuery(api.exams.listMyRooms);

  const endRoomMutation = useMutation(api.exams.endRoom);
  const deleteRoomMutation = useMutation(api.exams.deleteRoom);

  const [tab, setTab] = useState<TabKey>("overview");
  const [codeCopied, setCodeCopied] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [ending, setEnding] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    document.title = room ? `${room.name} — Code Venue` : "Exam — Code Venue";
  }, [room]);

  const c = (typedRoomId && counts?.[typedRoomId]) || EMPTY_COUNT;
  const pct =
    room && room.enrolledLimit > 0
      ? Math.round((c.submitted / room.enrolledLimit) * 100)
      : 0;
  const isLive = room?.status === "LIVE";

  const confirmEnd = async () => {
    if (!typedRoomId) return;
    setEnding(true);
    setActionError(null);
    try {
      await endRoomMutation({ roomId: typedRoomId });
      setEndOpen(false);
    } catch (err) {
      setActionError(getErrorMessage(err, "Could not end the exam. Try again."));
    } finally {
      setEnding(false);
    }
  };

  const confirmDelete = async () => {
    if (!typedRoomId) return;
    setDeleting(true);
    setActionError(null);
    try {
      await deleteRoomMutation({ roomId: typedRoomId });
      navigate("/examiner-portal");
    } catch (err) {
      setActionError(getErrorMessage(err, "Could not delete the room. Try again."));
      setDeleting(false);
    }
  };

  const loading = room === undefined;
  const missing = room === null;

  return (
    <CodeVenuePage>
      <div className="cv-shell">
        <VenueHeader />
        <main className="cv-page-wrap">
          <Link to="/examiner-portal" className="cv-back-link">
            <ArrowLeft size={15} /> Back to dashboard
          </Link>

          {loading ? (
            <div className="cv-empty">Loading exam…</div>
          ) : missing ? (
            <div className="cv-empty">
              This exam doesn't exist or isn't yours.{" "}
              <Link to="/examiner-portal" className="cv-link">
                Back to your exams
              </Link>
            </div>
          ) : (
            <>
              {/* Exam header — identity + status + ONE primary action. */}
              <div className="cv-page-head">
                <div>
                  <h1 className="cv-exam-detail-title">
                    {room.name}
                    {isLive ? <LivePill /> : <ClosedPill />}
                  </h1>
                  <p className="cv-sub cv-exam-detail-sub">
                    <CodePill code={room.code} />
                    <span>
                      Started {format(room.startedAt, "MMM d, HH:mm")} ·{" "}
                      {room.durationMinutes} min
                    </span>
                  </p>
                </div>
                <div className="cv-page-actions">
                  {isLive && (
                    <button
                      className="cv-btn cv-btn-secondary"
                      onClick={() => setEndOpen(true)}
                    >
                      <Square size={14} /> End Exam
                    </button>
                  )}
                  <button
                    className="cv-btn cv-btn-primary"
                    onClick={() => navigate(`/submissions/${room._id}`)}
                  >
                    Grade Submissions <ChevronRight size={15} />
                  </button>
                </div>
              </div>

              {actionError && <span className="cv-error">{actionError}</span>}

              {/* Task tabs — each tab holds one information class. */}
              <div
                className="cv-tabs cv-detail-tabs"
                role="tablist"
                aria-label="Exam sections"
              >
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    role="tab"
                    aria-selected={tab === t.key}
                    className={"cv-tab" + (tab === t.key ? " active" : "")}
                    onClick={() => setTab(t.key)}
                  >
                    {t.label}
                    {t.key === "monitoring" && c.flagged > 0 && (
                      <span className="cv-tab-badge">⚠ {c.flagged}</span>
                    )}
                  </button>
                ))}
              </div>

              {tab === "overview" && (
                <section className="cv-card cv-panel cv-detail-panel">
                  <div className="cv-detail-grid">
                    <div className="cv-detail-cell">
                      <span className="k">Status</span>
                      <span className="v">{isLive ? "Live now" : "Ended"}</span>
                    </div>
                    <div className="cv-detail-cell">
                      <span className="k">Students</span>
                      <span className="v">
                        {c.joined} joined / {room.enrolledLimit} limit
                      </span>
                    </div>
                    <div className="cv-detail-cell">
                      <span className="k">Final submissions</span>
                      <span className="v">
                        {c.submitted} ({pct}%)
                      </span>
                    </div>
                    <div className="cv-detail-cell">
                      <span className="k">Tab-switch warnings</span>
                      <span className="v">
                        {room.violationLimit
                          ? `${room.violationLimit} (auto-submit after)`
                          : "Zero-tolerance"}
                      </span>
                    </div>
                  </div>

                  <div className="cv-progress">
                    <div className="cv-progress-label">
                      <span>
                        {c.submitted} of {room.enrolledLimit} submitted
                      </span>
                      <span>{pct}%</span>
                    </div>
                    <div className="cv-progress-bar">
                      <div
                        className="cv-progress-fill"
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                  </div>

                  <QuestionBox prompt={room.prompt} />

                  <p className="cv-detail-hint">
                    {c.autoSubmitted > 0
                      ? `${c.autoSubmitted} ${c.autoSubmitted === 1 ? "student was" : "students were"} auto-submitted for exceeding the warning limit — see Monitoring.`
                      : "Live per-student monitoring is under the Monitoring tab."}
                  </p>
                </section>
              )}

              {/* PERFORMANCE CONTRACT: the getRoomMonitoring subscription
                  mounts only while this tab is open ("skip" otherwise) —
                  one live query per open room, never a per-room
                  dashboard-wide subscription. */}
              {tab === "monitoring" && (
                <section className="cv-detail-panel">
                  <MonitoringPanel roomId={room._id} active />
                </section>
              )}

              {tab === "submissions" && (
                <section className="cv-detail-panel cv-submissions-embed">
                  {/* The shared grading component — same implementation the
                      standalone /submissions/:roomId route renders. */}
                  <SubmissionsView roomId={room._id} embedded />
                </section>
              )}

              {tab === "settings" && (
                <section className="cv-card cv-panel cv-detail-panel">
                  <div className="cv-detail-grid">
                    <div className="cv-detail-cell">
                      <span className="k">Room name</span>
                      <span className="v">{room.name}</span>
                    </div>
                    <div className="cv-detail-cell">
                      <span className="k">Duration</span>
                      <span className="v">{room.durationMinutes} min</span>
                    </div>
                    <div className="cv-detail-cell">
                      <span className="k">Enrollment limit</span>
                      <span className="v">{room.enrolledLimit}</span>
                    </div>
                    <div className="cv-detail-cell">
                      <span className="k">Room code</span>
                      <span className="v">{room.code}</span>
                    </div>
                  </div>

                  {isLive ? (
                    <div className="cv-settings-actions">
                      <button
                        className="cv-btn cv-btn-secondary"
                        onClick={() => setEditOpen(true)}
                      >
                        <Pencil size={14} /> Edit Room
                      </button>
                      <button
                        className="cv-btn cv-btn-secondary"
                        onClick={() => {
                          navigator.clipboard
                            .writeText(room.code)
                            .then(() => {
                              setCodeCopied(true);
                              setTimeout(
                                () => setCodeCopied(false),
                                1500,
                              );
                            })
                            .catch(() => {
                              // clipboard unavailable — button state unchanged
                            });
                        }}
                      >
                        {codeCopied ? (
                          <>
                            <Check size={14} /> Copied
                          </>
                        ) : (
                          <>
                            <Copy size={14} /> Copy Room Code
                          </>
                        )}
                      </button>
                    </div>
                  ) : (
                    <p className="cv-detail-hint">
                      This exam has ended — settings are read-only. Deleting is
                      still possible below.
                    </p>
                  )}

                  <div className="cv-danger-zone">
                    <div>
                      <h4>Delete this room</h4>
                      <p>
                        Permanently removes the room, its question, and all{" "}
                        {c.joined} student records. Cannot be undone.
                      </p>
                    </div>
                    <button
                      className="cv-btn cv-btn-danger cv-btn-sm"
                      onClick={() => setDeleteOpen(true)}
                    >
                      <Trash2 size={14} /> Delete Room
                    </button>
                  </div>
                </section>
              )}
            </>
          )}
        </main>
      </div>

      {room && (
        <RoomFormModal
          key={room._id}
          open={editOpen}
          editRoom={room}
          examinerRooms={listMyRooms ?? []}
          onClose={() => setEditOpen(false)}
        />
      )}

      {/* End exam confirmation */}
      <Modal
        open={endOpen}
        onClose={() => setEndOpen(false)}
        title="End this exam?"
        subtitle={
          room
            ? `End '${room.name}'? Once closed, this room cannot be reopened.`
            : undefined
        }
        footer={
          <>
            <button
              className="cv-btn cv-btn-secondary"
              onClick={() => setEndOpen(false)}
              disabled={ending}
            >
              Cancel
            </button>
            <button
              className="cv-btn cv-btn-danger cv-end-confirm"
              onClick={confirmEnd}
              disabled={ending}
            >
              {ending ? (
                <>
                  <Loader2 size={15} className="animate-spin" /> Ending…
                </>
              ) : (
                "End Exam"
              )}
            </button>
          </>
        }
      >
        <p className="cv-modal-sub" style={{ marginBottom: 0 }}>
          Students still in the room will be locked out immediately. Their most
          recent autosave stays available for grading.
        </p>
      </Modal>

      {/* Delete room confirmation — permanent */}
      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete this room?"
        footer={
          <>
            <button
              className="cv-btn cv-btn-secondary"
              onClick={() => setDeleteOpen(false)}
              disabled={deleting}
            >
              Cancel
            </button>
            <button
              className="cv-btn cv-btn-danger cv-end-confirm"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <Loader2 size={15} className="animate-spin" /> Deleting…
                </>
              ) : (
                "Delete Permanently"
              )}
            </button>
          </>
        }
      >
        <p className="cv-modal-sub" style={{ marginBottom: 0 }}>
          Delete '{room?.name}'? This permanently removes the room, its
          question, and all {c.joined} student records — drafts and final
          submissions alike. This cannot be undone.
        </p>
      </Modal>
    </CodeVenuePage>
  );
}

export default function ExaminerExamDetail() {
  return (
    <RequireAuth>
      <ExaminerExamDetailInner />
    </RequireAuth>
  );
}
