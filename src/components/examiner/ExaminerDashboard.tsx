import type { Doc } from "@/convex/_generated/dataModel";
import { Plus, Search } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import { ExamSummaryCard, type RoomCounts } from "./ExamSummaryCard";

type Room = Doc<"rooms">;

export type Counts = Record<string, RoomCounts>;

const EMPTY_COUNT: RoomCounts = {
  joined: 0,
  submitted: 0,
  flagged: 0,
  autoSubmitted: 0,
};

/** One statistic with a reason to exist — every value comes from live data. */
const StatCard = memo(function StatCard({
  label,
  value,
  live,
  attention,
}: {
  label: string;
  value: React.ReactNode;
  live?: boolean;
  attention?: boolean;
}) {
  return (
    <div
      className={
        "cv-card cv-stat-card" + (attention ? " cv-stat-card-attention" : "")
      }
    >
      <div className="cv-stat-label">
        {label}
        {live && (
          <span
            className="cv-live-dot"
            style={{ color: "var(--accent-amber-deep)" }}
          />
        )}
      </div>
      <div className="cv-stat-value">{value}</div>
    </div>
  );
});

/**
 * Examiner dashboard body — the scan layer.
 *
 * IA contract: this page answers "what is happening with my exams right
 * now?" — stats, attention items, and one summary card per exam with a
 * single primary action. Everything deeper (monitoring, prompt, settings,
 * the full submission workflow) lives in the per-exam detail page. The
 * dashboard holds ZERO live monitoring subscriptions.
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

  const list = rooms ?? [];

  const totalStudents = list.reduce(
    (sum, r) => sum + (counts?.[r._id]?.joined ?? 0),
    0,
  );
  const activeCount = list.filter((r) => r.status === "LIVE").length;
  const flaggedTotal = list.reduce(
    (sum, r) => sum + (counts?.[r._id]?.flagged ?? 0),
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
    Boolean(query) &&
    list.length > 0 &&
    activeFiltered.length === 0 &&
    pastFiltered.length === 0;

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

      <div className="cv-stat-row">
        <StatCard label="Active Exams" value={activeCount} live />
        <StatCard label="Total Students" value={totalStudents} />
        <StatCard
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
            amber-tinted with the ⚠ glyph when something needs action. */}
        <StatCard
          label="Needs Attention"
          value={
            flaggedTotal > 0 ? (
              <>⚠ {flaggedTotal}</>
            ) : (
              "0"
            )
          }
          attention={flaggedTotal > 0}
        />
      </div>

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
      )}

      <section className="cv-card cv-panel">
        <div className="cv-panel-head">
          <h2>Exams</h2>
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
          <div className="cv-empty">
            No exam rooms yet. Click <strong>Create New Exam</strong> above,
            write your question, then share the generated code (CV-####) with
            your class — students enter it on the Student page. Their work
            appears in each exam's Submissions tab.
          </div>
        ) : noResults ? (
          <div className="cv-empty">
            No exams found for "{search}". Try a different name or code.
          </div>
        ) : (
          <>
            {activeList.length > 0 && (
              <>
                <h3 className="cv-list-heading">Active exams</h3>
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
              </>
            )}

            {/* Past exams — same card, no End action, visually secondary. */}
            {pastList.length > 0 && (
              <>
                <h3 className="cv-list-heading">Past exams</h3>
                <div className="cv-exam-list cv-exam-list-muted">
                  {pastFiltered.map((room) => (
                    <div key={room._id} id={`exam-card-${room._id}`}>
                      <ExamSummaryCard
                        room={room}
                        c={counts?.[room._id] ?? EMPTY_COUNT}
                        onEnd={null}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </section>
    </main>
  );
}
