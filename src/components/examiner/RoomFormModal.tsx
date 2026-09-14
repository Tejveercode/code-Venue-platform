import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { Modal } from "@/components/venue/ui";
import { getErrorMessage } from "@/lib/errors";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useMutation } from "convex/react";

type Room = Doc<"rooms">;

type RoomFormState = {
  name: string;
  prompt: string;
  durationMinutes: string;
  enrolledLimit: string;
  violationLimit: string;
};

const EMPTY_FORM: RoomFormState = {
  name: "",
  prompt: "",
  durationMinutes: "60",
  enrolledLimit: "30",
  violationLimit: "",
};

export function roomToForm(room: Room): RoomFormState {
  return {
    name: room.name,
    prompt: room.prompt,
    durationMinutes: String(room.durationMinutes),
    enrolledLimit: String(room.enrolledLimit),
    // Blank = zero-tolerance (server treats 0/absent identically).
    violationLimit: room.violationLimit ? String(room.violationLimit) : "",
  };
}

/**
 * Create/Edit Room modal — shared by the dashboard and the exam detail
 * page's Settings tab. Self-contained: owns validation, the client-side
 * duplicate-name pre-check (server re-checks authoritatively), and the
 * create/update mutations.
 */
export function RoomFormModal({
  open,
  editRoom,
  examinerRooms,
  onClose,
}: {
  open: boolean;
  editRoom: Room | null;
  examinerRooms: Room[];
  onClose: () => void;
}) {
  const createRoom = useMutation(api.exams.createRoom);
  const updateRoom = useMutation(api.exams.updateRoom);

  const [form, setForm] = useState<RoomFormState>(
    editRoom ? roomToForm(editRoom) : EMPTY_FORM,
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Seeding contract: the parent mounts this modal with
  // `key={editRoom?._id ?? "new"}` and only while open, so `form`
  // initializes from the correct room exactly once. Reset on close so a
  // remount for a different room never sees stale text.
  useEffect(() => {
    if (!open) {
      setForm(editRoom ? roomToForm(editRoom) : EMPTY_FORM);
      setFormError(null);
    }
  }, [open, editRoom]);

  const submitForm = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError(null);
    const duration = parseInt(form.durationMinutes, 10);
    const enrolled = parseInt(form.enrolledLimit, 10);
    if (!form.name.trim()) return setFormError("Room name is required.");
    if (!form.prompt.trim())
      return setFormError("Question / problem statement is required.");
    if (!Number.isFinite(duration) || duration < 1)
      return setFormError("Duration must be at least 1 minute.");
    if (!Number.isFinite(enrolled) || enrolled < 1)
      return setFormError("Enrolled students must be at least 1.");

    const violationLimitRaw = form.violationLimit.trim();
    let violationLimit: number | undefined;
    if (violationLimitRaw !== "") {
      violationLimit = parseInt(violationLimitRaw, 10);
      if (!Number.isFinite(violationLimit) || violationLimit < 0)
        return setFormError(
          "Violation limit must be 0 or more (blank = zero-tolerance).",
        );
    }

    // Instant client-side duplicate-name check (case-insensitive, scoped to
    // this examiner's rooms; rename ignores the room being edited). The
    // server re-checks authoritatively — this is only for immediate feedback.
    const nameCollision = examinerRooms.some(
      (r) =>
        r._id !== editRoom?._id &&
        r.name.trim().toLowerCase() === form.name.trim().toLowerCase(),
    );
    if (nameCollision) {
      return setFormError(
        `You already have a room named "${form.name.trim()}". Choose a different name.`,
      );
    }

    setSaving(true);
    try {
      if (editRoom) {
        await updateRoom({
          roomId: editRoom._id,
          name: form.name.trim(),
          prompt: form.prompt.trim(),
          durationMinutes: duration,
          enrolledLimit: enrolled,
          violationLimit,
        });
      } else {
        await createRoom({
          name: form.name.trim(),
          prompt: form.prompt.trim(),
          durationMinutes: duration,
          enrolledLimit: enrolled,
          violationLimit,
        });
      }
      onClose();
    } catch (err) {
      setFormError(getErrorMessage(err, "Something went wrong. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editRoom ? "Edit Room" : "Create New Room"}
      subtitle={
        editRoom
          ? `Editing "${editRoom.name}" — changes apply immediately for students.`
          : "Students join with the generated code and see exactly the question you write."
      }
    >
      <form onSubmit={submitForm}>
        {formError && <span className="cv-error">{formError}</span>}
        <div className="cv-field">
          <label className="cv-label" htmlFor="room-name">
            Room Name
          </label>
          <input
            id="room-name"
            className="cv-input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Intro to Algorithms — Midterm"
            disabled={saving}
          />
        </div>
        <div className="cv-field">
          <label className="cv-label" htmlFor="room-prompt">
            Question / Problem Statement
          </label>
          <textarea
            id="room-prompt"
            className="cv-textarea cv-textarea-tall"
            rows={9}
            value={form.prompt}
            onChange={(e) => setForm({ ...form, prompt: e.target.value })}
            placeholder="Write the exact problem students will see above their editor…"
            disabled={saving}
          />
        </div>
        <div className="cv-field-row">
          <div className="cv-field">
            <label className="cv-label" htmlFor="room-duration">
              Duration in minutes
            </label>
            <input
              id="room-duration"
              className="cv-input"
              type="number"
              min={1}
              value={form.durationMinutes}
              onChange={(e) =>
                setForm({ ...form, durationMinutes: e.target.value })
              }
              disabled={saving}
            />
          </div>
          <div className="cv-field">
            <label className="cv-label" htmlFor="room-enrolled">
              Enrolled Students
            </label>
            <input
              id="room-enrolled"
              className="cv-input"
              type="number"
              min={1}
              value={form.enrolledLimit}
              onChange={(e) =>
                setForm({ ...form, enrolledLimit: e.target.value })
              }
              disabled={saving}
            />
          </div>
        </div>
        <div className="cv-field">
          <label className="cv-label" htmlFor="room-violation-limit">
            Tab-switch / copy warnings <span>(optional)</span>
          </label>
          <input
            id="room-violation-limit"
            className="cv-input"
            type="number"
            min={0}
            value={form.violationLimit}
            onChange={(e) =>
              setForm({ ...form, violationLimit: e.target.value })
            }
            placeholder="Leave blank to flag any tab-switch or copy immediately"
            disabled={saving}
          />
          <p className="cv-field-hint">
            During the exam, Code Venue records when a student switches tabs,
            pastes into, or copies out of the code editor (it cannot block
            these). Leave blank or 0: the first switch flags the student to
            you, with no warning shown to them. Enter a number (e.g. 3): the
            student gets that many on-screen warnings, then their exam is
            auto-submitted with their latest code.
          </p>
        </div>
        <div className="cv-modal-actions">
          <button
            type="button"
            className="cv-btn cv-btn-secondary"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="cv-btn cv-btn-primary"
            disabled={saving}
          >
            {saving ? (
              <>
                <Loader2 size={15} className="animate-spin" /> Saving…
              </>
            ) : editRoom ? (
              "Save Changes"
            ) : (
              "Create Room"
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
