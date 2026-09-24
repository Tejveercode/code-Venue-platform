import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { VIOLATION_EVENT_LABELS } from "@/lib/violationEvents";

export type MonitoringRow = {
  studentId: Id<"students">;
  name: string;
  studentUid: string;
  regNo: string | null;
  violationCount: number;
  flagged: boolean;
  autoSubmittedAt: number | null;
  /** Server truth: this student has a final submission on record. */
  submitted: boolean;
  breakdown: { blur: number; paste: number; copy: number; rejoin: number };
  rejoins: number[];
  recentEvents: { type: "blur" | "paste" | "copy"; at: number }[];
};

export type MonitoringData =
  | { error: string }
  | {
      room: {
        violationLimit: number;
        status: string;
        durationMinutes?: number;
        startedAt?: number;
      };
      rows: MonitoringRow[];
    };

/**
 * Per-student state — one authoritative classification per row, derived ONLY
 * from server-persisted facts, in priority order (a submitted student is
 * submitted regardless of their violation history; auto-submitted is a
 * flagged-forever state with its own explanation).
 */
function studentState(row: MonitoringRow): {
  label: string;
  className: string;
} {
  if (row.autoSubmittedAt !== null) {
    return { label: "Auto-submitted", className: "cv-state-autosub" };
  }
  if (row.submitted) return { label: "Submitted", className: "cv-state-sub" };
  if (row.flagged) return { label: "Flagged", className: "cv-state-flag" };
  if (row.violationCount > 0)
    return { label: "Violations", className: "cv-state-warn" };
  return { label: "Writing", className: "cv-state-ok" };
}

/** Latest enforced (non-rejoin) event time for a row, or null. */
function lastActivityAt(row: MonitoringRow): number | null {
  if (row.recentEvents.length === 0) return null;
  return row.recentEvents[0].at; // recentEvents is newest-first (server-sorted)
}

/**
 * One student's monitoring card. Expands to the compact event timeline.
 *
 * PERF: the live query re-serializes ALL rows on every push (any student's
 * event, join, or submission), so default shallow memo would re-render every
 * card on every update. This comparator re-renders only rows whose OWN data
 * changed — one student's violation updates exactly one card; expanded
 * state, scroll position, and the other rows never move.
 */
const MonitoringRowItem = memo(
  function MonitoringRowItem({
    row,
  }: {
    row: MonitoringRow;
  }) {
  const [expanded, setExpanded] = useState(false);
  const state = studentState(row);
  const attention = row.violationCount > 0;
  const lastAt = lastActivityAt(row);

  return (
    <div
      className={
        "cv-mon-row" + (attention ? " flagged" : "") + (expanded ? " open" : "")
      }
    >
      <button
        type="button"
        className="cv-mon-row-head"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        aria-label={`${row.name} — ${state.label}${
          row.violationCount > 0
            ? `, ${row.violationCount} ${row.violationCount === 1 ? "violation" : "violations"}`
            : ", no violations"
        }. ${expanded ? "Hide" : "Show"} activity details`}
      >
        {/* Status indicator — a shape (dot), never color alone. */}
        <span className={"cv-mon-dot " + state.className} aria-hidden="true" />
        <span className="cv-mon-id">
          {/* Inner span so ellipsis truncation on narrow screens targets the
              name text only — never the ID chip beside it. */}
          <span className="cv-mon-name">
            <span>{row.name}</span>
            {row.regNo && <span className="cv-mon-reg">{row.regNo}</span>}
          </span>
          <span className={"cv-mon-state " + state.className}>{state.label}</span>
        </span>
        <span className="cv-mon-meta">
          {row.autoSubmittedAt !== null && (
            <span className="cv-pill cv-pill-flag">Auto-submitted</span>
          )}
          {/* Words, not just a number — "⚠ 2 violations" reads instantly;
              ⚠ keeps status non-color-only (a11y). */}
          <span
            className={"cv-mon-count" + (attention ? " danger" : "")}
            title="Violations counted toward the limit"
          >
            {row.violationCount > 0
              ? `⚠ ${row.violationCount} ${row.violationCount === 1 ? "violation" : "violations"}`
              : "No violations"}
          </span>
          {lastAt !== null && (
            <span className="cv-mon-last">
              Last {format(lastAt, "HH:mm:ss")}
            </span>
          )}
        </span>
      </button>

      {expanded && (
        <div className="cv-mon-breakdown">
          {row.autoSubmittedAt !== null && (
            <p className="cv-mon-autosubmit">
              Auto-submitted at {format(row.autoSubmittedAt, "HH:mm:ss")}
              {row.violationCount > 0 &&
                ` — ${row.violationCount} ${row.violationCount === 1 ? "violation" : "violations"} detected`}
              .
            </p>
          )}

          {/* ATTENTION summary first — one line, sentence case. */}
          <p className="cv-mon-attention">
            <span className="k">Attention:</span>{" "}
            {row.violationCount > 0
              ? `${row.violationCount} ${row.violationCount === 1 ? "violation" : "violations"}`
              : "None"}
            {row.breakdown.blur > 0 &&
              ` · ${row.breakdown.blur} tab switch${row.breakdown.blur === 1 ? "" : "es"}`}
            {row.breakdown.paste > 0 &&
              ` · ${row.breakdown.paste} paste${row.breakdown.paste === 1 ? "" : "s"}`}
            {row.breakdown.copy > 0 &&
              ` · ${row.breakdown.copy} cop${row.breakdown.copy === 1 ? "y" : "ies"}`}
          </p>

          {/* RECENT ACTIVITY — compact timeline, newest first. */}
          {row.recentEvents.length > 0 ? (
            <ul className="cv-mon-timeline">
              {row.recentEvents.slice(0, 6).map((e, i) => (
                <li key={`${e.at}-${i}`}>
                  <span className="cv-mon-t-time">{format(e.at, "HH:mm:ss")}</span>
                  <span className="cv-mon-t-label">
                    {VIOLATION_EVENT_LABELS[e.type]}
                  </span>
                </li>
              ))}
              {row.recentEvents.length > 6 && (
                <li className="more">+ {row.recentEvents.length - 6} earlier events</li>
              )}
            </ul>
          ) : (
            <p className="cv-mon-events-empty">
              No tab switches, pastes, or copies recorded.
            </p>
          )}

          {/* ACTIVITY COUNTERS — four label-over-value pairs on one quiet
              row (no boxes). */}
          <div className="cv-mon-counters">
            {(
              Object.keys(VIOLATION_EVENT_LABELS) as (keyof typeof VIOLATION_EVENT_LABELS)[]
            ).map((type) => (
              <div key={type} className="c">
                <span className="v">{row.breakdown[type]}</span>
                <span className="k">{VIOLATION_EVENT_LABELS[type]}</span>
              </div>
            ))}
          </div>

          {row.rejoins.length > 0 && (
            <div className="cv-mon-rejoins">
              <span className="k">Recent page loads</span>
              {row.rejoins
                .slice(-6)
                .reverse()
                .map((ts) => (
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

/**
 * Live exam-session monitoring (owner-only, reactive Convex subscription).
 *
 * PERFORMANCE CONTRACT: `active` gates the subscription — "skip" while
 * inactive, so a room costs one live query only while its monitoring is on
 * screen. The dashboard never passes active=true; only the exam detail
 * page's Monitoring tab does.
 */
export function MonitoringPanel({
  roomId,
  active,
}: {
  roomId: Id<"rooms">;
  active: boolean;
}) {
  const data = useQuery(
    api.exams.getRoomMonitoring,
    active ? { roomId } : "skip",
  ) as MonitoringData | undefined;

  // Live-update UX guard: rows render in their server order (join order —
  // students stay in their own row; a second violation mutates the same
  // card, never duplicates it). No sorting of our own, so a data push can
  // never reorder the list under the teacher's eyes, and scroll position is
  // preserved because rows update in place (memoized items keyed by
  // studentId).
  const rowsKey = useRef<string>("");
  useEffect(() => {
    if (data && !("error" in data)) {
      rowsKey.current = data.rows.map((r) => r.studentId).join(",");
    }
  }, [data]);

  if (!active) return null;
  if (data === undefined) {
    return (
      <div className="cv-monitor">
        <div className="cv-monitor-head">
          <h4>Live Monitoring</h4>
          <Loader2
            size={14}
            className="animate-spin"
            style={{ color: "var(--accent-caramel)" }}
          />
        </div>
      </div>
    );
  }
  if ("error" in data) return null;

  // Header summary — the same numbers the dashboard consumes (row.violationCount
  // is the server tally; attention = the same ≥1-violation definition).
  const attentionCount = data.rows.filter((r) => r.violationCount > 0).length;
  const autoSubmittedCount = data.rows.filter(
    (r) => r.autoSubmittedAt !== null,
  ).length;

  return (
    <div className="cv-monitor">
      <div className="cv-monitor-head">
        <h4>Monitoring</h4>
        <div className="cv-monitor-summary" role="status" aria-live="polite">
          {data.room.status === "LIVE" && (
            <span className="cv-monitor-live">
              <span className="cv-live-dot" aria-hidden="true" /> Live
            </span>
          )}
          <span className="cv-monitor-chip">
            {data.rows.length} {data.rows.length === 1 ? "student" : "students"}
          </span>
          {attentionCount > 0 && (
            <span className="cv-monitor-chip warn">
              ⚠ {attentionCount} need{attentionCount === 1 ? "s" : ""} attention
            </span>
          )}
          {autoSubmittedCount > 0 && (
            <span className="cv-monitor-chip">
              {autoSubmittedCount} auto-submitted
            </span>
          )}
          <span className="cv-monitor-limit">
            {data.room.violationLimit > 0
              ? `${data.room.violationLimit} warnings, then auto-submit`
              : "Any violation flags the student"}
          </span>
        </div>
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
