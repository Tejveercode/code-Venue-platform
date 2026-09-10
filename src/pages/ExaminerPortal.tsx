import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import {
  AccordionRow,
  ClosedPill,
  CodePill,
  CodeVenuePage,
  LivePill,
  Modal,
  QuestionBox,
  VenueHeader,
} from "@/components/venue/ui";
import { format } from "date-fns";
import {
  ChevronRight,
  Copy,
  Check,
  Loader2,
  Pencil,
  Plus,
  Square,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router";
import { PENDING_NAME_KEY } from "@/pages/Auth";

type Room = Doc<"rooms">;
type Counts = Record<string, { joined: number; submitted: number }>;

type RoomFormState = {
  name: string;
  prompt: string;
  durationMinutes: string;
  enrolledLimit: string;
};

const EMPTY_FORM: RoomFormState = {
  name: "",
  prompt: "",
  durationMinutes: "60",
  enrolledLimit: "30",
};

function StatCard({
  label,
  value,
  live,
}: {
  label: string;
  value: React.ReactNode;
  live?: boolean;
}) {
  return (
    <div className="cv-card cv-stat-card">
      <div className="cv-stat-label">
        {label}
        {live && (
          <span className="cv-live-dot" style={{ color: "var(--accent-caramel)" }} />
        )}
      </div>
      <div className="cv-stat-value">{value}</div>
    </div>
  );
}

export default function ExaminerPortal() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const examiner = useQuery(api.exams.getMyExaminer);
  const rooms = useQuery(api.exams.listMyRooms) ?? [];
  const roomIds = useMemo(() => rooms.map((r) => r._id), [rooms]);
  const counts = useQuery(
    api.exams.getRoomCounts,
    roomIds.length > 0 ? { roomIds } : "skip",
  ) as Counts | undefined;

  const ensureExaminer = useMutation(api.exams.ensureExaminer);
  const markWelcomed = useMutation(api.exams.markExaminerWelcomed);
  const createRoom = useMutation(api.exams.createRoom);
  const updateRoom = useMutation(api.exams.updateRoom);
  const endRoomMutation = useMutation(api.exams.endRoom);

  // `examiner === null` means "authed user with no examiner row yet" — a
  // first-ever visit. `undefined` means the query is still loading.
  const [examinerEnsured, setExaminerEnsured] = useState(false);
  const ensureInFlight = useRef(false);

  // The typed signup name stashed by /auth (covers the race where the
  // examiner row is created before setExaminerName lands, and heals rows
  // that were created with the email fallback). Read once per mount so one
  // signup is never counted as two visits.
  const pendingName = useMemo(() => {
    try {
      return sessionStorage.getItem(PENDING_NAME_KEY) ?? undefined;
    } catch {
      return undefined;
    }
  }, []);

  // First-ever visit ⇒ new-user greeting. The `welcomed` flag on the
  // examiner row is backend-computed so it survives tab-closes and reloads;
  // greetedAsNew latches the decision for the whole session so the
  // markExaminerWelcomed write (below) can't swap the heading mid-visit.
  const [greetedAsNew, setGreetedAsNew] = useState(false);

  useEffect(() => {
    if (
      examiner !== undefined &&
      examiner !== null &&
      examiner.welcomed === false
    ) {
      setGreetedAsNew(true);
    }
  }, [examiner]);

  // Form + modal state
  const [formOpen, setFormOpen] = useState(false);
  const [editRoom, setEditRoom] = useState<Room | null>(null);
  const [form, setForm] = useState<RoomFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // End-exam confirmation state
  const [endRoom, setEndRoom] = useState<Room | null>(null);
  const [ending, setEnding] = useState(false);

  // Copied feedback per room
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Expanded accordion rows — explicit state so live re-renders never
  // snap a row closed while the examiner acts inside it.
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  // Search
  const [search, setSearch] = useState("");

  useEffect(() => {
    document.title = "Examiner Portal — Code Venue";
  }, []);

  useEffect(() => {
    if (examiner === null && !examinerEnsured && !ensureInFlight.current) {
      ensureInFlight.current = true;
      setExaminerEnsured(true);
      void ensureExaminer({ pendingName })
        .then(() => {
          if (pendingName) {
            // The row exists now — clear the stash so this name is only ever
            // consumed once (a later tab-open is a *return* visit).
            try {
              sessionStorage.removeItem(PENDING_NAME_KEY);
            } catch {
              // ignore storage failures
            }
          }
        })
        .catch(() => {
          // Allow a retry on the next render where examiner is still null.
          setExaminerEnsured(false);
        })
        .finally(() => {
          ensureInFlight.current = false;
        });
    }
  }, [examiner, examinerEnsured, ensureExaminer, pendingName]);

  // The new-user greeting has now been displayed — flag it server-side after
  // a short delay so the examiner actually sees the first-visit greeting;
  // every future visit then greets with "Welcome back" instead.
  useEffect(() => {
    if (
      examiner !== undefined &&
      examiner !== null &&
      examiner.welcomed === false
    ) {
      const t = setTimeout(() => {
        void markWelcomed({}).catch(() => {
          // Non-fatal: the greeting just shows again next visit.
        });
      }, 4000);
      return () => clearTimeout(t);
    }
  }, [examiner, markWelcomed]);

  const filteredRooms = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rooms;
    return rooms.filter(
      (r) => r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q),
    );
  }, [rooms, search]);

  const activeRooms = rooms.filter((r) => r.status === "LIVE").length;
  const totalStudents = rooms.reduce(
    (sum, r) => sum + (counts?.[r._id]?.joined ?? 0),
    0,
  );
  const avgCompletion = useMemo(() => {
    if (rooms.length === 0) return null;
    const withLimit = rooms.filter((r) => r.enrolledLimit > 0);
    if (withLimit.length === 0) return null;
    const total =
      withLimit.reduce(
        (sum, r) =>
          sum + Math.min(1, (counts?.[r._id]?.submitted ?? 0) / r.enrolledLimit),
        0,
      ) / withLimit.length;
    return Math.round(total * 100);
  }, [rooms, counts]);

  const openForm = (room?: Room) => {
    if (room) {
      setEditRoom(room);
      setForm({
        name: room.name,
        prompt: room.prompt,
        durationMinutes: String(room.durationMinutes),
        enrolledLimit: String(room.enrolledLimit),
      });
    } else {
      setEditRoom(null);
      setForm(EMPTY_FORM);
    }
    setFormError(null);
    setFormOpen(true);
  };

  const submitForm = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError(null);
    const duration = parseInt(form.durationMinutes, 10);
    const enrolled = parseInt(form.enrolledLimit, 10);
    if (!form.name.trim()) return setFormError("Room name is required.");
    if (!form.prompt.trim())
      return setFormError("Question / problem statement is required.");
    if (!Number.isFinite(duration) || duration < 1)
      return setFormError("Duration must be at least 1 minute.");
    if (!Number.isFinite(enrolled) || enrolled < 1)
      return setFormError("Enrolled students must be at least 1.");

    setSaving(true);
    try {
      if (editRoom) {
        await updateRoom({
          roomId: editRoom._id,
          name: form.name.trim(),
          prompt: form.prompt.trim(),
          durationMinutes: duration,
          enrolledLimit: enrolled,
        });
      } else {
        await createRoom({
          name: form.name.trim(),
          prompt: form.prompt.trim(),
          durationMinutes: duration,
          enrolledLimit: enrolled,
        });
      }
      setFormOpen(false);
      setEditRoom(null);
      setForm(EMPTY_FORM);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  const confirmEnd = async () => {
    if (!endRoom) return;
    setEnding(true);
    try {
      await endRoomMutation({ roomId: endRoom._id });
      setEndRoom(null);
    } catch {
      // keep the dialog open on failure
    } finally {
      setEnding(false);
    }
  };

  const copyCode = async (room: Room) => {
    try {
      await navigator.clipboard.writeText(room.code);
    } catch {
      // clipboard unavailable — still show feedback so the user can retry
    }
    setCopiedId(room._id);
    setTimeout(() => setCopiedId((id) => (id === room._id ? null : id)), 1500);
  };

  const toggleRow = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // examiner === null means the ensure hasn't completed yet — that only
  // happens for a brand-new user (returning users always have a row), so
  // show the new-user greeting with the typed name while it runs.
  const isNewUser =
    examiner === null || greetedAsNew || examiner?.welcomed === false;
  const displayName =
    examiner?.name ??
    (examiner === null && pendingName
      ? pendingName
      : (user?.name ?? "examiner"));

  const greeting = isNewUser
    ? `Welcome, ${displayName}!`
    : `Welcome back, ${displayName}`;
  const greetingSub = isNewUser
    ? "You're all set — let's create your first room."
    : "Here's the state of your exam rooms right now.";

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate("/");
    } catch {
      // stay on the portal; RequireAuth will re-guard on next navigation
    }
  };

  return (
    <CodeVenuePage>
      <div className="cv-shell">
        <VenueHeader
          actions={
            <button
              className="cv-btn cv-btn-secondary cv-btn-sm"
              onClick={() => void handleSignOut()}
            >
              Sign Out
            </button>
          }
        />
        <main className="cv-page-wrap">
          <div className="cv-page-head">
            <div>
              <h1>{greeting}</h1>
              <p className="cv-sub">{greetingSub}</p>
            </div>
            <button className="cv-btn cv-btn-primary" onClick={() => openForm()}>
              <Plus size={16} /> Create New Room
            </button>
          </div>

          <div className="cv-stat-row">
            <StatCard label="Active Rooms" value={activeRooms} live />
            <StatCard label="Total Students" value={totalStudents} />
            <StatCard
              label="Avg. Completion"
              value={
                avgCompletion === null ? (
                  "—"
                ) : (
                  <>
                    {avgCompletion}
                    <small>%</small>
                  </>
                )
              }
            />
          </div>

          <section className="cv-card cv-panel">
            <div className="cv-panel-head">
              <h2>Exam Rooms</h2>
              <input
                className="cv-input cv-search"
                placeholder="Search by name or code…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {rooms === undefined ? (
              <div className="cv-empty">Loading rooms…</div>
            ) : rooms.length === 0 ? (
              <div className="cv-empty">
                No exam rooms yet. Create your first room to get a shareable code.
              </div>
            ) : filteredRooms.length === 0 ? (
              <div className="cv-empty">No rooms match "{search}".</div>
            ) : (
              <div className="cv-accordion">
                {filteredRooms.map((room) => {
                  const c = counts?.[room._id] ?? { joined: 0, submitted: 0 };
                  const pct =
                    room.enrolledLimit > 0
                      ? Math.round((c.submitted / room.enrolledLimit) * 100)
                      : 0;
                  return (
                    <AccordionRow
                      key={room._id}
                      open={openIds.has(room._id)}
                      onToggle={() => toggleRow(room._id)}
                      header={
                        <span className="cv-acc-title">
                          <h3>{room.name}</h3>
                          <CodePill code={room.code} />
                          {room.status === "LIVE" ? <LivePill /> : <ClosedPill />}
                        </span>
                      }
                    >
                      <div className="cv-detail-grid">
                        <div className="cv-detail-cell">
                          <span className="k">Started</span>
                          <span className="v">
                            {format(room.startedAt, "MMM d, HH:mm")} ·{" "}
                            {room.durationMinutes} min
                          </span>
                        </div>
                        <div className="cv-detail-cell">
                          <span className="k">Enrolled</span>
                          <span className="v">
                            {c.joined} joined / {room.enrolledLimit} limit
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

                      <div className="cv-action-row">
                        <button
                          className="cv-btn cv-btn-secondary cv-btn-sm"
                          onClick={() => copyCode(room)}
                        >
                          {copiedId === room._id ? (
                            <>
                              <Check size={14} /> Copied!
                            </>
                          ) : (
                            <>
                              <Copy size={14} /> Copy Room Code
                            </>
                          )}
                        </button>
                        <button
                          className="cv-btn cv-btn-secondary cv-btn-sm"
                          onClick={() => navigate(`/submissions/${room._id}`)}
                        >
                          View Submissions <ChevronRight size={14} />
                        </button>
                        {room.status === "LIVE" && (
                          <>
                            <button
                              className="cv-btn cv-btn-secondary cv-btn-sm"
                              onClick={() => openForm(room)}
                            >
                              <Pencil size={14} /> Edit
                            </button>
                            <button
                              className="cv-btn cv-btn-danger cv-btn-sm"
                              onClick={() => setEndRoom(room)}
                            >
                              <Square size={13} /> End Exam
                            </button>
                          </>
                        )}
                      </div>
                    </AccordionRow>
                  );
                })}
              </div>
            )}
          </section>
        </main>
      </div>

      {/* Create / Edit Room modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editRoom ? "Edit Room" : "Create New Room"}
        subtitle={
          editRoom
            ? `Editing "${editRoom.name}" — changes apply immediately for students.`
            : "Students join with the generated code and see exactly the question you write."
        }
      >
        <form onSubmit={submitForm}>
          {formError && <span className="cv-error">{formError}</span>}
          <div className="cv-field">
            <label className="cv-label" htmlFor="room-name">
              Room Name
            </label>
            <input
              id="room-name"
              className="cv-input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Intro to Algorithms — Midterm"
              disabled={saving}
            />
          </div>
          <div className="cv-field">
            <label className="cv-label" htmlFor="room-prompt">
              Question / Problem Statement
            </label>
            <textarea
              id="room-prompt"
              className="cv-textarea"
              rows={5}
              value={form.prompt}
              onChange={(e) => setForm({ ...form, prompt: e.target.value })}
              placeholder="Write the exact problem students will see above their editor…"
              disabled={saving}
            />
          </div>
          <div className="cv-field-row">
            <div className="cv-field">
              <label className="cv-label" htmlFor="room-duration">
                Duration in minutes
              </label>
              <input
                id="room-duration"
                className="cv-input"
                type="number"
                min={1}
                value={form.durationMinutes}
                onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
                disabled={saving}
              />
            </div>
            <div className="cv-field">
              <label className="cv-label" htmlFor="room-enrolled">
                Enrolled Students
              </label>
              <input
                id="room-enrolled"
                className="cv-input"
                type="number"
                min={1}
                value={form.enrolledLimit}
                onChange={(e) => setForm({ ...form, enrolledLimit: e.target.value })}
                disabled={saving}
              />
            </div>
          </div>
          <div className="cv-modal-actions">
            <button
              type="button"
              className="cv-btn cv-btn-secondary"
              onClick={() => setFormOpen(false)}
              disabled={saving}
            >
              Cancel
            </button>
            <button type="submit" className="cv-btn cv-btn-primary" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 size={15} className="animate-spin" /> Saving…
                </>
              ) : editRoom ? (
                "Save Changes"
              ) : (
                "Create Room"
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* End exam confirmation */}
      <Modal
        open={endRoom !== null}
        onClose={() => setEndRoom(null)}
        title="End this exam?"
        subtitle={
          endRoom
            ? `End '${endRoom.name}'? Once closed, this room cannot be reopened.`
            : undefined
        }
        footer={
          <>
            <button
              className="cv-btn cv-btn-secondary"
              onClick={() => setEndRoom(null)}
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
        {endRoom && (
          <p className="cv-modal-sub" style={{ marginBottom: 0 }}>
            Students still in the room will be locked out immediately. Their most
            recent autosave stays available for grading.
          </p>
        )}
      </Modal>
    </CodeVenuePage>
  );
}
