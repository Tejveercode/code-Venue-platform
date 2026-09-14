import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import { CodeVenuePage, Modal, VenueHeader } from "@/components/venue/ui";
import {
  ExaminerDashboard,
  type Counts,
} from "@/components/examiner/ExaminerDashboard";
import { RoomFormModal } from "@/components/examiner/RoomFormModal";
import { Check, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router";
import { getErrorMessage } from "@/lib/errors";

type Room = Doc<"rooms">;

/**
 * Examiner portal — application shell.
 *
 * Owns all data (queries, mutations) and all modals (create/edit room,
 * profile, delete, end-exam). The rendered dashboard is
 * `ExaminerDashboard`, the scan layer; deep per-exam work (monitoring,
 * prompt, settings) lives in `ExaminerExamDetail` at /examiner/exams/:roomId.
 */
export default function ExaminerPortal() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const examiner = useQuery(api.exams.getMyExaminer);
  const rooms = useQuery(api.exams.listMyRooms) ?? [];
  const roomIds = useMemo(() => rooms.map((r) => r._id), [rooms]);
  const counts = useQuery(
    api.exams.getRoomCounts,
    roomIds.length > 0 ? { roomIds } : "skip",
  ) as Counts | undefined;

  const ensureExaminer = useMutation(api.exams.ensureExaminer);
  const markWelcomed = useMutation(api.exams.markExaminerWelcomed);
  const updateName = useMutation(api.exams.updateExaminerName);
  const endRoomMutation = useMutation(api.exams.endRoom);
  const deleteRoomMutation = useMutation(api.exams.deleteRoom);

  // `examiner === null` means "authed user with no examiner row yet" — a
  // first-ever visit. `undefined` means the query is still loading.
  const [examinerEnsured, setExaminerEnsured] = useState(false);
  const ensureInFlight = useRef(false);

  // First-ever visit ⇒ new-user greeting. The `welcomed` flag is
  // backend-computed so it survives reloads; greetedAsNew latches ONCE for
  // the whole session (when the query first reports welcomed === false) so
  // markExaminerWelcomed can't swap the heading mid-visit. Latched as a
  // render-phase adjustment on the query result — no effect cascade.
  const [greetedAsNew, setGreetedAsNew] = useState(false);
  if (
    !greetedAsNew &&
    examiner !== undefined &&
    examiner !== null &&
    examiner.welcomed === false
  ) {
    setGreetedAsNew(true);
  }

  useEffect(() => {
    document.title = "Examiner Portal — Code Venue";
  }, []);

  useEffect(() => {
    if (examiner === null && !examinerEnsured && !ensureInFlight.current) {
      ensureInFlight.current = true;
      setExaminerEnsured(true);
      void ensureExaminer({})
        .catch(() => {
          setExaminerEnsured(false);
        })
        .finally(() => {
          ensureInFlight.current = false;
        });
    }
  }, [examiner, examinerEnsured, ensureExaminer]);

  // Display the new-user greeting briefly, then flag it server-side so
  // future visits greet with "Welcome back".
  useEffect(() => {
    if (
      examiner !== undefined &&
      examiner !== null &&
      examiner.welcomed === false
    ) {
      const t = setTimeout(() => {
        void markWelcomed({}).catch(() => {
          // Non-fatal: the greeting just shows again next visit.
        });
      }, 4000);
      return () => clearTimeout(t);
    }
  }, [examiner, markWelcomed]);

  // Create/Edit Room modal state. The modal remounts per target room via
  // `key` (see render), so it seeds itself — the portal only tracks open/edit.
  const [formOpen, setFormOpen] = useState(false);
  const [editRoom, setEditRoom] = useState<Room | null>(null);

  // End-exam confirmation state
  const [endRoom, setEndRoom] = useState<Room | null>(null);
  const [ending, setEnding] = useState(false);

  // Profile (Account Settings) state — the only way to change name later.
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  // Delete-room confirmation state (permanent, data included)
  const [deleteRoom, setDeleteRoom] = useState<Room | null>(null);
  const [deleting, setDeleting] = useState(false);

  const openForm = useCallback((room?: Room) => {
    setEditRoom(room ?? null);
    setFormOpen(true);
  }, []);

  const closeForm = useCallback(() => {
    setFormOpen(false);
    setEditRoom(null);
  }, []);

  const confirmEnd = async () => {
    if (!endRoom) return;
    setEnding(true);
    try {
      await endRoomMutation({ roomId: endRoom._id });
      setEndRoom(null);
    } catch {
      // keep the dialog open on failure
    } finally {
      setEnding(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteRoom) return;
    setDeleting(true);
    try {
      await deleteRoomMutation({ roomId: deleteRoom._id });
      // listMyRooms re-subscribes; the room disappears immediately.
      setDeleteRoom(null);
    } catch {
      // keep the dialog open on failure
    } finally {
      setDeleting(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate("/");
    } catch {
      // stay on the portal; RequireAuth will re-guard on next navigation
    }
  };

  // Profile modal — prefill from the live examiner record each time it opens.
  const openProfile = useCallback(() => {
    setProfileName(examiner?.name ?? "");
    setProfileError(null);
    setProfileSaved(false);
    setProfileOpen(true);
  }, [examiner?.name]);

  const submitProfile = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setProfileError(null);
    const next = profileName.trim();
    if (!next) {
      setProfileError("Please enter your name.");
      return;
    }
    if (next === examiner?.name) {
      setProfileOpen(false);
      return;
    }
    setSavingProfile(true);
    try {
      await updateName({ name: next });
      setProfileSaved(true);
      setTimeout(() => setProfileOpen(false), 800);
    } catch (err) {
      setProfileError(getErrorMessage(err, "Something went wrong. Please try again."));
    } finally {
      setSavingProfile(false);
    }
  };

  const isNewUser =
    examiner === null || greetedAsNew || examiner?.welcomed === false;
  const displayName = examiner?.name ?? (user?.name ?? "examiner");

  return (
    <CodeVenuePage>
      <div className="cv-shell">
        <VenueHeader
          actions={
            <button
              className="cv-btn cv-btn-secondary cv-btn-sm"
              onClick={() => void handleSignOut()}
            >
              Sign Out
            </button>
          }
        />

        <ExaminerDashboard
          examinerName={displayName}
          greetingNew={isNewUser}
          rooms={rooms}
          counts={counts}
          onCreate={() => openForm()}
          onEnd={setEndRoom}
          onProfile={openProfile}
        />
      </div>

      {/* Create / Edit Room modal — shared component; `key` re-seeds per room. */}
      <RoomFormModal
        key={editRoom?._id ?? "new"}
        open={formOpen}
        editRoom={editRoom}
        examinerRooms={rooms}
        onClose={closeForm}
      />

      {/* Profile / Account Settings — the only rename path after signup */}
      <Modal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        title="Profile"
        subtitle={
          examiner?.email
            ? `Signed in as ${examiner.email}`
            : "Your examiner identity"
        }
      >
        <form onSubmit={submitProfile}>
          {profileError && <span className="cv-error">{profileError}</span>}
          <div className="cv-field">
            <label className="cv-label" htmlFor="profile-name">
              Display name
            </label>
            <input
              id="profile-name"
              className="cv-input"
              value={profileName}
              onChange={(e) => {
                setProfileName(e.target.value);
                setProfileSaved(false);
              }}
              placeholder="Ada Lovelace"
              autoComplete="name"
              maxLength={80}
              disabled={savingProfile}
            />
          </div>
          <div className="cv-modal-actions">
            <button
              type="button"
              className="cv-btn cv-btn-secondary"
              onClick={() => setProfileOpen(false)}
              disabled={savingProfile}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="cv-btn cv-btn-primary"
              disabled={savingProfile || !profileName.trim()}
            >
              {savingProfile ? (
                <>
                  <Loader2 size={15} className="animate-spin" /> Saving…
                </>
              ) : profileSaved ? (
                <>
                  <Check size={15} /> Saved
                </>
              ) : (
                "Save name"
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete room confirmation — permanent, includes all student data */}
      <Modal
        open={deleteRoom !== null}
        onClose={() => setDeleteRoom(null)}
        title="Delete this room?"
        footer={
          <>
            <button
              className="cv-btn cv-btn-secondary"
              onClick={() => setDeleteRoom(null)}
              disabled={deleting}
            >
              Cancel
            </button>
            <button
              className="cv-btn cv-btn-danger cv-end-confirm"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <Loader2 size={15} className="animate-spin" /> Deleting…
                </>
              ) : (
                "Delete Permanently"
              )}
            </button>
          </>
        }
      >
        {deleteRoom && (
          <p className="cv-modal-sub" style={{ marginBottom: 0 }}>
            Delete '{deleteRoom.name}'? This permanently removes the room, its
            question, and all {counts?.[deleteRoom._id]?.joined ?? 0} student
            records — drafts and final submissions alike. This cannot be undone.
          </p>
        )}
      </Modal>

      {/* End exam confirmation */}
      <Modal
        open={endRoom !== null}
        onClose={() => setEndRoom(null)}
        title="End this exam?"
        subtitle={
          endRoom
            ? `End '${endRoom.name}'? Once closed, this room cannot be reopened.`
            : undefined
        }
        footer={
          <>
            <button
              className="cv-btn cv-btn-secondary"
              onClick={() => setEndRoom(null)}
              disabled={ending}
            >
              Cancel
            </button>
            <button
              className="cv-btn cv-btn-danger cv-end-confirm"
              onClick={confirmEnd}
              disabled={ending}
            >
              {ending ? (
                <>
                  <Loader2 size={15} className="animate-spin" /> Ending…
                </>
              ) : (
                "End Exam"
              )}
            </button>
          </>
        }
      >
        {endRoom && (
          <p className="cv-modal-sub" style={{ marginBottom: 0 }}>
            Students still in the room will be locked out immediately. Their
            most recent autosave stays available for grading.
          </p>
        )}
      </Modal>
    </CodeVenuePage>
  );
}
