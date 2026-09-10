import { api } from "@/convex/_generated/api";
import {
  ClosedPill,
  CodePill,
  CodeVenuePage,
  LivePill,
  VenueHeader,
} from "@/components/venue/ui";
import { format } from "date-fns";
import { ArrowLeft, FileCode2 } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";

const formatSubTime = (isFinal: boolean, submittedAt: number | null, updatedAt: number) =>
  isFinal
    ? submittedAt
      ? `Submitted ${format(submittedAt, "MMM d, HH:mm:ss")}`
      : "Submitted"
    : `Draft · saved ${format(updatedAt, "HH:mm:ss")}`;

const SubRow = memo(function SubRow({
  studentId,
  name,
  timeLabel,
  selected,
  onSelect,
}: {
  studentId: string;
  name: string;
  timeLabel: string;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      className={"cv-sub-row" + (selected ? " selected" : "")}
      onClick={() => onSelect(studentId)}
    >
      <span className="cv-sub-name">{name}</span>
      <span className="cv-sub-time">{timeLabel}</span>
    </button>
  );
});

const CodeView = memo(function CodeView({
  name,
  code,
  isFinal,
}: {
  name: string;
  code: string;
  isFinal: boolean;
}) {
  return (
    <>
      <div className="cv-code-view-head">
        <h3>{name}'s code</h3>
        <span className={"cv-pill " + (isFinal ? "cv-pill-live" : "cv-pill-closed")}>
          {isFinal ? "Final" : "Draft"}
        </span>
      </div>
      {/* React renders text content escaped — stored code can never inject markup. */}
      <pre className="cv-code-block">
        <code>{code || "(empty)"}</code>
      </pre>
    </>
  );
});

export default function Submissions() {
  const { roomId } = useParams<{ roomId: string }>();
  const data = useQuery(
    api.exams.getRoomSubmissions,
    roomId ? { roomId: roomId as Id<"rooms"> } : "skip",
  ) as
    | {
        error?: string;
        room?: import("@/convex/_generated/dataModel").Doc<"rooms">;
        rows?: Array<{
          studentId: string;
          name: string;
          submission: {
            code: string;
            isFinal: boolean;
            submittedAt: number | null;
            updatedAt: number;
          } | null;
        }>;
      }
    | undefined;

  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Submissions — Code Venue";
  }, []);

  // Auto-select the first row once data loads.
  useEffect(() => {
    if (data?.rows && data.rows.length > 0 && selectedId === null) {
      setSelectedId(data.rows[0]!.studentId);
    }
  }, [data, selectedId]);

  const handleSelect = useCallback((id: string) => setSelectedId(id), []);

  const rows = data?.rows ?? [];
  const selected = useMemo(
    () => rows.find((r) => r.studentId === selectedId) ?? null,
    [rows, selectedId],
  );

  const room = data?.room;

  return (
    <CodeVenuePage>
      <div className="cv-shell">
        <VenueHeader />
        <main className="cv-page-wrap">
          <Link to="/examiner-portal" className="cv-back-link">
            <ArrowLeft size={15} /> Back to portal
          </Link>

          <div className="cv-page-head" style={{ marginBottom: 26 }}>
            <div>
              <h1 style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                {room ? room.name : "Submissions"}
                {room?.status === "LIVE" ? <LivePill /> : <ClosedPill />}
                {room && <CodePill code={room.code} />}
              </h1>
              <p className="cv-sub">
                {room
                  ? `${rows.length} of ${room.enrolledLimit} enrolled students have submitted.`
                  : "Loading room…"}
              </p>
            </div>
          </div>

          {data === undefined ? (
            <div className="cv-empty">Loading submissions…</div>
          ) : data.error ? (
            <div className="cv-empty">{data.error}</div>
          ) : rows.length === 0 ? (
            <div className="cv-empty">
              No submissions yet. Once students join and submit their code, it
              will appear here for grading.
            </div>
          ) : (
            <div className="cv-sub-grid">
              <div className="cv-card cv-sub-list">
                {rows.map((row) => (
                  <SubRow
                    key={row.studentId}
                    studentId={row.studentId}
                    name={row.name}
                    timeLabel={formatSubTime(
                      row.submission!.isFinal,
                      row.submission!.submittedAt,
                      row.submission!.updatedAt,
                    )}
                    selected={row.studentId === selectedId}
                    onSelect={handleSelect}
                  />
                ))}
              </div>

              <div className="cv-card cv-code-view">
                {selected?.submission ? (
                  <CodeView
                    name={selected.name}
                    code={selected.submission.code}
                    isFinal={selected.submission.isFinal}
                  />
                ) : (
                  <div className="cv-empty">
                    <FileCode2 size={20} style={{ marginBottom: 8 }} />
                    <br />
                    Select a student to view their submission.
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </CodeVenuePage>
  );
}
