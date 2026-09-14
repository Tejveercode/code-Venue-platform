import { api } from "@/convex/_generated/api";
import {
  ClosedPill,
  CodePill,
  CodeVenuePage,
  LivePill,
  Modal,
  VenueHeader,
} from "@/components/venue/ui";
import { format } from "date-fns";
import { ArrowLeft, Download, FileCode2, Loader2 } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";
import {
  defaultZipName,
  downloadBlob,
  loadZipLib,
  sanitizeFilename,
  submissionFileName,
} from "@/lib/submissionFiles";

type SubmissionInfo = {
  code: string;
  isFinal: boolean;
  submittedAt: number | null;
  updatedAt: number;
};

type SubRowData = {
  studentId: string;
  clientId: string;
  studentUid: string;
  regNo: string | null;
  name: string;
  submission: SubmissionInfo | null;
};

const formatSubTime = (isFinal: boolean, submittedAt: number | null, updatedAt: number) =>
  isFinal
    ? submittedAt
      ? `Submitted ${format(submittedAt, "MMM d, HH:mm:ss")}`
      : "Submitted"
    : `Draft · saved ${format(updatedAt, "HH:mm:ss")}`;

const SubRow = memo(function SubRow({
  studentId,
  name,
  studentUid,
  regNo,
  timeLabel,
  selected,
  downloadable,
  onSelect,
  onDownload,
}: {
  studentId: string;
  name: string;
  studentUid: string;
  regNo: string | null;
  timeLabel: string;
  selected: boolean;
  downloadable: boolean;
  onSelect: (id: string) => void;
  onDownload: (id: string) => void;
}) {
  const displayId = regNo ?? studentUid;
  return (
    // Wrapper div (not a <button>) so the download action can live beside the
    // select area without nesting interactive elements.
    <div className={"cv-sub-row" + (selected ? " selected" : "")}>
      <button className="cv-sub-main" onClick={() => onSelect(studentId)}>
        <span className="cv-sub-name">
          {name}
          <span
            className="cv-sub-uid"
            title={
              regNo
                ? "Student's own ID — matches download filenames"
                : "Server-assigned unique ID — matches download filenames"
            }
          >
            {displayId}
          </span>
        </span>
        <span className="cv-sub-time">{timeLabel}</span>
      </button>
      {downloadable && (
        <button
          className="cv-sub-download"
          title={`Download ${name}'s code (${name}_${displayId}.txt)`}
          aria-label={`Download ${name}'s code`}
          onClick={() => onDownload(studentId)}
        >
          <Download size={14} />
        </button>
      )}
    </div>
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
        rows?: SubRowData[];
      }
    | undefined;

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Download All (ZIP) modal state
  const [zipOpen, setZipOpen] = useState(false);
  const [zipName, setZipName] = useState("");
  const [zipping, setZipping] = useState(false);

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

  // Downloads include every existing submission — final and draft alike,
  // regardless of room status (LIVE or CLOSED; the server applies no status
  // filter either). This is the single source of truth for BOTH the ZIP and
  // the per-student download buttons, so the two flows can never diverge.
  // Draft files are marked with a "-draft" filename suffix inside the ZIP so
  // the examiner can tell unfinished work from final submissions.
  const downloadRows = useMemo(
    () => rows.filter((r) => r.submission !== null),
    [rows],
  );

  // How many of the downloadable rows are final (grading-focused count for
  // the header sentence and the ZIP modal).
  const finalCount = useMemo(
    () => downloadRows.filter((r) => r.submission?.isFinal === true).length,
    [downloadRows],
  );

  const selected = useMemo(
    () => rows.find((r) => r.studentId === selectedId) ?? null,
    [rows, selectedId],
  );

  const safeZipBase = useMemo(
    () => sanitizeFilename(zipName) || "submissions",
    [zipName],
  );

  const room = data?.room;

  const openZipModal = useCallback(() => {
    if (!room) return;
    // Fresh default each time the modal opens (room name, sanitized).
    setZipName(defaultZipName(room.name));
    setZipOpen(true);
  }, [room]);

  const confirmZip = useCallback(async () => {
    if (downloadRows.length === 0) return;
    setZipping(true);
    try {
      // JSZip is lazy-loaded here so it never enters the initial bundle.
      const { default: JSZip } = await loadZipLib();
      const zip = new JSZip();
      const used = new Set<string>();
      for (const r of downloadRows) {
        let fname = submissionFileName(r.name, r.studentUid, r.regNo);
        // Draft submissions are marked so they can't be mistaken for final
        // work when the archive mixes both.
        if (!r.submission?.isFinal) {
          fname = fname.replace(/\.txt$/, "-draft.txt");
        }
        // Belt-and-braces against duplicate names inside the archive.
        let n = 2;
        while (used.has(fname)) fname = fname.replace(/\.txt$/, `-${n++}.txt`);
        used.add(fname);
        zip.file(fname, r.submission?.code ?? "");
      }
      const blob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
      });
      downloadBlob(blob, `${safeZipBase}.zip`);
      setZipOpen(false);
    } catch {
      // Archive building is local (no server state) — a failure is transient
      // and the examiner can simply retry, so stay on the modal.
    } finally {
      setZipping(false);
    }
  }, [downloadRows, safeZipBase]);

  const downloadOne = useCallback(
    (studentId: string) => {
      const r = rows.find((x) => x.studentId === studentId);
      if (!r?.submission) return;
      downloadBlob(
        new Blob([r.submission.code], { type: "text/plain;charset=utf-8" }),
        submissionFileName(r.name, r.studentUid, r.regNo),
      );
    },
    [rows],
  );

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
                  ? `${rows.length} of ${room.enrolledLimit} seats have students in them; ${finalCount} final ${finalCount === 1 ? "submission" : "submissions"} ready to grade or download.`
                  : "Loading room…"}
              </p>
            </div>
            {data !== undefined && !data.error && rows.length > 0 && (
              <button
                className="cv-btn cv-btn-secondary cv-btn-sm"
                onClick={openZipModal}
              >
                <Download size={14} /> Download All (ZIP)
              </button>
            )}
          </div>

          {data === undefined ? (
            <div className="cv-empty">Loading submissions…</div>
          ) : data.error ? (
            <div className="cv-empty">{data.error}</div>
          ) : rows.length === 0 ? (
            <div className="cv-empty">
              No submissions yet — this page fills in as students join and
              write code. It updates live, so you can leave it open during the
              exam and watch drafts save in real time.
            </div>
          ) : (
            <div className="cv-sub-grid">
              <div className="cv-card cv-sub-list">
                {rows.map((row) => (
                  <SubRow
                    key={row.studentId}
                    studentId={row.studentId}
                    name={row.name}
                    studentUid={row.studentUid}
                    regNo={row.regNo}
                    timeLabel={formatSubTime(
                      row.submission!.isFinal,
                      row.submission!.submittedAt,
                      row.submission!.updatedAt,
                    )}
                    selected={row.studentId === selectedId}
                    downloadable={row.submission !== null}
                    onSelect={handleSelect}
                    onDownload={downloadOne}
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

      {/* Download All (ZIP) — editable filename before building the archive */}
      <Modal
        open={zipOpen}
        onClose={() => setZipOpen(false)}
        title="Download all submissions"
        subtitle={
          downloadRows.length === finalCount
            ? `${finalCount} final ${finalCount === 1 ? "submission" : "submissions"} will be included.`
            : finalCount === 0
              ? `${downloadRows.length} draft ${downloadRows.length === 1 ? "submission" : "submissions"} will be included, marked as drafts in the ZIP.`
              : `${finalCount} final and ${downloadRows.length - finalCount} draft ${downloadRows.length - finalCount === 1 ? "submission" : "submissions"} will be included. Drafts are marked in their filenames.`
        }
        footer={
          <>
            <button
              className="cv-btn cv-btn-secondary"
              onClick={() => setZipOpen(false)}
              disabled={zipping}
            >
              Cancel
            </button>
            <button
              className="cv-btn cv-btn-primary"
              onClick={() => void confirmZip()}
              disabled={zipping}
            >
              {zipping ? (
                <>
                  <Loader2 size={15} className="animate-spin" /> Preparing…
                </>
              ) : (
                <>
                  <Download size={15} /> Download ZIP
                </>
              )}
            </button>
          </>
        }
      >
        <div className="cv-field">
          <label className="cv-label" htmlFor="zip-name">
            Zip file name
          </label>
          <input
            id="zip-name"
            className="cv-input"
            value={zipName}
            onChange={(e) => setZipName(e.target.value)}
            placeholder="submissions"
            disabled={zipping}
            autoFocus
          />
          <p className="cv-modal-sub" style={{ marginTop: 8, marginBottom: 0 }}>
            Saved as <strong>{safeZipBase}.zip</strong> — one file per student
            ({`{name}_${"{ID}"}`}.txt, e.g. Akash_24BCA10210.txt).
          </p>
        </div>
      </Modal>
    </CodeVenuePage>
  );
}
