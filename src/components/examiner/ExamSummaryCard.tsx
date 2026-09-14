import type { Doc } from "@/convex/_generated/dataModel";
import { ChevronRight, Square } from "lucide-react";
import { memo } from "react";
import { useNavigate } from "react-router";
import { ClosedPill, CodePill, LivePill } from "@/components/venue/ui";

type Room = Doc<"rooms">;

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

        {/* Three glance metrics — the numbers a teacher checks from across
            the room. Flagged renders only when non-zero (attention cue,
            ⚠ + words so it never relies on color alone). */}
        <div className="cv-exam-card-stats">
          <span className="cv-exam-metric">
            <strong>{c.joined}</strong> / {room.enrolledLimit} students
          </span>
          <span className="cv-exam-metric">
            <strong>{c.submitted}</strong> submitted
          </span>
          {c.flagged > 0 ? (
            <span className="cv-exam-metric cv-exam-metric-warn">
              ⚠ {c.flagged} flagged
            </span>
          ) : (
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
      </div>

      <div className="cv-exam-card-actions">
        {/* THE primary action. Everything else about this exam is one click
            away inside the detail page. */}
        <button
          className="cv-btn cv-btn-primary"
          onClick={() => navigate(`/examiner/exams/${room._id}`)}
        >
          View Exam <ChevronRight size={15} />
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
