import type { Doc } from "@/convex/_generated/dataModel";
import { ChevronRight, Square } from "lucide-react";
import { memo, useState } from "react";
import { useNavigate } from "react-router";
import { ClosedPill, CodePill, LivePill } from "@/components/venue/ui";

type Room = Doc<"rooms">;

/** Compact relative time for scan-surface context ("12 min ago"). */
function relTime(ts: number, now: number): string {
  const mins = Math.max(0, Math.round((now - ts) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export type RoomCounts = {
  joined: number;
  submitted: number;
  flagged: number;
  autoSubmitted: number;
};

/**
 * Compact, scannable exam summary — the dashboard's primary unit.
 *
 * IA contract: this card answers "what is happening with this exam right
 * now" in one glance (status, participation, progress, attention) and
 * offers exactly ONE primary action (View Exam → detail page). Monitoring,
 * the prompt, configuration, and secondary actions live in the detail
 * page's tabs, not here — they belong to different tasks.
 */
export const ExamSummaryCard = memo(function ExamSummaryCard({
  room,
  c,
  onEnd,
}: {
  room: Room;
  c: RoomCounts;
  /** Present only for LIVE rooms — closed ones show no End action. */
  onEnd?: ((room: Room) => void) | null;
}) {
  const navigate = useNavigate();
  const pct =
    room.enrolledLimit > 0
      ? Math.round((c.submitted / room.enrolledLimit) * 100)
      : 0;
  const needsAttention = c.flagged > 0 || c.autoSubmitted > 0;
  // Card-local render clock, captured once per mounted card. Minute-level
  // granularity is plenty for a scan surface; the label refreshes whenever
  // the card re-renders on live counts/status changes.
  const [now] = useState(() => Date.now());
  const startedAt =
    room.status === "LIVE" ? room.startedAt : (room.endedAt ?? room.startedAt);

  return (
    <div
      className={
        "cv-exam-card" + (needsAttention ? " cv-exam-card-attention" : "")
      }
    >
      <div className="cv-exam-card-main">
        <div className="cv-exam-card-title">
          <h3>{room.name}</h3>
          {room.status === "LIVE" ? <LivePill /> : <ClosedPill />}
        </div>
        <div className="cv-exam-card-code">
          <CodePill code={room.code} />
        </div>

        {/* Glance metrics — the numbers a teacher checks from across the
            room. Attention facts (flagged / auto-submitted) render only when
            non-zero: ⚠ + words, never color alone. Level-1 data. */}
        <div className="cv-exam-card-stats">
          <span className="cv-exam-metric">
            <strong>{c.joined}</strong> / {room.enrolledLimit} students
          </span>
          <span className="cv-exam-metric">
            <strong>{c.submitted}</strong> submitted
          </span>
          {c.flagged > 0 && (
            <span className="cv-exam-metric cv-exam-metric-warn">
              ⚠ {c.flagged} flagged
            </span>
          )}
          {c.autoSubmitted > 0 && (
            <span className="cv-exam-metric cv-exam-metric-warn">
              ⚠ {c.autoSubmitted} auto-submitted
            </span>
          )}
          {c.flagged === 0 && c.autoSubmitted === 0 && (
            <span className="cv-exam-metric cv-exam-metric-quiet">
              No flags
            </span>
          )}
        </div>

        {/* Submission progress — one thin bar, not another number row. */}
        <div
          className="cv-progress cv-progress-slim"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${c.submitted} of ${room.enrolledLimit} students submitted`}
        >
          <div className="cv-progress-bar">
            <div
              className="cv-progress-fill"
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
          <span className="cv-progress-pct">{pct}%</span>
        </div>

        {/* ROW 3 — relative time context ("Started 12 min ago"), so a fresh
            room and a room running for two hours don't look identical. */}
        <span className="cv-exam-time">
          {room.status === "LIVE" ? "Started" : "Ended"} {relTime(startedAt, now)}
        </span>
      </div>

      <div className="cv-exam-card-actions">
        {/* THE primary action. Everything else about this exam is one click
            away inside the detail page. Ended exams' primary intent is
            reviewing outcomes — the label follows the intent. */}
        <button
          className="cv-btn cv-btn-primary"
          onClick={() => navigate(`/examiner/exams/${room._id}`)}
        >
          {room.status === "LIVE" ? "View Exam" : "View Results"}{' '}
          <ChevronRight size={15} />
        </button>
        {/* Contextual secondary action — only meaningful while LIVE. */}
        {onEnd && (
          <button
            className="cv-btn cv-btn-secondary cv-btn-sm"
            onClick={() => onEnd(room)}
          >
            <Square size={12} /> End
          </button>
        )}
      </div>
    </div>
  );
});
