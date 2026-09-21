import type { Doc } from "@/convex/_generated/dataModel";
import { ChevronRight, Square } from "lucide-react";
import { memo, useEffect, useState } from "react";
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
  /** Students with ≥1 recorded violation — the server's single "Needs
   *  Attention" definition (getRoomCounts computes it; never recomputed
   *  client-side). Optional for tolerance across a convex-codegen boundary. */
  attention?: number;
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
  // Server-derived attention set; falls back to the two severity fields only
  // if a stale codegen boundary omits `attention` (defensive, not a second
  // definition — the server field is the one source of truth).
  const needsAttention =
    (c.attention ?? c.flagged + c.autoSubmitted) > 0;
  // Minute-level clock so a LIVE card's "Ends in N min" actually counts down
  // while the dashboard is open (the card re-renders on every live count
  // update, but between updates the label would otherwise freeze at the
  // mount-time value — stale information on the scan surface).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (room.status !== "LIVE") return;
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [room.status]);
  // Time context — the actionable fact for each state: a live exam's ends-at
  // is when the teacher wraps up (also surfaces "Time expired" when the
  // window has passed but the room isn't closed yet — students' late submits
  // are being flagged); a past exam's is when it ended. `Date.now()` here is
  // fine: the minute interval (LIVE) or card re-renders (closed) own updates,
  // and relTime granularity is minutes anyway.
  const timeContext =
    room.status === "LIVE"
      ? (() => {
          const endsAt = room.startedAt + room.durationMinutes * 60_000;
          const minsLeft = Math.ceil((endsAt - Date.now()) / 60_000);
          if (minsLeft > 90)
            return `Ends in ${Math.round(minsLeft / 60)} hr`;
          return minsLeft > 0 ? `Ends in ${minsLeft} min` : "Time expired";
        })()
      : `Ended ${relTime(room.endedAt ?? room.startedAt, now)}`;

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

        {/* Glance metrics — one compact metadata row: participation,
            attention, and recency grouped together (flex-wrap keeps it
            responsive). Attention facts (flagged / auto-submitted) render
            only when non-zero: ⚠ + words, never color alone. */}
        <div className="cv-exam-card-stats">
          <span className="cv-exam-metric">
            <strong>{c.joined}</strong> / {room.enrolledLimit} students
          </span>
          <span className="cv-exam-metric">
            <strong>{c.submitted}</strong> submitted
          </span>
          {/* The room's attention population, from the same server field the
              dashboard KPI uses. Severity detail (flagged/auto-submitted)
              appears only when present, inside the attention context. */}
          {(c.attention ?? 0) > 0 ? (
            <span className="cv-exam-metric cv-exam-metric-warn">
              ⚠ {c.attention} need{c.attention === 1 ? "s" : ""} attention
            </span>
          ) : (
            <span className="cv-exam-metric cv-exam-metric-quiet">No flags</span>
          )}
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
          <span className="cv-exam-metric">{timeContext}</span>
        </div>

        {/* Submission progress — one thin bar; the percentage travels with
            its meaning ("…% completed") instead of floating unlabelled. The
            progressbar's accessible name carries the full counts for AT. */}
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
          <span className="cv-progress-pct">{pct}% completed</span>
        </div>
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
