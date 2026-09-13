import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
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
  Check,
  ChevronRight,
  Copy,
  Loader2,
  Pencil,
  Plus,
  Square,
  Trash2,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router";
import { getErrorMessage } from "@/lib/errors";
import { VIOLATION_EVENT_LABELS } from "./violationEvents";

type Room = Doc<"rooms">;
type Counts = Record<
  string,
  { joined: number; submitted: number; flagged: number; autoSubmitted: number }
>;

type MonitoringRow = {
  studentId: Id<"students">;
  name: string;
  studentUid: string;
  regNo: string | null;
  violationCount: number;
  flagged: boolean;
  autoSubmittedAt: number | null;
  breakdown: { blur: number; paste: number; copy: number; rejoin: number };
  rejoins: number[];
  recentEvents: { type: "blur" | "paste" | "copy"; at: number }[];
};

type MonitoringData =
  | { error: string }
  | {
      room: { violationLimit: number; status: string };
      rows: MonitoringRow[];
    };

type RoomFormState = {
  name: string;
  prompt: string;
  durationMinutes: string;
  enrolledLimit: string;
  violationLimit: string;
};

const EMPTY_FORM: RoomFormState = {
  name: "",
  prompt: "",
  durationMinutes: "60",
  enrolledLimit: "30",
  violationLimit: "",
};

const StatCard = memo(function StatCard({
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
});

// ---------------------------------------------------------------------------
// Live exam-session monitoring (owner-only, reactive via Convex subscription).
// Shows per-student violation state and expands to the per-type breakdown.
// ---------------------------------------------------------------------------

/** Neutral count fallback while a room's live counts load. */
const EMPTY_COUNT = { joined: 0, submitted: 0, flagged: 0, autoSubmitted: 0 };

/**
 * One room in the dashboard list — the extracted room detail body (was inline
 * in the portal render). Presentational only; every action arrives as a
 * callback, and live monitoring subscribes only while the row is open.
 * `onEdit`/`onEnd` are null for closed rooms, whose controls hide (a closed
 * exam can no longer be edited or ended — Delete stays available).
 */
const RoomRow = memo(function RoomRow({
  room,
  c,
  open,
  onToggle,
  copiedId,
  onCopy,
  onEdit,
  onEnd,
  onDelete,
}: {
  room: Room;
  c: typeof EMPTY_COUNT;
  open: boolean;
  onToggle: (id: string) => void;
  copiedId: string | null;
  onCopy: (room: Room) => void;
  onEdit: ((room: Room) => void) | null;
  onEnd: ((room: Room) => void) | null;
  onDelete: (room: Room) => void;
}) {
  const navigate = useNavigate();
  const pct =
    room.enrolledLimit > 0 ? Math.round((c.submitted / room.enrolledLimit) * 100) : 0;
  return (
    <AccordionRow
      open={open}
      onToggle={() => onToggle(room._id)}
      header={
        <span className="cv-acc-title">
          <h3>{room.name}</h3>
          <CodePill code={room.code} />
          {room.status === "LIVE" ? <LivePill /> : <ClosedPill />}
          {/* Compact glance metrics on the collapsed header — the numbers a
              teacher checks from across the room. Flagged appears only when
              non-zero so it doubles as an attention cue. */}
          <span className="cv-acc-metrics">
            <span>
              {c.joined}/{room.enrolledLimit}
            </span>
            <span>{c.submitted} in</span>
            {c.flagged > 0 && <span className="danger">⚠ {c.flagged} flagged</span>}
          </span>
        </span>
      }
    >
      <div id={`room-${room._id}`} className="cv-detail-grid">
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
        <div className="cv-detail-cell">
          <span className="k">Tab-switch warnings</span>
          <span className="v">
            {room.violationLimit
              ? `${room.violationLimit} (auto-submit after)`
              : "Zero-tolerance"}
          </span>
        </div>
      </div>

      <MonitoringPanel roomId={room._id} active={open} />

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
          onClick={() => onCopy(room)}
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
          className="cv-btn cv-btn-primary cv-btn-sm"
          onClick={() => navigate(`/submissions/${room._id}`)}
        >
          View Submissions <ChevronRight size={14} />
        </button>
        {onEdit && (
          <button
            className="cv-btn cv-btn-secondary cv-btn-sm"
            onClick={() => onEdit(room)}
          >
            <Pencil size={14} /> Edit
          </button>
        )}
        {onEnd && (
          <button
            className="cv-btn cv-btn-danger cv-btn-sm"
            onClick={() => onEnd(room)}
          >
            <Square size={13} /> End Exam
          </button>
        )}
        <button
          className="cv-btn cv-btn-danger cv-btn-sm"
          onClick={() => onDelete(room)}
        >
          <Trash2 size={14} /> Delete Room
        </button>
      </div>
    </AccordionRow>
  );
});

const MonitoringRowItem = memo(function MonitoringRowItem({
  row,
}: {
  row: MonitoringRow;
}) {
  const [expanded, setExpanded] = useState(false);
  const flagged = row.flagged || row.autoSubmittedAt !== null;

  return (
    <div className={"cv-mon-row" + (flagged ? " flagged" : "")}>
      <button
        type="button"
        className="cv-mon-row-head"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <span className="cv-mon-name">
          {/* Inner span so the ellipsis truncation on narrow screens targets
              the name text only — never the ID chip beside it. */}
          <span>{row.name}</span>
          {row.regNo && <span className="cv-mon-reg">{row.regNo}</span>}
        </span>
        <span className="cv-mon-meta">
          {row.autoSubmittedAt !== null && (
            <span className="cv-pill cv-pill-flag">Auto-submitted</span>
          )}
          {row.flagged && row.autoSubmittedAt === null && (
            <span className="cv-pill cv-pill-flag">Flagged</span>
          )}
          {/* Words, not just a number — "⚠ 2 violations" reads instantly;
              a bare "2" does not. The ⚠ glyph keeps flagged students
              distinguishable without relying on color alone (a11y). */}
          <span
            className={"cv-mon-count" + (flagged ? " danger" : "")}
            title="Violations counted toward the limit"
          >
            {row.violationCount > 0
              ? `⚠ ${row.violationCount} ${row.violationCount === 1 ? "violation" : "violations"}`
              : "No violations"}
          </span>
        </span>
      </button>
      {expanded && (
        <div className="cv-mon-breakdown">
          {/* Auto-submit explanation first, in plain language — the examiner
              should read WHAT happened and WHY without cross-referencing
              counts. */}
          {row.autoSubmittedAt !== null && (
            <p className="cv-mon-autosubmit">
              Auto-submitted at {format(row.autoSubmittedAt, "HH:mm:ss")}
              {row.violationCount > 0 &&
                ` — ${row.violationCount} ${row.violationCount === 1 ? "violation" : "violations"} detected`}
              .
            </p>
          )}
          {/* Plain-language event list next — what happened and when.
              Numeric totals stay secondary below. */}
          {row.recentEvents.length > 0 ? (
            <ul className="cv-mon-events">
              {row.recentEvents.slice(0, 6).map((e, i) => (
                <li key={`${e.at}-${i}`}>
                  {VIOLATION_EVENT_LABELS[e.type]} — {format(e.at, "HH:mm:ss")}
                </li>
              ))}
              {row.recentEvents.length > 6 && (
                <li className="more">
                  + {row.recentEvents.length - 6} earlier
                </li>
              )}
            </ul>
          ) : (
            <p className="cv-mon-events-empty">No tab switches, pastes, or copies recorded.</p>
          )}
          <div className="cv-mon-grid">
            {(Object.keys(VIOLATION_EVENT_LABELS) as (keyof typeof VIOLATION_EVENT_LABELS)[]).map(
              (type) => (
                <div key={type} className="cv-detail-cell">
                  <span className="k">{VIOLATION_EVENT_LABELS[type]}</span>
                  <span className="v">{row.breakdown[type]}</span>
                </div>
              ),
            )}
          </div>
          {row.rejoins.length > 0 && (
            <div className="cv-mon-rejoins">
              <span className="k">Recent page loads</span>
              {row.rejoins.slice(-6).reverse().map((ts) => (
                <span key={ts} className="v">
                  {format(ts, "MMM d, HH:mm:ss")}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

function MonitoringPanel({
  roomId,
  active,
}: {
  roomId: Id<"rooms">;
  active: boolean;
}) {
  // "skip" while the accordion is closed — one live subscription per open
  // room, none for closed ones.
  const data = useQuery(
    api.exams.getRoomMonitoring,
    active ? { roomId } : "skip",
  ) as MonitoringData | undefined;

  if (!active) return null;
  if (data === undefined) {
    return (
      <div className="cv-monitor">
        <div className="cv-monitor-head">
          <h4>Live Monitoring</h4>
          <Loader2 size={14} className="animate-spin" style={{ color: "var(--accent-caramel)" }} />
        </div>
      </div>
    );
  }
  if ("error" in data) return null;

  return (
    <div className="cv-monitor">
      <div className="cv-monitor-head">
        <h4>Students</h4>
        <span className="cv-monitor-limit">
          {data.room.violationLimit > 0
            ? `${data.room.violationLimit} warnings, then auto-submit`
            : "Any violation flags the student"}
        </span>
      </div>
      {data.rows.length === 0 ? (
        <div className="cv-empty cv-mon-empty">
          No students have joined yet — monitoring appears as they do.
        </div>
      ) : (
        <div className="cv-mon-list">
          {data.rows.map((row) => (
            <MonitoringRowItem key={row.studentId} row={row} />
          ))}
        </div>
      )}
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
  const updateName = useMutation(api.exams.updateExaminerName);
  const createRoom = useMutation(api.exams.createRoom);
  const updateRoom = useMutation(api.exams.updateRoom);
  const endRoomMutation = useMutation(api.exams.endRoom);
  const deleteRoomMutation = useMutation(api.exams.deleteRoom);

  // `examiner === null` means "authed user with no examiner row yet" — a
  // first-ever visit. `undefined` means the query is still loading.
  const [examinerEnsured, setExaminerEnsured] = useState(false);
  const ensureInFlight = useRef(false);

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

  // Profile (Account Settings) state — the only way to change name later.
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  // Delete-room confirmation state (permanent, data included)
  const [deleteRoom, setDeleteRoom] = useState<Room | null>(null);
  const [deleting, setDeleting] = useState(false);

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
      void ensureExaminer({})
        .catch(() => {
          // Allow a retry on the next render where examiner is still null.
          setExaminerEnsured(false);
        })
        .finally(() => {
          ensureInFlight.current = false;
        });
    }
  }, [examiner, examinerEnsured, ensureExaminer]);

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

  // Stable handlers — they're passed down into the room accordion rows, so
  // identity changes would re-render every row on any portal state change.
  const openForm = useCallback((room?: Room) => {
    if (room) {
      setEditRoom(room);
      setForm({
        name: room.name,
        prompt: room.prompt,
        durationMinutes: String(room.durationMinutes),
        enrolledLimit: String(room.enrolledLimit),
        // Blank = zero-tolerance (server treats 0/absent identically).
        violationLimit: room.violationLimit ? String(room.violationLimit) : "",
      });
    } else {
      setEditRoom(null);
      setForm(EMPTY_FORM);
    }
    setFormError(null);
    setFormOpen(true);
  }, []);

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

    const violationLimitRaw = form.violationLimit.trim();
    let violationLimit: number | undefined;
    if (violationLimitRaw !== "") {
      violationLimit = parseInt(violationLimitRaw, 10);
      if (!Number.isFinite(violationLimit) || violationLimit < 0)
        return setFormError("Violation limit must be 0 or more (blank = zero-tolerance).");
    }

    // Instant client-side duplicate-name check (case-insensitive, scoped to
    // this examiner's rooms; rename ignores the room being edited). The
    // server re-checks authoritatively — this is only for immediate feedback
    // without a round trip.
    const nameCollision = rooms.some(
      (r) =>
        r._id !== editRoom?._id &&
        r.name.trim().toLowerCase() === form.name.trim().toLowerCase(),
    );
    if (nameCollision) {
      return setFormError(
        `You already have a room named "${form.name.trim()}". Choose a different name.`,
      );
    }

    setSaving(true);
    try {
      if (editRoom) {
        await updateRoom({
          roomId: editRoom._id,
          name: form.name.trim(),
          prompt: form.prompt.trim(),
          durationMinutes: duration,
          enrolledLimit: enrolled,
          violationLimit,
        });
      } else {
        await createRoom({
          name: form.name.trim(),
          prompt: form.prompt.trim(),
          durationMinutes: duration,
          enrolledLimit: enrolled,
          violationLimit,
        });
      }
      setFormOpen(false);
      setEditRoom(null);
      setForm(EMPTY_FORM);
    } catch (err) {
      // ConvexError (rate limits, validation) carries a safe message; other
      // failures — including internal errors — become a generic string.
      setFormError(getErrorMessage(err, "Something went wrong. Please try again."));
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

  const confirmDelete = async () => {
    if (!deleteRoom) return;
    setDeleting(true);
    try {
      await deleteRoomMutation({ roomId: deleteRoom._id });
      // listMyRooms re-subscribes; the room disappears from the dashboard
      // immediately after this resolves.
      setDeleteRoom(null);
    } catch {
      // keep the dialog open on failure
    } finally {
      setDeleting(false);
    }
  };

  // Stable handler passed into every accordion row.
  const openDelete = useCallback((room: Room) => setDeleteRoom(room), []);

  const copyCode = useCallback(async (room: Room) => {
    try {
      await navigator.clipboard.writeText(room.code);
    } catch {
      // clipboard unavailable — still show feedback so the user can retry
    }
    setCopiedId(room._id);
    setTimeout(() => setCopiedId((id) => (id === room._id ? null : id)), 1500);
  }, []);

  const toggleRow = useCallback((id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // examiner === null means the ensure hasn't completed yet — that only
  // happens for a brand-new user (returning users always have a row).
  const isNewUser =
    examiner === null || greetedAsNew || examiner?.welcomed === false;
  const displayName = examiner?.name ?? (user?.name ?? "examiner");

  // --- Dashboard triage (the "what needs me NOW" layer) ---------------------
  // Only LIVE rooms can demand attention; closed rooms never surface here.
  // Every item is directly actionable — no fake urgency, and the strip
  // disappears entirely when there is nothing to act on.
  const attentionItems = useMemo(() => {
    const items: { key: string; tone: "warn" | "info"; text: string }[] = [];
    for (const room of rooms) {
      if (room.status !== "LIVE") continue;
      const c = counts?.[room._id];
      if (!c) continue;
      if (c.flagged > 0 || c.autoSubmitted > 0) {
        const parts: string[] = [];
        if (c.flagged > 0)
          parts.push(
            `${c.flagged} flagged ${c.flagged === 1 ? "student" : "students"}`,
          );
        if (c.autoSubmitted > 0)
          parts.push(
            `${c.autoSubmitted} auto-${c.autoSubmitted === 1 ? "submitted" : "submitted"}`,
          );
        items.push({
          key: `flag-${room._id}`,
          tone: "warn",
          text: `${room.name} — ${parts.join(" · ")}. Review in the room's monitoring panel.`,
        });
      }
      if (c.joined > 0 && c.joined > c.submitted) {
        const outstanding = c.joined - c.submitted;
        items.push({
          key: `sub-${room._id}`,
          tone: "info",
          text: `${room.name} — ${outstanding} ${outstanding === 1 ? "student" : "students"} still writing.`,
        });
      }
    }
    return items;
  }, [rooms, counts]);

  // Active vs past split — live exams are the primary content during class;
  // closed exams move to a visually secondary "Past exams" section so a
  // semester of history never buries the room being monitored.
  const activeRoomsList = useMemo(
    () => rooms.filter((r) => r.status === "LIVE"),
    [rooms],
  );
  const activeRooms = activeRoomsList.length;
  const pastRoomsList = useMemo(
    () => rooms.filter((r) => r.status !== "LIVE"),
    [rooms],
  );
  // Search predicate + memoized filtered lists — stable identities so the
  // room rows don't re-render on unrelated state changes.
  const query = search.trim().toLowerCase();
  const activeRoomsFiltered = useMemo(
    () =>
      !query
        ? activeRoomsList
        : activeRoomsList.filter(
            (r) =>
              r.name.toLowerCase().includes(query) ||
              r.code.toLowerCase().includes(query),
          ),
    [activeRoomsList, query],
  );
  const pastRoomsFiltered = useMemo(
    () =>
      !query
        ? pastRoomsList
        : pastRoomsList.filter(
            (r) =>
              r.name.toLowerCase().includes(query) ||
              r.code.toLowerCase().includes(query),
          ),
    [pastRoomsList, query],
  );
  const noSearchResults = Boolean(query) && rooms.length > 0 && activeRoomsFiltered.length === 0 && pastRoomsFiltered.length === 0;

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

  // Profile modal — prefill from the live examiner record each time it opens.
  const openProfile = useCallback(() => {
    setProfileName(examiner?.name ?? "");
    setProfileError(null);
    setProfileSaved(false);
    setProfileOpen(true);
  }, [examiner?.name]);

  const submitProfile = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setProfileError(null);
    const next = profileName.trim();
    if (!next) {
      setProfileError("Please enter your name.");
      return;
    }
    if (next === examiner?.name) {
      setProfileOpen(false);
      return;
    }
    setSavingProfile(true);
    try {
      await updateName({ name: next });
      setProfileSaved(true);
      setTimeout(() => setProfileOpen(false), 800);
    } catch (err) {
      setProfileError(getErrorMessage(err, "Something went wrong. Please try again."));
    } finally {
      setSavingProfile(false);
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
            <div className="cv-page-actions">
              <button
                className="cv-btn cv-btn-secondary"
                onClick={openProfile}
                aria-label="Open profile settings"
              >
                Profile
              </button>
              <button className="cv-btn cv-btn-primary" onClick={() => openForm()}>
                <Plus size={16} /> Create New Room
              </button>
            </div>
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


          {/* Attention strip — rendered only when something is actionable.
              Sits between the stats and the room list so "what needs me"
              is the first thing a teacher scans, before any room detail. */}
          {attentionItems.length > 0 && (
            <div className="cv-attention" role="status">
              {attentionItems.map((item) => (
                <div
                  key={item.key}
                  className={
                    "cv-attention-item" + (item.tone === "warn" ? " warn" : "")
                  }
                >
                  <span className="cv-attention-text">{item.text}</span>
                  {item.key.startsWith("flag-") && (
                    <button
                      type="button"
                      className="cv-btn cv-btn-secondary cv-btn-sm"
                      onClick={() => {
                        const id = item.key.slice("flag-".length);
                        setOpenIds((prev) => new Set(prev).add(id));
                        document
                          .getElementById(`room-${id}`)
                          ?.scrollIntoView({ behavior: "smooth", block: "center" });
                      }}
                    >
                      Review
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
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
                No exam rooms yet. Click <strong>Create New Room</strong> above,
                write your question, then share the generated code (CV-####)
                with your class — students enter it on the Student page. Their
                work appears under <strong>View Submissions</strong>.
              </div>
            ) : noSearchResults ? (
              <div className="cv-empty">
                No exams found for "{search}". Try a different name or code.
              </div>
            ) : (
              <>
                {/* ACTIVE first — the rooms that can need action right now. */}
                {activeRoomsList.length > 0 && (
                  <>
                    <h3 className="cv-list-heading">Active exams</h3>
                    <div className="cv-accordion">
                      {activeRoomsFiltered.map((room) => (
                        <RoomRow
                          key={room._id}
                          room={room}
                          c={counts?.[room._id] ?? EMPTY_COUNT}
                          open={openIds.has(room._id)}
                          onToggle={toggleRow}
                          copiedId={copiedId}
                          onCopy={copyCode}
                          onEdit={openForm}
                          onEnd={setEndRoom}
                          onDelete={openDelete}
                        />
                      ))}
                    </div>
                  </>
                )}

                {/* Past exams — secondary; hidden entirely when empty. */}
                {pastRoomsList.length > 0 && (
                  <>
                    <h3 className="cv-list-heading">Past exams</h3>
                    <div className="cv-accordion cv-accordion-muted">
                      {pastRoomsFiltered.map((room) => (
                        <RoomRow
                          key={room._id}
                          room={room}
                          c={counts?.[room._id] ?? EMPTY_COUNT}
                          open={openIds.has(room._id)}
                          onToggle={toggleRow}
                          copiedId={copiedId}
                          onCopy={copyCode}
                          onEdit={null}
                          onEnd={null}
                          onDelete={openDelete}
                        />
                      ))}
                    </div>
                  </>
                )}
              </>
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
              className="cv-textarea cv-textarea-tall"
              rows={9}
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
          <div className="cv-field">
            <label className="cv-label" htmlFor="room-violation-limit">
              Tab-switch / copy warnings <span>(optional)</span>
            </label>
            <input
              id="room-violation-limit"
              className="cv-input"
              type="number"
              min={0}
              value={form.violationLimit}
              onChange={(e) => setForm({ ...form, violationLimit: e.target.value })}
              placeholder="Leave blank to flag any tab-switch or copy immediately"
              disabled={saving}
            />
            <p className="cv-field-hint">
              During the exam, Code Venue records when a student switches tabs,
              pastes into, or copies out of the code editor (it cannot block
              these). Leave blank or 0: the first switch flags the student to
              you, with no warning shown to them. Enter a number (e.g. 3): the
              student gets that many on-screen warnings, then their exam is
              auto-submitted with their latest code.
            </p>
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

      {/* Profile / Account Settings — the only rename path after signup */}
      <Modal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        title="Profile"
        subtitle={
          examiner?.email
            ? `Signed in as ${examiner.email}`
            : "Your examiner identity"
        }
      >
        <form onSubmit={submitProfile}>
          {profileError && <span className="cv-error">{profileError}</span>}
          <div className="cv-field">
            <label className="cv-label" htmlFor="profile-name">
              Display name
            </label>
            <input
              id="profile-name"
              className="cv-input"
              value={profileName}
              onChange={(e) => {
                setProfileName(e.target.value);
                setProfileSaved(false);
              }}
              placeholder="Ada Lovelace"
              autoComplete="name"
              maxLength={80}
              disabled={savingProfile}
            />
          </div>
          <div className="cv-modal-actions">
            <button
              type="button"
              className="cv-btn cv-btn-secondary"
              onClick={() => setProfileOpen(false)}
              disabled={savingProfile}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="cv-btn cv-btn-primary"
              disabled={savingProfile || !profileName.trim()}
            >
              {savingProfile ? (
                <>
                  <Loader2 size={15} className="animate-spin" /> Saving…
                </>
              ) : profileSaved ? (
                <>
                  <Check size={15} /> Saved
                </>
              ) : (
                "Save name"
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete room confirmation — permanent, includes all student data */}
      <Modal
        open={deleteRoom !== null}
        onClose={() => setDeleteRoom(null)}
        title="Delete this room?"
        footer={
          <>
            <button
              className="cv-btn cv-btn-secondary"
              onClick={() => setDeleteRoom(null)}
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
        {deleteRoom && (
          <p className="cv-modal-sub" style={{ marginBottom: 0 }}>
            Delete '{deleteRoom.name}'? This permanently removes the room, its
            question, and all {counts?.[deleteRoom._id]?.joined ?? 0} student
            records — drafts and final submissions alike. This cannot be undone.
          </p>
        )}
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
