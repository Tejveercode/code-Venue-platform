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
import { useAuthToken } from "@convex-dev/auth/react";
import type { Id } from "@/convex/_generated/dataModel";
import {
  defaultZipName,
  downloadBlob,
  exportFailureMessage,
  exportUrl,
  loadZipLib,
  sanitizeFilename,
  submissionFolderName,
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
          title={`Download ${name}'s submission file`}
          aria-label={`Download ${name}'s submission file`}
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
 * The examiner's review surface for one room: read-only code viewer +
 * original-file downloads. Self-contained (owns its query, selection, and
 * modal state) so it can render standalone at /submissions/:roomId OR
 * embedded inside the exam detail page's Submissions tab — one
 * implementation, never duplicated. This page only ever VIEWS submissions
 * (no editing, no grading, no feedback anywhere).
 *
 * DOWNLOAD SECURITY MODEL: files are served SERVER-SIDE from the
 * authoritative stored submission. This page never builds files from query
 * data; it requests short-lived, single-use export tickets from the server
 * (which owner-checks every room+student pair AND computes each file's
 * name), then fetches /export/submission on the CONVEX deployment host with
 * the examiner's JWT in an Authorization header. The route re-authenticates
 * the session, the ticket is consumed single-use, and the internal action
 * re-verifies ownership before returning the submission's ORIGINAL bytes.
 * A student can neither mint a ticket nor reach the route — nothing to
 * spoof client-side, and swapping IDs in a URL yields a 404.
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
  // The examiner's Convex Auth JWT — forwarded as `Authorization: Bearer` to
  // the /export/submission HTTP route, which re-authenticates the session
  // server-side (a bare navigation sends no header and gets a deliberate 404).
  const authToken = useAuthToken();

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
  // Drafts are marked with a "-draft" filename suffix (computed SERVER-side
  // with the ticket, so the marker cannot be spoofed or drift) so the
  // examiner can tell unfinished work from final submissions.
  const downloadRows = useMemo(
    () => rows.filter((r) => r.submission !== null),
    [rows],
  );

  // How many of the downloadable rows are final (for the header sentence
  // and the ZIP modal).
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

  /** One ORIGINAL file: ticket (server owner-check) → authenticated download route. */
  /** One ORIGINAL file: ticket (server owner-check) → authenticated fetch.
   *  The response is saved as a Blob with the SERVER-COMPUTED filename —
   *  never a navigation, so a wrong origin can no longer 404 the page. */
  const downloadOne = useCallback(
    async (studentId: string) => {
      const r = rows.find((x) => x.studentId === studentId);
      if (!r?.submission) return;
      setExportError(null);
      try {
        const { tickets } = await requestTickets({
          requests: [{ roomId, studentId: studentId as Id<"students"> }],
        });
        const t = tickets[0];
        if (!t?.ticket) throw new Error("no ticket");
        // Absolute Convex-site URL + JWT header; the route re-authenticates,
        // consumes the ticket single-use, and re-verifies ownership before
        // returning the submission's original bytes.
        const { url, init } = exportUrl(t.ticket, authToken);
        const res = await fetch(url, init);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        // The filename comes from the server (t.filename), computed from the
        // authoritative rows — the client never decides what the file is called.
        downloadBlob(blob, t.filename);
      } catch (err) {
        // Rule 8 (do not hide failures): the raw error goes to the console
        // (status, CORS block, or server cause), and the banner text is
        // classified by the actual failure — 401 is the ONLY case that gets
        // session language. A blocked/broken request (TypeError) can never
        // legitimately say "refresh your session".
        console.error("[download] individual download failed:", err);
        setExportError(
          err instanceof Error && err.message.includes("no ticket")
            ? "Could not start the download. Please try again."
            : exportFailureMessage(err),
        );
      }
    },
    [rows, roomId, requestTickets, authToken],
  );

  const confirmZip = useCallback(async () => {
    if (downloadRows.length === 0) return;
    setZipping(true);
    setExportError(null);
    try {
      // 1) Server authorizes the WHOLE batch in one mutation (every
      //    room+student pair owner-checked; tickets expire in 90s; each
      //    ticket carries the server-computed filename).
      const { tickets } = await requestTickets({
        requests: downloadRows.map((r) => ({
          roomId,
          studentId: r.studentId as Id<"students">,
        })),
      });
      const byStudent = new Map(
        tickets.map((t) => [t.studentId as string, t]),
      );

      // 2) Build the archive from the route (which re-authenticates and
      //    returns each submission's ORIGINAL bytes). A failed file is
      //    skipped, not fatal — the examiner sees what was included.
      //
      //    STRUCTURE: {roomName}/{studentID-Name}/{file}.txt — one folder per
      //    student (their own ID, so same-named students never collide), the
      //    file named from the server. Folders nest under the exam name.
      const { default: JSZip } = await loadZipLib();
      const zip = new JSZip();
      const examFolder = safeZipBase.replace(/-submissions$/, "") || "exam";
      const used = new Set<string>();
      let added = 0;
      let failed = 0;
      for (const r of downloadRows) {
        const t = byStudent.get(r.studentId);
        if (!t?.ticket) {
          failed += 1;
          continue;
        }
        const folder = `${examFolder}/${submissionFolderName(r.name, r.studentUid, r.regNo)}`;
        let fname = t.filename;
        // Belt-and-braces against duplicate paths inside the archive.
        let n = 2;
        while (used.has(`${folder}/${fname}`))
          fname = fname.replace(/(\.txt)?$/, `-${n++}.txt`);
        used.add(`${folder}/${fname}`);
        try {
          const { url, init } = exportUrl(t.ticket, authToken);
          const res = await fetch(url, init);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const bytes = await res.arrayBuffer();
          // Guard against a pathologically small response: the route always
          // returns the stored code as UTF-8 bytes, so 0 bytes means the
          // response was wrong, not that the student submitted an empty file.
          if (bytes.byteLength === 0) throw new Error("HTTP 0 bytes");
          zip.file(`${folder}/${fname}`, bytes);
          added += 1;
        } catch (err) {
          console.error(`[download] ZIP file failed: ${r.name} (${fname})`, err);
          failed += 1;
        }
      }
      // The empty-archive guard must count files ACTUALLY ADDED, not paths
      // reserved — this check previously passed when every fetch failed,
      // producing a valid-looking ZIP with zero student files (prod bug #2).
      if (added === 0) {
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
          `${added} of ${downloadRows.length} submission files were included — ${failed} could not be downloaded. Reopen the modal to retry.`,
        );
      }
    } catch (err) {
      // Honest failure reporting (rule 8): log the real cause, then classify.
      console.error("[download] ZIP build failed:", err);
      setExportError(exportFailureMessage(err));
    } finally {
      setZipping(false);
    }
  }, [downloadRows, safeZipBase, roomId, requestTickets, authToken]);

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
            <Download size={14} /> Download All (ZIP)
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
            ? `${finalCount} final ${finalCount === 1 ? "submission" : "submissions"} will be included as original files.`
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
            Saved as <strong>{safeZipBase}.zip</strong> — the students'
            original submission files, one folder per student (e.g.
            {"{exam}/24BCA10210-Akash/…"}), exactly as stored.
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
