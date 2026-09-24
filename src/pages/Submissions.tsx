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
import { useMutation, useQuery } from "convex/react";
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
          title={`Download ${name}'s PDF submission record (${name}_${displayId}.pdf)`}
          aria-label={`Download ${name}'s PDF submission record`}
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

/**
 * The full grading workflow for one room: student list + code viewer + PDF
 * downloads. Self-contained (owns its query, selection, and modal state) so
 * it can render standalone at /submissions/:roomId OR embedded inside the
 * exam detail page's Submissions tab — one implementation, never duplicated.
 *
 * EXPORT SECURITY MODEL: documents are generated SERVER-SIDE from the
 * authoritative stored submission. This page never builds files from query
 * data; it requests short-lived, single-use export tickets from the server
 * (which owner-checks every room+student pair) and downloads the PDFs from
 * the /export/submission route, which re-authenticates the examiner session
 * before the internal action generates bytes. A student can neither mint a
 * ticket nor reach the route's generator — nothing to spoof client-side.
 */
export function SubmissionsView({
  roomId,
  embedded = false,
}: {
  roomId: Id<"rooms">;
  /** Embedded: the parent page already shows room identity + a back link. */
  embedded?: boolean;
}) {
  const data = useQuery(api.exams.getRoomSubmissions, { roomId }) as
    | {
        error?: string;
        room?: import("@/convex/_generated/dataModel").Doc<"rooms">;
        rows?: SubRowData[];
      }
    | undefined;

  const requestTickets = useMutation(api.exams.requestSubmissionExportTickets);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Download All (ZIP) modal state
  const [zipOpen, setZipOpen] = useState(false);
  const [zipName, setZipName] = useState("");
  const [zipping, setZipping] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Auto-select the first row once data loads (see derived `selected` below —
  // no effect needed).
  const handleSelect = useCallback((id: string) => setSelectedId(id), []);

  // Memoized so the memos/callbacks below don't invalidate on every render
  // while the query streams (data identity changes only on real updates).
  const rows = useMemo(() => data?.rows ?? [], [data]);

  // Selection = the clicked student, falling back to the first row so the
  // code viewer is never empty on load. Derived, not an effect — no extra
  // render pass, and a removed row degrades to the list head automatically.
  const selected = useMemo(
    () =>
      rows.find((r) => r.studentId === selectedId) ?? rows[0] ?? null,
    [rows, selectedId],
  );

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

  const safeZipBase = useMemo(
    () => sanitizeFilename(zipName) || "submissions",
    [zipName],
  );

  const room = data?.room;

  const openZipModal = useCallback(() => {
    if (!room) return;
    // Fresh default each time the modal opens (room name, sanitized).
    setZipName(defaultZipName(room.name));
    setExportError(null);
    setZipOpen(true);
  }, [room]);

  /** One PDF: ticket (server owner-check) → authenticated download route. */
  const downloadOne = useCallback(
    async (studentId: string) => {
      const r = rows.find((x) => x.studentId === studentId);
      if (!r?.submission) return;
      setExportError(null);
      try {
        const { tickets } = await requestTickets({
          requests: [{ roomId, studentId: studentId as Id<"students"> }],
        });
        const ticket = tickets[0]?.ticket;
        if (!ticket) throw new Error("no ticket");
        const fname = submissionFileName(r.name, r.studentUid, r.regNo);
        // Browser handles the download via Content-Disposition; the route
        // re-authenticates the session and consumes the ticket single-use.
        window.location.assign(
          `/export/submission?ticket=${encodeURIComponent(ticket)}&filename=${encodeURIComponent(fname)}`,
        );
      } catch (err) {
        setExportError(
          err instanceof Error && err.message.includes("no ticket")
            ? "Could not start the download. Please try again."
            : "Could not start the download — your session may need a refresh.",
        );
      }
    },
    [rows, roomId, requestTickets],
  );

  const confirmZip = useCallback(async () => {
    if (downloadRows.length === 0) return;
    setZipping(true);
    setExportError(null);
    try {
      // 1) Server authorizes the WHOLE batch in one mutation (every
      //    room+student pair owner-checked; tickets expire in 90s).
      const { tickets } = await requestTickets({
        requests: downloadRows.map((r) => ({
          roomId,
          studentId: r.studentId as Id<"students">,
        })),
      });
      const byStudent = new Map(
        tickets.map((t) => [t.studentId as string, t.ticket as string]),
      );

      // 2) Build the archive from the route (which re-authenticates and
      //    generates each PDF from the authoritative record). A failed file
      //    is skipped, not fatal — the examiner sees what was included.
      const { default: JSZip } = await loadZipLib();
      const zip = new JSZip();
      const used = new Set<string>();
      let failed = 0;
      for (const r of downloadRows) {
        const ticket = byStudent.get(r.studentId);
        if (!ticket) {
          failed += 1;
          continue;
        }
        let fname = submissionFileName(r.name, r.studentUid, r.regNo);
        if (!r.submission?.isFinal) {
          fname = fname.replace(/\.pdf$/, "-draft.pdf");
        }
        // Belt-and-braces against duplicate names inside the archive.
        let n = 2;
        while (used.has(fname)) fname = fname.replace(/\.pdf$/, `-${n++}.pdf`);
        used.add(fname);
        try {
          const res = await fetch(
            `/export/submission?ticket=${encodeURIComponent(ticket)}&filename=${encodeURIComponent(fname)}`,
          );
          if (!res.ok) throw new Error(String(res.status));
          zip.file(fname, await res.arrayBuffer());
        } catch {
          failed += 1;
        }
      }
      if (used.size === 0) {
        throw new Error("no files generated");
      }
      const blob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
      });
      downloadBlob(blob, `${safeZipBase}.zip`);
      setZipOpen(false);
      if (failed > 0) {
        setExportError(
          `${used.size} of ${downloadRows.length} PDFs were included — ${failed} could not be generated. Reopen the modal to retry.`,
        );
      }
    } catch {
      setExportError(
        "Could not build the archive. Your session may need a refresh — try again.",
      );
    } finally {
      setZipping(false);
    }
  }, [downloadRows, safeZipBase, roomId, requestTickets]);

  return (
    <>
      {!embedded && (
        <Link to="/examiner-portal" className="cv-back-link">
          <ArrowLeft size={15} /> Back to portal
        </Link>
      )}

      <div className="cv-page-head" style={{ marginBottom: 26 }}>
        <div>
          {embedded ? (
            <p className="cv-sub" style={{ margin: 0 }}>
              {room
                ? `${rows.length} of ${room.enrolledLimit} seats have students in them; ${finalCount} final ${finalCount === 1 ? "submission" : "submissions"} ready to grade or download.`
                : "Loading room…"}
            </p>
          ) : (
            <h1 style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              {room ? room.name : "Submissions"}
              {room?.status === "LIVE" ? <LivePill /> : <ClosedPill />}
              {room && <CodePill code={room.code} />}
            </h1>
          )}
          {!embedded && (
            <p className="cv-sub">
              {room
                ? `${rows.length} of ${room.enrolledLimit} seats have students in them; ${finalCount} final ${finalCount === 1 ? "submission" : "submissions"} ready to grade or download.`
                : "Loading room…"}
            </p>
          )}
        </div>
        {data !== undefined && !data.error && rows.length > 0 && (
          <button
            className="cv-btn cv-btn-secondary cv-btn-sm"
            onClick={openZipModal}
          >
            <Download size={14} /> Download All (PDF ZIP)
          </button>
        )}
      </div>

      {exportError && (
        <div className="cv-banner cv-banner-warn" role="alert" style={{ marginBottom: 16 }}>
          {exportError}
        </div>
      )}

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
                onDownload={(id) => void downloadOne(id)}
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

      {/* Download All (ZIP) — editable filename before building the archive */}
      <Modal
        open={zipOpen}
        onClose={() => setZipOpen(false)}
        title="Download all submissions"
        subtitle={
          downloadRows.length === finalCount
            ? `${finalCount} final ${finalCount === 1 ? "submission" : "submissions"} will be included as server-generated PDF records.`
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
            Saved as <strong>{safeZipBase}.zip</strong> — one branded PDF
            record per student ({`{name}_${"{ID}"}`}.pdf, e.g.
            Akash_24BCA10210.pdf), generated from the stored submissions.
          </p>
        </div>
      </Modal>
    </>
  );
}

export default function Submissions() {
  const { roomId } = useParams<{ roomId: string }>();

  useEffect(() => {
    document.title = "Submissions — Code Venue";
  }, []);

  return (
    <CodeVenuePage quietBackground>
      <div className="cv-shell">
        <VenueHeader />
        <main className="cv-page-wrap">
          {roomId ? (
            <SubmissionsView roomId={roomId as Id<"rooms">} />
          ) : (
            <div className="cv-empty">
              This page needs a room.{" "}
              <Link to="/examiner-portal" className="cv-link">
                Back to your exams
              </Link>
            </div>
          )}
        </main>
      </div>
    </CodeVenuePage>
  );
}
