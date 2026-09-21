import type { Doc } from "@/convex/_generated/dataModel";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Plus,
  Search,
  Users,
  type LucideIcon,
} from "lucide-react";
import { memo, useMemo, useState } from "react";
import { ExamSummaryCard, type RoomCounts } from "./ExamSummaryCard";

type Room = Doc<"rooms">;

export type Counts = Record<string, RoomCounts>;

const EMPTY_COUNT: RoomCounts = {
  joined: 0,
  submitted: 0,
  flagged: 0,
  autoSubmitted: 0,
};

/** How many past exams stay visible before "Show all" (progressive disclosure —
 *  the scan layer surfaces what's actionable; history is opt-in). */
const PAST_EXAMS_PREVIEW = 3;

/** One statistic with a reason to exist — every value comes from live data.
 *  `icon` is decorative (aria-hidden): the visible label carries the meaning. */
const StatCard = memo(function StatCard({
  label,
  value,
  live,
  attention,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  live?: boolean;
  attention?: boolean;
  icon?: LucideIcon;
}) {
  return (
    <div
      className={
        "cv-card cv-stat-card" + (attention ? " cv-stat-card-attention" : "")
      }
    >
      <div className="cv-stat-label">
        {Icon && (
          <span className="cv-stat-icon" aria-hidden="true">
            <Icon size={14} strokeWidth={2.25} />
          </span>
        )}
        {label}
        {live && (
          <span
            className="cv-live-dot"
            style={{ color: "var(--accent-caramel-rich)" }}
          />
        )}
      </div>
      <div className="cv-stat-value">{value}</div>
    </div>
  );
});

/**
 * Examiner dashboard body — the scan layer, in working order:
 *
 *   1. ATTENTION   — actionable facts only (flagged / auto-submitted /
 *                    outstanding submissions); silent when all is calm
 *   2. ACTIVE EXAMS — one summary card per live exam, ONE primary action
 *   3. PAST EXAMS  — collapsed summary; details on demand
 *   4. ANALYTICS   — the at-a-glance numbers, last
 *
 * Deep work (monitoring rows, prompt, settings, grading) lives in the
 * per-exam detail page — never on this page. The dashboard holds ZERO live
 * monitoring subscriptions.
 */
export function ExaminerDashboard({
  examinerName,
  greetingNew,
  rooms,
  counts,
  onCreate,
  onEnd,
  onProfile,
}: {
  examinerName: string;
  greetingNew: boolean;
  rooms: Room[] | undefined;
  counts: Counts | undefined;
  onCreate: () => void;
  onEnd: (room: Room) => void;
  onProfile: () => void;
}) {
  const [search, setSearch] = useState("");
  const [pastOpen, setPastOpen] = useState(false);

  // Stable identity while loading (react-hooks/exhaustive-deps): a fresh []
  // literal each render would invalidate every downstream useMemo.
  const list = useMemo(() => rooms ?? [], [rooms]);

  const totalStudents = list.reduce(
    (sum, r) => sum + (counts?.[r._id]?.joined ?? 0),
    0,
  );
  const activeCount = list.filter((r) => r.status === "LIVE").length;
  // Attention total = flagged OR auto-submitted students across all rooms —
  // the same population the attention strip warns about. The two sets are
  // disjoint: zero-tolerance rooms flag without auto-submitting; normal
  // rooms auto-submit without flagging — so both must be summed.
  const flaggedTotal = list.reduce(
    (sum, r) =>
      sum +
      (counts?.[r._id]?.flagged ?? 0) +
      (counts?.[r._id]?.autoSubmitted ?? 0),
    0,
  );
  const avgCompletion = useMemo(() => {
    if (list.length === 0) return null;
    const withLimit = list.filter((r) => r.enrolledLimit > 0);
    if (withLimit.length === 0) return null;
    const total =
      withLimit.reduce(
        (sum, r) =>
          sum + Math.min(1, (counts?.[r._id]?.submitted ?? 0) / r.enrolledLimit),
        0,
      ) / withLimit.length;
    return Math.round(total * 100);
  }, [list, counts]);

  // Attention layer — only actionable, backend-backed facts. No fake urgency;
  // renders nothing when all is calm.
  const attentionItems = useMemo(() => {
    const items: { key: string; tone: "warn" | "info"; text: string }[] = [];
    for (const room of list) {
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
          text: `${room.name} — ${parts.join(" · ")}.`,
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
  }, [list, counts]);

  // Active vs past split; search spans both.
  const activeList = useMemo(() => list.filter((r) => r.status === "LIVE"), [list]);
  const pastList = useMemo(() => list.filter((r) => r.status !== "LIVE"), [list]);
  const query = search.trim().toLowerCase();
  const searching = query.length > 0;
  const activeFiltered = useMemo(
    () =>
      !query
        ? activeList
        : activeList.filter(
            (r) =>
              r.name.toLowerCase().includes(query) ||
              r.code.toLowerCase().includes(query),
          ),
    [activeList, query],
  );
  const pastFiltered = useMemo(
    () =>
      !query
        ? pastList
        : pastList.filter(
            (r) =>
              r.name.toLowerCase().includes(query) ||
              r.code.toLowerCase().includes(query),
          ),
    [pastList, query],
  );
  const noResults =
    searching &&
    list.length > 0 &&
    activeFiltered.length === 0 &&
    pastFiltered.length === 0;

  // Searching expands the past section automatically so matches in history
  // are visible without a second click; it collapses again when cleared.
  const pastRevealed = pastOpen || searching;
  // Preview cap applies only to the idle (not searching) expanded list.
  const pastVisible = searching
    ? pastFiltered
    : pastFiltered.slice(0, PAST_EXAMS_PREVIEW);
  const pastHiddenCount = pastFiltered.length - pastVisible.length;

  const greeting = greetingNew
    ? `Welcome, ${examinerName}!`
    : `Welcome back, ${examinerName}`;
  const greetingSub = greetingNew
    ? "You're all set — let's create your first exam."
    : "Here's the state of your exams right now.";

  return (
    <main className="cv-page-wrap">
      <div className="cv-page-head">
        <div>
          <h1>{greeting}</h1>
          <p className="cv-sub">{greetingSub}</p>
        </div>
        <div className="cv-page-actions">
          <button className="cv-btn cv-btn-secondary" onClick={onProfile}>
            Profile
          </button>
          <button className="cv-btn cv-btn-primary" onClick={onCreate}>
            <Plus size={16} /> Create New Exam
          </button>
        </div>
      </div>

      {/* ── 1 · ATTENTION ────────────────────────────────────────────────────
          Actionable facts first. Warn items (flagged / auto-submitted) carry
          a Review action; info items are context only. Silent when healthy. */}
      {attentionItems.length > 0 ? (
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
                    document
                      .getElementById(`exam-card-${id}`)
                      ?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                >
                  Review
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        list.length > 0 && (
          <div className="cv-attention cv-attention-quiet" role="status">
            <div className="cv-attention-item quiet">
              <span className="cv-attention-text">✓ No exams need attention</span>
            </div>
          </div>
        )
      )}

      {/* ── 2 · ACTIVE EXAMS ─────────────────────────────────────────────── */}
      <section className="cv-card cv-panel">
        <div className="cv-panel-head">
          <h2>
            Active exams
            <span className="cv-panel-count" aria-hidden="true">
              {activeList.length}
            </span>
          </h2>
          <div className="cv-search-wrap">
            <Search size={15} className="cv-search-icon" aria-hidden="true" />
            <input
              className="cv-input cv-search"
              placeholder="Search by name or code…"
              aria-label="Search exams by name or code"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {rooms === undefined ? (
          <div className="cv-empty">Loading exams…</div>
        ) : list.length === 0 ? (
          /* Empty state = one message + ONE obvious action in place (the
             workflow details live in the room form and detail page). */
          <div className="cv-empty">
            <p className="cv-empty-title">No exam rooms yet</p>
            <p className="cv-empty-sub">
              Create your first exam, then share its code with your class.
            </p>
            <button className="cv-btn cv-btn-primary" onClick={onCreate}>
              <Plus size={16} /> Create New Exam
            </button>
          </div>
        ) : noResults ? (
          <div className="cv-empty">
            No exams found for "{search}". Try a different name or code.
          </div>
        ) : activeFiltered.length === 0 ? (
          /* Searching hit only past exams (or everything active ended) —
             say so instead of rendering an empty section. */
          <div className="cv-empty cv-empty-compact">
            <p className="cv-empty-title">No active exams</p>
            <p className="cv-empty-sub">
              Create an exam to start a live coding session.
            </p>
            <button className="cv-btn cv-btn-primary" onClick={onCreate}>
              <Plus size={16} /> Create New Exam
            </button>
          </div>
        ) : (
          <div className="cv-exam-list">
            {activeFiltered.map((room) => (
              <div key={room._id} id={`exam-card-${room._id}`}>
                <ExamSummaryCard
                  room={room}
                  c={counts?.[room._id] ?? EMPTY_COUNT}
                  onEnd={onEnd}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── 3 · PAST EXAMS ──────────────────────────────────────────────────
          History on demand: collapsed to a one-line summary by default;
          expands to a short preview, then fully. Hidden from tab order while
          collapsed (inert container) so nothing invisible is focusable. */}
      {pastList.length > 0 && (
        <section className="cv-card cv-panel cv-past-panel">
          <button
            type="button"
            className="cv-past-toggle"
            aria-expanded={pastRevealed}
            aria-controls="cv-past-list"
            onClick={() => setPastOpen((o) => !o)}
          >
            <span className="cv-past-toggle-label">
              Past exams
              <span className="cv-panel-count" aria-hidden="true">
                {pastList.length}
              </span>
              {/* Only shown while collapsed — the expansion state is carried
                  by aria-expanded + the chevron, not by color or position. */}
              {!pastRevealed && (
                <span className="cv-past-toggle-hint">
                  {pastSummary(pastList, counts)}
                </span>
              )}
            </span>
            <ChevronDown
              size={16}
              className={"cv-past-chevron" + (pastRevealed ? " open" : "")}
              aria-hidden="true"
            />
          </button>

          <div
            id="cv-past-list"
            className="cv-past-body"
            {...(pastRevealed ? {} : { inert: "" as unknown as boolean })}
          >
            <div className="cv-exam-list cv-exam-list-muted">
              {pastVisible.map((room) => (
                <div key={room._id} id={`exam-card-${room._id}`}>
                  <ExamSummaryCard
                    room={room}
                    c={counts?.[room._id] ?? EMPTY_COUNT}
                    onEnd={null}
                  />
                </div>
              ))}
            </div>
            {pastHiddenCount > 0 && (
              <button
                type="button"
                className="cv-btn cv-btn-secondary cv-btn-sm cv-past-more"
                onClick={() => setPastOpen(true)}
              >
                Show {pastHiddenCount} more past exam
                {pastHiddenCount === 1 ? "" : "s"}
              </button>
            )}
          </div>
        </section>
      )}

      {/* ── 4 · ANALYTICS ───────────────────────────────────────────────────
          The at-a-glance numbers close the page, after everything actionable
          has had its say. */}
      <section className="cv-dashboard-analytics" aria-label="Exam statistics">
        <h3 className="cv-list-heading">At a glance</h3>
        {/* cv-kpi-row: page-specific responsive ladder (2×2 ≤1024px) scoped
            here so the shared .cv-stat-row family keeps Landing's 3-card
            proof row sizing independent. */}
        <div className="cv-stat-row cv-kpi-row">
          <StatCard label="Active Exams" value={activeCount} live icon={ClipboardList} />
          <StatCard label="Total Students" value={totalStudents} icon={Users} />
          <StatCard
            icon={CheckCircle2}
            label="Completion"
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
          {/* Attention stat — quiet when healthy (no green success theater);
              amber-tinted when flagged or auto-submitted students exist. The
              bare number is intentional — a ⚠ glyph here duplicated the
              attention strip's warning without adding meaning. */}
          <StatCard
            icon={AlertTriangle}
            label="Needs Attention"
            value={flaggedTotal > 0 ? flaggedTotal : "0"}
            attention={flaggedTotal > 0}
          />
        </div>
      </section>
    </main>
  );
}

/** One-line summary of the collapsed past-exams section (what + how many). */
function pastSummary(pastList: Room[], counts: Counts | undefined): string {
  const students = pastList.reduce(
    (sum, r) => sum + (counts?.[r._id]?.joined ?? 0),
    0,
  );
  const latest = pastList[0];
  if (!latest) return "";
  return `${students} ${students === 1 ? "student" : "students"} · latest: ${latest.name}`;
}
