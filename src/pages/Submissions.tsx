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
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";

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
                  <button
                    key={row.studentId}
                    className={
                      "cv-sub-row" + (row.studentId === selectedId ? " selected" : "")
                    }
                    onClick={() => setSelectedId(row.studentId)}
                  >
                    <span className="cv-sub-name">{row.name}</span>
                    <span className="cv-sub-time">
                      {row.submission?.isFinal
                        ? row.submission.submittedAt
                          ? `Submitted ${format(row.submission.submittedAt, "MMM d, HH:mm:ss")}`
                          : "Submitted"
                        : `Draft · saved ${format(row.submission!.updatedAt, "HH:mm:ss")}`}
                    </span>
                  </button>
                ))}
              </div>

              <div className="cv-card cv-code-view">
                {selected?.submission ? (
                  <>
                    <div className="cv-code-view-head">
                      <h3>{selected.name}'s code</h3>
                      <span
                        className={
                          "cv-pill " +
                          (selected.submission.isFinal
                            ? "cv-pill-live"
                            : "cv-pill-closed")
                        }
                      >
                        {selected.submission.isFinal ? "Final" : "Draft"}
                      </span>
                    </div>
                    <pre className="cv-code-block">
                      <code>{selected.submission.code || "(empty)"}</code>
                    </pre>
                  </>
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
