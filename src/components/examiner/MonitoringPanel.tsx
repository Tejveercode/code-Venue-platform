import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { memo, useState } from "react";
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
  breakdown: { blur: number; paste: number; copy: number; rejoin: number };
  rejoins: number[];
  recentEvents: { type: "blur" | "paste" | "copy"; at: number }[];
};

export type MonitoringData =
  | { error: string }
  | { room: { violationLimit: number; status: string }; rows: MonitoringRow[] };

/**
 * One student row in the live monitoring list. Expands to a plain-language
 * breakdown: what happened, when, and per-type totals.
 */
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
          {/* Inner span so ellipsis truncation on narrow screens targets the
              name text only — never the ID chip beside it. */}
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
          {/* Words, not just a number — "⚠ 2 violations" reads instantly; a
              bare "2" does not. ⚠ keeps status non-color-only (a11y). */}
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
          {row.autoSubmittedAt !== null && (
            <p className="cv-mon-autosubmit">
              Auto-submitted at {format(row.autoSubmittedAt, "HH:mm:ss")}
              {row.violationCount > 0 &&
                ` — ${row.violationCount} ${row.violationCount === 1 ? "violation" : "violations"} detected`}
              .
            </p>
          )}
          {row.recentEvents.length > 0 ? (
            <ul className="cv-mon-events">
              {row.recentEvents.slice(0, 6).map((e, i) => (
                <li key={`${e.at}-${i}`}>
                  {VIOLATION_EVENT_LABELS[e.type]} — {format(e.at, "HH:mm:ss")}
                </li>
              ))}
              {row.recentEvents.length > 6 && (
                <li className="more">+ {row.recentEvents.length - 6} earlier</li>
              )}
            </ul>
          ) : (
            <p className="cv-mon-events-empty">
              No tab switches, pastes, or copies recorded.
            </p>
          )}
          <div className="cv-mon-grid">
            {(
              Object.keys(VIOLATION_EVENT_LABELS) as (keyof typeof VIOLATION_EVENT_LABELS)[]
            ).map((type) => (
              <div key={type} className="cv-detail-cell">
                <span className="k">{VIOLATION_EVENT_LABELS[type]}</span>
                <span className="v">{row.breakdown[type]}</span>
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
