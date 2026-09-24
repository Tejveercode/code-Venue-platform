import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  mutation,
  query,
  QueryCtx,
  MutationCtx,
  internalMutation,
  internalQuery,
  internalAction,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import {
  MAX_LIST_ROOMS,
  MAX_ROOM_IDS_PER_QUERY,
  AUTOSAVE_MIN_INTERVAL_MS,
  MAX_CLIENT_ID,
  ROOM_CODE_PATTERN,
  MAX_VIOLATION_EVENTS_READ,
  MAX_REJOIN_TIMESTAMPS_RETURNED,
} from "./limits";
import {
  validateRoomName,
  validateRoomPrompt,
  validateDuration,
  validateEnrolledLimit,
  validateRoomCode,
  validateStudentName,
  validateStudentId,
  validateClientId,
  validateBrowserId,
  validateSubmissionCode,
  validateRevision,
  validateExaminerName,
  validateViolationLimit,
} from "./validation";
import { enforceRateLimit } from "./rateLimits";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get the examiner record for the current signed-in user (or null). */
export async function getCurrentExaminer(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  return await ctx.db
    .query("examiners")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

function generateRoomCode(): string {
  // crypto.getRandomValues, not Math.random: room codes are the ONLY thing
  // gating who can join a live exam (the join mutation is public). Math.random
  // is not a CSPRNG — its output is predictable from a few observed samples,
  // which would let an attacker predict future codes and sit in exams they
  // were never invited to. 4 digits stay (product format "CV-####"), so the
  // per-code join rate limit in rateLimits.ts remains the brute-force brake;
  // the generator just stops helping an attacker guess.
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  const digits = bytes[0]! % 10000;
  return `CV-${digits.toString().padStart(4, "0")}`;
}

/** Random 128-bit hex string (works in the Convex V8 runtime). */
function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Public, human-friendly student UID (e.g. "S-7F3K2Q"). Ambiguous glyphs
 * (0/O, 1/I) are excluded from the alphabet. Uniqueness is enforced against
 * the by_uid index with retry.
 */
const UID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I
async function generateStudentUid(ctx: MutationCtx): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    let suffix = "";
    for (let i = 0; i < 6; i++) {
      const idx = crypto.getRandomValues(new Uint8Array(1))[0]! % UID_ALPHABET.length;
      suffix += UID_ALPHABET[idx];
    }
    const uid = `S-${suffix}`;
    const taken = await ctx.db
      .query("students")
      .withIndex("by_uid", (q) => q.eq("studentUid", uid))
      .unique();
    if (!taken) return uid;
  }
  throw new Error("Could not generate a unique student UID");
}

async function requireExaminer(ctx: MutationCtx) {
  const examiner = await getCurrentExaminer(ctx);
  if (!examiner) {
    throw new ConvexError("Only examiners can do this");
  }
  return examiner;
}

/**
 * Load a room and confirm it belongs to the current examiner. Every examiner
 * mutation/query that touches a room MUST go through this — hiding a button
 * in the UI is not access control.
 */
async function requireOwnedRoom(
  ctx: QueryCtx | MutationCtx,
  roomId: Id<"rooms">,
  examinerId: Id<"examiners">,
) {
  const room = await ctx.db.get(roomId);
  if (!room || room.examinerId !== examinerId) return null;
  return room;
}

/**
 * Enforce case-insensitive room-name uniqueness within one examiner's rooms
 * (create + rename). Throws a user-facing ConvexError the form displays
 * inline. `ignoreRoomId` exempts the room being renamed, so saving a room
 * with its own current name is never a false collision.
 */
async function assertUniqueRoomName(
  ctx: MutationCtx,
  examinerId: Id<"examiners">,
  name: string,
  ignoreRoomId?: Id<"rooms">,
): Promise<void> {
  const needle = name.trim().toLowerCase();
  const owned = await ctx.db
    .query("rooms")
    .withIndex("by_examiner", (q) => q.eq("examinerId", examinerId))
    .collect();
  const clash = owned.some(
    (r) => r._id !== ignoreRoomId && r.name.trim().toLowerCase() === needle,
  );
  if (clash) {
    throw new ConvexError(
      `You already have a room named "${name.trim()}". Choose a different name.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Examiners
// ---------------------------------------------------------------------------

/**
 * Looks like an email address (e.g. the raw identifier Convex Auth may copy
 * into users.name for OTP accounts). Such a value must never be shown to the
 * examiner as their name.
 */
function isEmailLike(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * Provision the signed-in user as an examiner (idempotent).
 *
 * Called on portal arrival. For returning examiners this is a no-op — the
 * stored name is NEVER touched here (name changes go exclusively through
 * updateExaminerName). Only two writes can happen:
 *   1. Row creation, when the user has none yet (name resolution below).
 *   2. Legacy self-heal: a row (or users.name) still holding an email-like
 *      value from the pre-name-prompt era gets the real stored name.
 *
 * Name resolution for a NEW row:
 *   1. users.name — but ONLY when it isn't email-like (Convex Auth copies
 *      the OTP email identifier into users.name; that must never be shown).
 *   2. email local-part — last resort. The real name arrives moments later
 *      through the post-verification name prompt (setExaminerName).
 *
 * Duplicate examiner rows for one user are impossible: the by_user unique
 * index read + insert happen inside one serialized Convex transaction, so a
 * concurrent second insert retries, sees the row, and no-ops.
 *
 * Returns `{ examinerId, isNew }`; new rows always start with welcomed:
 * false so the portal can greet first-time users differently.
 */
export const ensureExaminer = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new ConvexError("Not authenticated");
    const user = await ctx.db.get(userId);
    const email = user?.email ?? `guest-${userId.slice(0, 8)}@codevenue.local`;

    const existing = await ctx.db
      .query("examiners")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing) {
      // Self-heal examiners whose name was previously the email fallback
      // (or an email-like value) once a real name is available.
      const realName =
        user?.name && !isEmailLike(user.name) ? user.name : undefined;
      if (
        realName &&
        realName !== existing.name &&
        (isEmailLike(existing.name) || existing.name === email.split("@")[0])
      ) {
        await ctx.db.patch(existing._id, { name: realName });
      }
      return { examinerId: existing._id, isNew: false };
    }

    const name =
      user?.name && !isEmailLike(user.name)
        ? user.name
        : email.split("@")[0];
    const examinerId = await ctx.db.insert("examiners", {
      userId,
      name,
      email,
      createdAt: Date.now(),
      welcomed: false,
    });
    return { examinerId, isNew: true };
  },
});

/**
 * The ONE-TIME post-verification name prompt (account creation). Called from
 * /auth after a brand-new email verifies.
 *
 * CREATION-SAFE: if an examiner record already exists for this user (i.e.
 * this was actually a returning examiner, or the row was provisioned in a
 * parallel tab), the stored name is NEVER overwritten — an email-like legacy
 * fallback is the only thing it may replace. A returning examiner can
 * therefore never lose their name by riding through the prompt.
 */
export const setExaminerName = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const name = validateExaminerName(args.name);
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new ConvexError("Not authenticated");

    const user = await ctx.db.get(userId);
    const email = user?.email ?? `guest-${userId.slice(0, 8)}@codevenue.local`;

    const examiner = await ctx.db
      .query("examiners")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (examiner) {
      // Row already exists: replace only an email-like legacy fallback.
      if (isEmailLike(examiner.name) && examiner.name !== name) {
        await ctx.db.patch(examiner._id, { name });
      }
      if (
        user &&
        isEmailLike(user.name ?? "") &&
        user.name !== name
      ) {
        await ctx.db.patch(user._id, { name });
      }
      return { ok: true, created: false };
    }

    // Genuinely new examiner row — this is the account-creation write.
    if (user) {
      await ctx.db.patch(user._id, { name });
    }
    await ctx.db.insert("examiners", {
      userId,
      name,
      email,
      createdAt: Date.now(),
      welcomed: false,
    });
    return { ok: true, created: true };
  },
});

/**
 * Deliberate rename — the ONLY way an existing examiner's name changes after
 * signup. Called from the portal's Profile (Account Settings) modal.
 */
export const updateExaminerName = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const name = validateExaminerName(args.name);
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new ConvexError("Not authenticated");

    const examiner = await ctx.db
      .query("examiners")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!examiner) throw new ConvexError("Examiner profile not found");

    if (examiner.name !== name) {
      await ctx.db.patch(examiner._id, { name });
    }
    const user = await ctx.db.get(userId);
    if (user && user.name !== name) {
      await ctx.db.patch(user._id, { name });
    }
    return { ok: true };
  },
});

/**
 * Auth-flow decision point, called by /auth after verification (and by an
 * already-authenticated visitor landing on /auth): does this account still
 * need its one-time name prompt?
 *
 * The only signal is the EXISTENCE of an examiner record — never its name —
 * so a returning examiner skips the prompt and a new account sees it exactly
 * once. Deliberately a mutation: reactive queries can briefly serve results
 * computed before the fresh session established, which would flash the name
 * prompt at returning examiners.
 */
export const signInNextStep = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new ConvexError("Not authenticated");
    const examiner = await ctx.db
      .query("examiners")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    return { needsName: examiner === null };
  },
});

/** Mark that the examiner has seen their first-visit welcome greeting. */
export const markExaminerWelcomed = mutation({
  args: {},
  handler: async (ctx) => {
    const examiner = await getCurrentExaminer(ctx);
    if (!examiner || examiner.welcomed === true) return { ok: true };
    await ctx.db.patch(examiner._id, { welcomed: true });
    return { ok: true };
  },
});

/** Current examiner record for the portal header. */
export const getMyExaminer = query({
  args: {},
  handler: async (ctx) => {
    return await getCurrentExaminer(ctx);
  },
});

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

export const createRoom = mutation({
  args: {
    name: v.string(),
    prompt: v.string(),
    durationMinutes: v.number(),
    enrolledLimit: v.number(),
    violationLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const examiner = await requireExaminer(ctx);

    // Rate limit room creation per examiner (spam / resource cap).
    await enforceRateLimit(ctx, "createRoomPerExaminer", {
      key: examiner._id,
      message: "You've created a lot of rooms recently.",
    });

    // Validation — the UI checks too, but never trust the client.
    const name = validateRoomName(args.name);
    await assertUniqueRoomName(ctx, examiner._id, name);
    const prompt = validateRoomPrompt(args.prompt);
    const durationMinutes = validateDuration(args.durationMinutes);
    const enrolledLimit = validateEnrolledLimit(args.enrolledLimit);
    const violationLimit = validateViolationLimit(args.violationLimit);

    // Server-side CV-#### code, retried on collision (10 attempts).
    let code = "";
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = generateRoomCode();
      const taken = await ctx.db
        .query("rooms")
        .withIndex("by_code", (q) => q.eq("code", candidate))
        .unique();
      if (!taken) {
        code = candidate;
        break;
      }
    }
    if (code === "") throw new Error("Could not generate a unique room code");

    const now = Date.now();
    const roomId = await ctx.db.insert("rooms", {
      code,
      name,
      prompt,
      durationMinutes,
      status: "LIVE",
      enrolledLimit,
      startedAt: now,
      examinerId: examiner._id,
      ...(violationLimit > 0 ? { violationLimit } : {}),
    });
    return { roomId, code };
  },
});

/**
 * All rooms owned by the current examiner, newest first. Uses the by_examiner
 * index (no full-table filter) and is capped so a stale account with thousands
 * of rooms can't stall the dashboard.
 */
export const listMyRooms = query({
  args: {},
  handler: async (ctx) => {
    const examiner = await getCurrentExaminer(ctx);
    if (!examiner) return [];
    const rooms = await ctx.db
      .query("rooms")
      .withIndex("by_examiner", (q) => q.eq("examinerId", examiner._id))
      .order("desc")
      .take(MAX_LIST_ROOMS);
    return rooms;
  },
});

/**
 * Joined + final-submitted + flagged counts for a list of rooms (live via
 * subscription).
 *
 * Ownership first: unknown or foreign roomIds are simply omitted — this is a
 * public-shaped query, so the examiner check is the only access control.
 *
 * Batching: per room we run exactly two indexed reads (students by_room,
 * submissions by_room) instead of the previous pattern that issued one
 * by_student query PER STUDENT per room. Worst case for a full dashboard:
 * 2 × MAX_COUNT_ROOMS indexed queries. Flagged/auto-submitted come free from
 * the same students read — monitoring tallies live on the student rows.
 */
export const getRoomCounts = query({
  args: { roomIds: v.array(v.id("rooms")) },
  handler: async (ctx, args) => {
    const examiner = await getCurrentExaminer(ctx);
    if (!examiner) return {};

    // Hard capacity guard, not a silent drop: MAX_ROOM_IDS_PER_QUERY bounds
    // the batch, and anything past it is a loud ConvexError rather than
    // counts that quietly go missing from the dashboard (the prior slice()
    // silently returned {} for rooms 51+ — stale zeros the teacher could
    // never detect). The caller batches roomIds to stay under the cap.
    if (args.roomIds.length > MAX_ROOM_IDS_PER_QUERY) {
      throw new ConvexError(
        `Too many rooms requested (${args.roomIds.length} > ${MAX_ROOM_IDS_PER_QUERY}).`,
      );
    }
    const roomIds = args.roomIds;
    const counts: Record<
      string,
      {
        joined: number;
        submitted: number;
        flagged: number;
        autoSubmitted: number;
        attention: number;
      }
    > = {};

    for (const roomId of roomIds) {
      const room = await requireOwnedRoom(ctx, roomId, examiner._id);
      if (!room) continue;

      const students = await ctx.db
        .query("students")
        .withIndex("by_room", (q) => q.eq("roomId", roomId))
        .take(room.enrolledLimit + 1);
      const submissions = await ctx.db
        .query("submissions")
        .withIndex("by_room", (q) => q.eq("roomId", roomId))
        .take(students.length + 1);
      let submitted = 0;
      for (const s of submissions) {
        if (s.isFinal) submitted++;
      }
      // AUTHORITATIVE "Needs Attention" definition (one source of truth for
      // the dashboard KPI, the attention strip, exam cards, and the detail
      // page's Monitoring badge):
      //   attention = students with ≥1 recorded enforced violation
      //               (violationCount > 0)
      // flagged (zero-tolerance) and auto-submitted (over the limit) are
      // severity levels WITHIN that set — both are only ever set while a
      // violation is being counted, so they imply violationCount ≥ 1. The
      // previous definition (flagged + autoSubmitted) silently excluded
      // students under a room's warning limit, so a room whose students had
      // live violations showed "Needs Attention: 0" while Monitoring
      // correctly displayed the same students' counts.
      let flagged = 0;
      let autoSubmitted = 0;
      let attention = 0;
      for (const s of students) {
        if (s.flagged === true) flagged++;
        if (s.autoSubmittedAt !== undefined) autoSubmitted++;
        if ((s.violationCount ?? 0) > 0) attention++;
      }
      counts[roomId] = { joined: students.length, submitted, flagged, autoSubmitted, attention };
    }
    return counts;
  },
});

/**
 * One room by id — owner-gated via requireOwnedRoom. Feeds the exam detail
 * page's header/settings; foreign or deleted roomIds yield null, never data.
 */
export const getRoom = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    const examiner = await getCurrentExaminer(ctx);
    if (!examiner) return null;
    return requireOwnedRoom(ctx, args.roomId, examiner._id);
  },
});

/** Edit a room (only while LIVE). */
export const updateRoom = mutation({
  args: {
    roomId: v.id("rooms"),
    name: v.string(),
    prompt: v.string(),
    durationMinutes: v.number(),
    enrolledLimit: v.number(),
    violationLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const examiner = await requireExaminer(ctx);
    const room = await requireOwnedRoom(ctx, args.roomId, examiner._id);
    if (!room) throw new ConvexError("Room not found");
    if (room.status !== "LIVE") {
      throw new ConvexError("Closed rooms cannot be edited");
    }

    const name = validateRoomName(args.name);
    // Rename must not collide with this examiner's OTHER rooms (the room's
    // own current name is allowed — that's a no-op rename).
    await assertUniqueRoomName(ctx, examiner._id, name, args.roomId);
    const prompt = validateRoomPrompt(args.prompt);
    const durationMinutes = validateDuration(args.durationMinutes);
    const enrolledLimit = validateEnrolledLimit(args.enrolledLimit);
    const violationLimit = validateViolationLimit(args.violationLimit);

    await ctx.db.patch(args.roomId, {
      name,
      prompt,
      durationMinutes,
      enrolledLimit,
      ...(violationLimit > 0
        ? { violationLimit }
        : { violationLimit: undefined }),
    });
    return { ok: true };
  },
});

/** Close a room — final, no reopen anywhere. */
export const endRoom = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    const examiner = await requireExaminer(ctx);
    const room = await requireOwnedRoom(ctx, args.roomId, examiner._id);
    if (!room) throw new ConvexError("Room not found");
    if (room.status === "CLOSED") return { ok: true };
    await ctx.db.patch(args.roomId, {
      status: "CLOSED",
      endedAt: Date.now(),
    });
    return { ok: true };
  },
});

/**
 * Permanently delete a room and ALL its data: every submission, every student
 * row, then the room itself. Owner-only — unlike endRoom, there is no way back,
 * which the confirming UI states explicitly.
 */
export const deleteRoom = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    const examiner = await requireExaminer(ctx);
    const room = await requireOwnedRoom(ctx, args.roomId, examiner._id);
    if (!room) throw new ConvexError("Room not found");

    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .collect();
    for (const sub of submissions) {
      await ctx.db.delete(sub._id);
    }

    const students = await ctx.db
      .query("students")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .collect();
    for (const student of students) {
      await ctx.db.delete(student._id);
    }

    // Monitoring events are room-scoped too — remove them with everything
    // else so no orphan rows outlive the room.
    const events = await ctx.db
      .query("violationEvents")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .collect();
    for (const event of events) {
      await ctx.db.delete(event._id);
    }

    await ctx.db.delete(args.roomId);
    return {
      ok: true as const,
      deletedSubmissions: submissions.length,
      deletedStudents: students.length,
    };
  },
});

// ---------------------------------------------------------------------------
// Exam-session monitoring (detection & logging, not prevention)
//
// Threat model, stated plainly: no web app can technically block tab
// switching or clipboard use. Everything here is detection and response —
// the server tallies events the client reports, decides when a room's
// violation limit is crossed, and auto-submits the student itself. Clients
// never send counts or flags, only single-event reports; the tallies on the
// student row are derived server-side from the append-only event log.
// ---------------------------------------------------------------------------

const VIOLATION_TYPES = ["blur", "paste", "copy", "rejoin"] as const;
/** Types that count toward the violation limit (rejoin is logged only). */
const ENFORCED_TYPES: ReadonlySet<string> = new Set(["blur", "paste", "copy"]);

type ViolationType = (typeof VIOLATION_TYPES)[number];

function isViolationType(raw: string): raw is ViolationType {
  return (VIOLATION_TYPES as readonly string[]).includes(raw);
}

/**
 * Load the calling student from their clientId — the exam-side equivalent of
 * requireOwnedRoom. Returns null when the token is unknown; a student row
 * can only ever be reached through its own secret token, so a client can
 * never act on another student's session.
 */
async function requireStudentByClient(
  ctx: MutationCtx,
  clientId: string,
): Promise<{ student: Doc<"students">; room: Doc<"rooms"> } | null> {
  const student = await ctx.db
    .query("students")
    .withIndex("by_client_id", (q) => q.eq("clientId", clientId))
    .unique();
  if (!student) return null;
  const room = await ctx.db.get(student.roomId);
  if (!room) return null;
  return { student, room };
}

/**
 * Append one monitoring event for the student's room and update their
 * server-side tally. Shared by the public log mutation and the rejoin
 * counter. All decisions (warning vs auto-submit) happen here, on the
 * server, from the event log — never from client-supplied state.
 *
 * Returns the client-facing outcome: warnings left before auto-submit, and
 * whether this event pushed the student over the limit.
 */
async function recordViolationEvent(
  ctx: MutationCtx,
  student: Doc<"students">,
  room: Doc<"rooms">,
  type: ViolationType,
  at: number,
): Promise<{
  enforced: boolean;
  counted: number;
  limit: number;
  warningsLeft: number | null;
  overLimit: boolean;
}> {
  await ctx.db.insert("violationEvents", { roomId: room._id, studentId: student._id, type, at });

  // Rejoin is audit-only: it never trips warnings, flags, or auto-submit.
  if (!ENFORCED_TYPES.has(type)) {
    return { enforced: false, counted: 0, limit: 0, warningsLeft: null, overLimit: false };
  }

  const counted = (student.violationCount ?? 0) + 1;
  const limit = room.violationLimit ?? 0;
  const overLimit = limit > 0 && counted > limit;

  await ctx.db.patch(student._id, {
    violationCount: counted,
    // Zero-tolerance rooms (limit 0/absent): the first violation marks the
    // student suspicious for the examiner. No student-visible warning.
    ...(limit === 0 ? { flagged: true } : {}),
    ...(overLimit ? { autoSubmittedAt: at } : {}),
  });

  // Zero-tolerance: log and flag silently — no enforcement message.
  if (limit === 0) {
    return { enforced: true, counted, limit, warningsLeft: null, overLimit: false };
  }

  return {
    enforced: true,
    counted,
    limit,
    // Under the limit: "2 of 3" -> 1 warning left. At the limit: 0 left.
    // Over: enforcement already ran; overLimit tells the client to stop.
    warningsLeft: Math.max(0, limit - counted),
    overLimit,
  };
}

/**
 * Server-driven enforcement: submit the student's current draft as final and
 * lock their session. Runs inside the same transaction that recorded the
 * over-limit event, so an auto-submit can never be lost or duplicated.
 */
async function enforceAutoSubmit(
  ctx: MutationCtx,
  student: Doc<"students">,
  code: string,
  at: number,
): Promise<void> {
  const existing = await ctx.db
    .query("submissions")
    .withIndex("by_student", (q) => q.eq("studentId", student._id))
    .unique();
  if (existing?.isFinal) return; // already submitted — nothing to do
  if (existing) {
    await ctx.db.patch(existing._id, {
      code,
      isFinal: true,
      updatedAt: at,
      submittedAt: existing.submittedAt ?? at,
    });
    return;
  }
  await ctx.db.insert("submissions", {
    code,
    isFinal: true,
    updatedAt: at,
    submittedAt: at,
    roomId: student.roomId,
    studentId: student._id,
  });
}

/**
 * Report a single exam-session event (blur / paste / copy). The client sends
 * one call per occurrence with NO counts and NO outcomes; the server logs
 * the event, maintains the tally, and decides enforcement itself.
 *
 * Ownership: the mutation only ever touches the student row that owns the
 * calling clientId (see requireStudentByClient) — the same pattern as
 * requireOwnedRoom on the examiner side. Unknown tokens are rejected before
 * consuming any quota.
 *
 * Clipboard privacy: the event type and time are recorded. Pasted or copied
 * CONTENT is deliberately never sent, logged, or stored.
 */
export const logViolationEvent = mutation({
  args: {
    clientId: v.string(),
    type: v.string(),
    currentCode: v.string(),
  },
  handler: async (ctx, args) => {
    const clientId = validateClientId(args.clientId);
    if (!isViolationType(args.type) || args.type === "rejoin") {
      throw new ConvexError("Unknown event type.");
    }
    const code = validateSubmissionCode(args.currentCode);

    const found = await requireStudentByClient(ctx, clientId);
    if (!found) {
      return { error: "Student not found — please rejoin the room." } as const;
    }
    const { student, room } = found;

    // Cap event spam: a real student cannot generate more than a few
    // tab-switches per second. Silent mode — monitoring must never disrupt
    // the exam, so an over-limit report is dropped, not surfaced.
    const allowed = await enforceRateLimit(ctx, "violationEventPerStudent", {
      key: student._id,
      silent: true,
      message: "Too many events.",
    });
    if (!allowed) {
      return { dropped: true } as const;
    }

    const outcome = await recordViolationEvent(ctx, student, room, args.type, Date.now());

    if (outcome.overLimit) {
      // Server-side enforcement — the client never triggers this.
      await enforceAutoSubmit(ctx, student, code, Date.now());
      return { overLimit: true } as const;
    }
    return outcome;
  },
});

/**
 * Count one exam-page load for this clientId (called on mount; includes the
 * very first join). Logged for the examiner's audit trail; rejoins never
 * count toward the violation limit — otherwise zero-tolerance rooms would
 * flag every student the moment they open the page.
 */
export const logRejoinEvent = mutation({
  args: { clientId: v.string() },
  handler: async (ctx, args) => {
    const clientId = validateClientId(args.clientId);
    const found = await requireStudentByClient(ctx, clientId);
    if (!found) return { error: "Student not found — please rejoin the room." } as const;
    // Same silent token bucket as enforced events: page-load spam (or a
    // scripted client hammering this public mutation) must not produce
    // unbounded violationEvents rows. Drop, never disrupt the exam.
    const allowed = await enforceRateLimit(ctx, "violationEventPerStudent", {
      key: found.student._id,
      silent: true,
      message: "Too many events.",
    });
    if (!allowed) return { dropped: true } as const;
    await recordViolationEvent(ctx, found.student, found.room, "rejoin", Date.now());
    return { ok: true } as const;
  },
});

/**
 * Examiner's live monitoring view for one room: per-student violation state
 * plus a per-type breakdown and recent rejoin timestamps. Owner-only.
 * Reactive on the clients' side — Convex pushes updates within seconds.
 */
export const getRoomMonitoring = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    const examiner = await getCurrentExaminer(ctx);
    if (!examiner) return { error: "Not authenticated" } as const;
    const room = await requireOwnedRoom(ctx, args.roomId, examiner._id);
    if (!room) return { error: "Room not found" } as const;

    const students = await ctx.db
      .query("students")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .take(room.enrolledLimit + 1);

    // Final-submission state per student: one indexed read (same pattern as
    // getRoomCounts) so a monitoring row's STATUS is server truth — a
    // submitted/auto-submitted student reads as such instead of the UI
    // guessing from absence of activity.
    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .take(room.enrolledLimit + 1);
    const finalByStudent = new Set(
      submissions.filter((s) => s.isFinal).map((s) => s.studentId),
    );

    const events = await ctx.db
      .query("violationEvents")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .take(MAX_VIOLATION_EVENTS_READ);

    const byStudent = new Map<string, Doc<"violationEvents">[]>();
    for (const event of events) {
      const list = byStudent.get(event.studentId) ?? [];
      list.push(event);
      byStudent.set(event.studentId, list);
    }

    const rows = students.map((student) => {
      const list = (byStudent.get(student._id) ?? []).sort((a, b) => a.at - b.at);
      const count = (t: ViolationType) => list.filter((e) => e.type === t).length;
      const rejoins = list
        .filter((e) => e.type === "rejoin")
        .slice(-MAX_REJOIN_TIMESTAMPS_RETURNED)
        .map((e) => e.at);
      // Most recent enforced (non-rejoin) events, newest first, capped — feeds
      // the plain-language violation detail ("Tab switched — 14:32") so the
      // examiner reads what happened, not just totals.
      const recentEvents = list
        .filter((e) => e.type !== "rejoin")
        .slice(-MAX_REJOIN_TIMESTAMPS_RETURNED)
        .reverse()
        .map((e) => ({ type: e.type, at: e.at }));
      return {
        studentId: student._id,
        name: student.name,
        studentUid: student.studentUid,
        regNo: student.regNo ?? null,
        violationCount: student.violationCount ?? 0,
        flagged: student.flagged === true,
        autoSubmittedAt: student.autoSubmittedAt ?? null,
        submitted: finalByStudent.has(student._id),
        breakdown: {
          blur: count("blur"),
          paste: count("paste"),
          copy: count("copy"),
          rejoin: count("rejoin"),
        },
        rejoins,
        recentEvents,
      };
    });

    return {
      room: {
        violationLimit: room.violationLimit ?? 0,
        status: room.status,
        durationMinutes: room.durationMinutes,
        startedAt: room.startedAt,
      },
      rows,
    } as const;
  },
});

// ---------------------------------------------------------------------------
// Student join
// ---------------------------------------------------------------------------

/**
 * Attempt-identity comparison for regNo: resume requires BOTH sides blank
 * (the pure name-only flow) or an EXACT match. A typed regNo never matches
 * a row without one, and a blank join never adopts a row that carries a
 * regNo â a different student who skips the ID field cannot inherit an
 * identified attempt.
 */
function sameAttemptRegNo(typed: string | undefined, stored: string | undefined): boolean {
  if (typed === undefined) return stored === undefined;
  return typed === stored;
}

/**
 * Public: join a room. Returns clientId + room details (incl. prompt).
 *
 * RATE LIMITING (see rateLimits.ts for thresholds): a per-room-code window
 * blunts code brute-forcing; a per-session bucket blunts rejoin spam from a
 * single browser. Fresh joins (no session yet) are covered by the per-code
 * limit — the whole class joining at once is unaffected.
 *
 * ATTEMPT ISOLATION (security fix — the "different student, same browser"
 * leak): a join request carries name + optional regNo + optionally the
 * browser's remembered (clientId, browserId) pair from a previous join.
 * The SERVER decides what that memory means — the browser is never trusted
 * to pick the right attempt:
 *
 *   • Resume attempt X  ⇔ the presented clientId maps to a row of THIS room
 *     AND (nothing else about the attempt was re-typed, i.e. no regNo given,
 *     OR the regNo matches X's row) AND — when the browser reports a
 *     browserId at all — that row was created from the same browserId.
 *     Name is display-only: it may be edited on resume (typos), it never
 *     selects the attempt.
 *   • Anything else (different regNo, or the token belongs to another
 *     room/browser) ⇒ a NEW attempt is minted. The old attempt's row,
 *     submission, and monitoring history stay untouched — never silently
 *     overwritten.
 *
 * A memory token from the WRONG room is ignored (clientId is room-scoped),
 * so the common "I run two exams from one laptop" examiner flow cannot
 * cross-contaminate attempts either. Capacity counts distinct attempts.
 */
export const joinRoom = mutation({
  args: {
    code: v.string(),
    name: v.string(),
    regNo: v.optional(v.string()),
    existingClientId: v.optional(v.string()),
    /** Opaque, non-secret browser-session id — enables server-side attempt
     *  resolution; absent on first-ever join (or when storage is unavailable). */
    browserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Reject malformed input FIRST — Convex transactions roll back rate-limit
    // bookkeeping on throw, so invalid requests never burn anyone's quota.
    const code = validateRoomCode(args.code);
    const name = validateStudentName(args.name);
    const regNo = validateStudentId(args.regNo);
    const existingClientId = args.existingClientId
      ? validateClientId(args.existingClientId)
      : undefined;
    const browserId = validateBrowserId(args.browserId);

    // Per-code window: only consumes when the mutation completes (committed
    // returns count; thrown errors roll back), which is exactly the behavior
    // a brute-force guard needs. The global window beneath it blunts
    // enumeration ACROSS codes, which the per-code key cannot see.
    await enforceRateLimit(ctx, "joinGlobal", {
      message: "The exam service is very busy right now. Try again shortly.",
    });
    await enforceRateLimit(ctx, "joinPerCode", {
      key: code,
      message: "Too many join attempts for this room code.",
    });

    if (existingClientId) {
      const allowed = await enforceRateLimit(ctx, "joinPerSession", {
        key: existingClientId,
        silent: true,
        message: "Too many join attempts. Wait a moment and try again.",
      });
      if (!allowed) {
        return {
          error: "Too many join attempts. Wait a minute and try again.",
        };
      }
    }

    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!room) {
      return {
        error: `No room found with code "${code}". Double-check it with your examiner.`,
      };
    }
    if (room.status === "CLOSED") {
      return {
        error: `"${room.name}" has already ended and is no longer accepting students.`,
      };
    }

    // ---- Attempt resolution (server-authoritative) -------------------------
    // A remembered token only ever resumes its OWN attempt, and only when
    // the attempt identity (regNo) matches what was just re-typed. When the
    // browser reports a browserId, the token must also have been minted for
    // THIS browser. A mismatch of any kind mints a fresh attempt — never a
    // takeover of someone else's row (no silent overwrite of their name,
    // submission, or monitoring history).
    let existing: Doc<"students"> | null = null;
    if (existingClientId) {
      const remembered = await ctx.db
        .query("students")
        .withIndex("by_client_id", (q) =>
          q.eq("clientId", existingClientId),
        )
        .unique();
      const sameRoom = remembered !== null && remembered.roomId === room._id;
      const sameAttemptIdentity = sameAttemptRegNo(regNo, remembered?.regNo);
      const sameBrowser =
        browserId === undefined || remembered?.browserId === browserId;
      if (sameRoom && sameAttemptIdentity && sameBrowser) {
        existing = remembered;
      }
      // else: stale or foreign memory → fall through to a brand-new attempt.
    }

    if (existing) {
      // Refresh display fields on resume — these never affect attempt
      // identity, so fixing a name typo or adding a missing ID is safe.
      if (existing.name !== name || (regNo && existing.regNo !== regNo)) {
        await ctx.db.patch(existing._id, { name, ...(regNo ? { regNo } : {}) });
      }
      return {
        clientId: existing.clientId,
        studentId: existing._id,
        studentUid: existing.studentUid,
        regNo: regNo ?? existing.regNo ?? null,
        room,
      };
    }

    // Fresh attempt — but if THIS browser already holds a row in this room
    // under the same attempt identity (regNo), that is the same human
    // re-joining with cleared or forgotten local memory: resume THAT row
    // instead of stacking duplicates. Looked up by (roomId, browserId,
    // regNo) — never by name, which is display-only and shared by real
    // classmates. Skipped when the browser didn't report a browserId.
    if (browserId) {
      const candidates = await ctx.db
        .query("students")
        .withIndex("by_browser", (q) => q.eq("browserId", browserId))
        .collect();
      const prior = candidates.find(
        (s) => s.roomId === room._id && sameAttemptRegNo(regNo, s.regNo),
      );
      if (prior) {
        if (prior.name !== name || (regNo && prior.regNo !== regNo)) {
          await ctx.db.patch(prior._id, { name, ...(regNo ? { regNo } : {}) });
        }
        return {
          clientId: prior.clientId,
          studentId: prior._id,
          studentUid: prior.studentUid,
          regNo: regNo ?? prior.regNo ?? null,
          room,
        };
      }
    }

    // Capacity: enforce the room's enrolled limit server-side, counting
    // DISTINCT ATTEMPTS about to exist after this join (the matched attempt
    // above resumed instead of consuming a seat). Reading the room's rows
    // through the index keeps this two reads total.
    const joined = await ctx.db
      .query("students")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();
    if (joined.length >= room.enrolledLimit) {
      return {
        error: `"${room.name}" is full (${room.enrolledLimit} enrolled). Ask your examiner for help.`,
      };
    }

    const clientId = randomToken();
    const studentUid = await generateStudentUid(ctx);
    const studentId = await ctx.db.insert("students", {
      clientId,
      // Record which browser minted this attempt so FUTURE joins from the
      // same browser can be resolved server-side (never shown, never a
      // permission by itself).
      ...(browserId ? { browserId } : {}),
      studentUid,
      ...(regNo ? { regNo } : {}),
      name,
      joinedAt: Date.now(),
      roomId: room._id,
    });
    return { clientId, studentId, studentUid, regNo: regNo ?? null, room };
  },
});

// ---------------------------------------------------------------------------
// Submissions (autosave + final submit) — one row per student, ever
// ---------------------------------------------------------------------------

async function upsertSubmission(
  ctx: MutationCtx,
  roomId: Id<"rooms">,
  studentId: Id<"students">,
  code: string,
  isFinal: boolean,
  rev: number | undefined,
) {
  const existing = await ctx.db
    .query("submissions")
    .withIndex("by_student", (q) => q.eq("studentId", studentId))
    .unique();
  const now = Date.now();
  if (existing) {
    // Keep the FIRST final timestamp; content/updatedAt always refresh.
    // rev rides along: final submits stamp their rev too (the submitting
    // buffer is authoritative), non-final writes only advance it.
    await ctx.db.patch(existing._id, {
      code,
      isFinal: existing.isFinal || isFinal,
      updatedAt: now,
      ...(rev !== undefined ? { rev } : {}),
      ...(isFinal ? { submittedAt: existing.submittedAt ?? now } : {}),
    });
    return existing._id;
  }
  return await ctx.db.insert("submissions", {
    code,
    isFinal,
    updatedAt: now,
    ...(rev !== undefined ? { rev } : {}),
    ...(isFinal ? { submittedAt: now } : {}),
    roomId,
    studentId,
  });
}

/**
 * Student autosave (isFinal: false) or final submit (isFinal: true).
 *
 * Auth is the clientId (a 128-bit server-minted token stored per-browser);
 * a student can only ever write to their own row — never another student's.
 *
 * Stale-write protection: every non-final write carries the client's edit
 * revision (a monotonic counter incremented per editor change). The server
 * refuses an autosave whose rev is not newer than the stored one — a slow
 * in-flight request from an older buffer can never overwrite newer content,
 * and the client re-saves from its (still dirty) latest buffer.
 *
 * Rate limits (see rateLimits.ts): autosave gets a generous per-student token
 * bucket (silent failure — the client keeps the draft dirty and retries);
 * final submit gets a smaller bucket and throws a friendly ConvexError.
 * Unknown clientIds are rejected before consuming any quota.
 */
export const saveSubmission = mutation({
  args: {
    clientId: v.string(),
    code: v.string(),
    isFinal: v.boolean(),
    rev: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const clientId = validateClientId(args.clientId);
    const code = validateSubmissionCode(args.code);
    const rev = validateRevision(args.rev);

    const student = await ctx.db
      .query("students")
      .withIndex("by_client_id", (q) => q.eq("clientId", clientId))
      .unique();
    if (!student) {
      return { error: "Student not found — please rejoin the room." } as const;
    }

    if (args.isFinal) {
      // Submit: loud limit — a friendly error the student can act on.
      await enforceRateLimit(ctx, "submitPerStudent", {
        key: student._id,
        message: "Too many submit attempts.",
      });

      const room = await ctx.db.get(student.roomId);
      if (!room) {
        return { error: "Room not found — contact your examiner." } as const;
      }
      // Late submits are accepted but flagged — clock drift should never
      // silently reject a student's work.
      const elapsed = Date.now() - room.startedAt;
      const late =
        room.status === "CLOSED" || elapsed > room.durationMinutes * 60_000;
      const submissionId = await upsertSubmission(
        ctx,
        room._id,
        student._id,
        code,
        true,
        rev,
      );
      return { submissionId, late } as const;
    }

    // Autosave path.
    const room = await ctx.db.get(student.roomId);
    if (!room) return { error: "Room not found." } as const;

    const existing = await ctx.db
      .query("submissions")
      .withIndex("by_student", (q) => q.eq("studentId", student._id))
      .unique();
    if (existing && existing.isFinal) return { locked: true } as const;
    if (room.status === "CLOSED") return { locked: true } as const;

    // STALE-WRITE GUARD: an in-flight OLDER autosave (strictly smaller rev)
    // arriving after a newer one already persisted must not overwrite newer
    // content — report `stale` explicitly so the client keeps its draft dirty
    // and the newest buffer re-saves on its next tick. An EQUAL rev is
    // allowed through: the client always sends its latest buffer, so equal
    // revs mean the same generation is being re-saved (e.g. after a dampened
    // write) — rejecting it would put the retry into a stale-loop. Final
    // submits bypass this guard: the visible buffer at submit time is
    // authoritative.
    if (
      rev !== undefined &&
      existing?.rev !== undefined &&
      rev < existing.rev
    ) {
      return { stale: true } as const;
    }

    // Spam damping: at most one autosave write per second. When the interval
    // hasn't elapsed, the write is SKIPPED — report that explicitly so the
    // client keeps its draft marked dirty and the next tick persists it.
    // (Returning plain success here would let the client clear its dirty
    // flag while stale content sat in the database — a real lost-update bug
    // surfaced by the real-time integrity audit.)
    if (
      existing &&
      Date.now() - existing.updatedAt < AUTOSAVE_MIN_INTERVAL_MS
    ) {
      return { submissionId: existing._id, dampened: true } as const;
    }

    // Rate limit autosave per student. Silent: returning an error keeps the
    // client's draft dirty so its next autosave tick retries naturally.
    const allowed = await enforceRateLimit(ctx, "autosavePerStudent", {
      key: student._id,
      silent: true,
      message: "Saving too fast.",
    });
    if (!allowed) {
      return {
        error: "Slow down a little — your work is still in the editor.",
      } as const;
    }

    const submissionId = await upsertSubmission(
      ctx,
      room._id,
      student._id,
      code,
      false,
      rev,
    );
    return { submissionId } as const;
  },
});/** Student's own submission state for /exam/:code (resume + submitted state). */
export const getMySubmission = query({
  args: { clientId: v.string() },
  handler: async (ctx, args) => {
    if (!args.clientId || args.clientId.length > 128) return null;
    const student = await ctx.db
      .query("students")
      .withIndex("by_client_id", (q) => q.eq("clientId", args.clientId))
      .unique();
    if (!student) return null;
    const submission = await ctx.db
      .query("submissions")
      .withIndex("by_student", (q) => q.eq("studentId", student._id))
      .unique();
    return {
      studentName: student.name,
      studentUid: student.studentUid,
      regNo: student.regNo ?? null,
      // Set server-side when this student's exam was auto-submitted for
      // exceeding the room's violation limit — lets the explanation banner
      // survive page reloads, not just the enforcing session.
      autoSubmittedAt: student.autoSubmittedAt ?? null,
      submission: submission
        ? {
            code: submission.code,
            isFinal: submission.isFinal,
            submittedAt: submission.submittedAt ?? null,
            // The stored edit revision: a resuming client continues its
            // revision counter from here so its first autosave is never
            // rejected as stale by the resumed server state.
            rev: submission.rev ?? 0,
          }
        : null,
    };
  },
});

/** Examiner: submitted students for one room (grading view). */
export const getRoomSubmissions = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    const examiner = await getCurrentExaminer(ctx);
    if (!examiner) return { error: "Not authenticated" } as const;
    const room = await requireOwnedRoom(ctx, args.roomId, examiner._id);
    if (!room) return { error: "Room not found" } as const;
    const students = await ctx.db
      .query("students")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .take(room.enrolledLimit + 1);
    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .take(students.length + 1);
    const byStudent = new Map(submissions.map((s) => [s.studentId, s]));
    const rows = students
      .map((student) => {
        const sub = byStudent.get(student._id);
        return {
          studentId: student._id,
          // SECURITY (data minimization): clientId (the student's 128-bit
          // session token) is deliberately NOT returned. Nothing in the
          // grading UI uses it — download filenames use studentUid/regNo —
          // and shipping a capability token to the browser widens the
          // exposure of the one credential that authorizes writes to a
          // student's submission.
          studentUid: student.studentUid,
          regNo: student.regNo ?? null,
          name: student.name,
          submission: sub
            ? {
                code: sub.code,
                isFinal: sub.isFinal,
                submittedAt: sub.submittedAt ?? null,
                updatedAt: sub.updatedAt,
              }
            : null,
        };
      })
      .filter((r) => r.submission !== null)
      .sort((a, b) => {
        const ta = a.submission?.submittedAt ?? a.submission?.updatedAt ?? 0;
        const tb = b.submission?.submittedAt ?? b.submission?.updatedAt ?? 0;
        return tb - ta;
      });
    return { room, rows } as const;
  },
});

/**
 * Public: room state for the exam page (prompt, timer basis, status).
 *
 * Capability-gated (audit fix #28 — public-query enumeration): the full state
 * (question text, timer basis, joined count, capacity) is returned ONLY to a
 * caller presenting a valid clientId — the 128-bit token joinRoom minted for
 * a student in THIS room. Everyone else gets `{ registered: false, status }`,
 * so sweeping all 10,000 CV-#### codes reveals nothing beyond whether a code
 * is live.
 *
 * Why not a numeric rate limit (e.g. 600/min global) as first proposed: rate
 * limit CONSUMPTION writes state, and Convex queries are read-only
 * transactions — the limiter's `limit()` requires a mutation ctx (its
 * `check()` variant never consumes). A per-minute cap is therefore
 * unenforceable inside a query; gating the sensitive fields is strictly
 * stronger, since a distributed scanner would merely be slowed by a cap.
 *
 * `lookupRoomByCode` (name+status preview, previously unlimited) was deleted
 * in the same fix: it had zero frontend callers and exposed strictly more
 * than this function's safe subset.
 */
export const getExamRoomState = query({
  args: {
    code: v.string(),
    /** Capability token minted by joinRoom. Omitted/invalid → safe subset. */
    clientId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const code = args.code.trim().toUpperCase();
    if (!ROOM_CODE_PATTERN.test(code)) return null;
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!room) return null;

    const clientId = args.clientId;
    if (clientId && clientId.length <= MAX_CLIENT_ID) {
      const student = await ctx.db
        .query("students")
        .withIndex("by_client_id", (q) => q.eq("clientId", clientId))
        .unique();
      // The token must belong to a student in THIS room — a clientId is
      // scoped to a single room, so it can never unlock another room's data.
      if (student && student.roomId === room._id) {
        const students = await ctx.db
          .query("students")
          .withIndex("by_room", (q) => q.eq("roomId", room._id))
          .take(room.enrolledLimit + 1);
        return {
          registered: true,
          roomId: room._id,
          name: room.name,
          prompt: room.prompt,
          durationMinutes: room.durationMinutes,
          status: room.status,
          startedAt: room.startedAt,
          endedAt: room.endedAt ?? null,
          joined: students.length,
          enrolledLimit: room.enrolledLimit,
          violationLimit: room.violationLimit ?? 0,
        };
      }
    }

    // Safe subset for callers without a valid capability token. Placeholder
    // values (not nulls) keep the response shape stable for the existing
    // client type; unregistered visitors only ever render the rejoin/closed
    // cards, which never read prompt/timer fields.
    return {
      registered: false,
      roomId: null,
      name: code,
      prompt: "",
      durationMinutes: 0,
      status: room.status,
      startedAt: 0,
      endedAt: null,
      joined: 0,
      enrolledLimit: 0,
      violationLimit: 0,
    };
  },
});


// ---------------------------------------------------------------------------
// Submission export — server-generated PDF, server-side authorization.
//
// Threat model: the earlier flow built TXT files client-side from query
// data, so the download path had no server boundary of its own. The new
// flow has TWO server boundaries:
//   1. requestSubmissionExportTickets (authenticated examiner mutation):
//      owner-checks every room+student pair, hashes fresh random tokens and
//      stores ONLY the hashes as one-time 90-second tickets. The raw ticket
//      is never persisted, so a database snapshot cannot mint export URLs.
//   2. exportSubmissionPdf (internal action): re-verifies ticket validity,
//      consumes it single-use, re-checks room ownership AND submission
//      existence from the database — the authoritative source — then builds
//      the PDF from that record.
// A student (or anyone without the examiner's session) can neither mint a
// ticket nor reach the internal action. Guessing ticket URLs is infeasible:
// 128-bit random tokens, hashed at rest, single-use, 90-second expiry.
// The downloaded document is a REPRESENTATION, never the source of truth.
// ---------------------------------------------------------------------------

const TICKET_TTL_MS = 90_000;

export const requestSubmissionExportTickets = mutation({
  args: {
    requests: v.array(
      v.object({
        roomId: v.id("rooms"),
        studentId: v.id("students"),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const examiner = await requireExaminer(ctx);
    // Bound the batch so one call cannot mint unbounded tickets.
    if (args.requests.length === 0 || args.requests.length > 100) {
      throw new ConvexError(
        "Choose between 1 and 100 submissions to download.",
      );
    }

    const tickets: { ticket: string; studentId: Id<"students"> }[] = [];
    for (const req of args.requests) {
      const room = await requireOwnedRoom(ctx, req.roomId, examiner._id);
      if (!room) {
        // A foreign roomId/studentId is an authorization probe — log it
        // (structured, secret-free) and fail the whole batch.
        await ctx.db.insert("securityEvents", {
          event: "export_ticket_denied",
          detail: "foreign room or student in export batch",
          roomId: req.roomId,
          studentId: req.studentId,
          at: Date.now(),
        });
        throw new ConvexError("Some of those submissions aren't yours to download.");
      }
      const student = await ctx.db.get(req.studentId);
      if (!student || student.roomId !== room._id) {
        await ctx.db.insert("securityEvents", {
          event: "export_ticket_denied",
          detail: "student not in owned room",
          roomId: req.roomId,
          studentId: req.studentId,
          at: Date.now(),
        });
        throw new ConvexError("Some of those submissions aren't yours to download.");
      }
      const submission = await ctx.db
        .query("submissions")
        .withIndex("by_student", (q) => q.eq("studentId", req.studentId))
        .unique();
      if (!submission) {
        throw new ConvexError("One of those students has no submission yet.");
      }

      const ticket = randomToken();
      tickets.push({ ticket, studentId: req.studentId });
      await ctx.db.insert("exportTickets", {
        ticketHash: await sha256Hex(ticket),
        examinerId: examiner._id,
        roomId: room._id,
        studentId: req.studentId,
        exp: Date.now() + TICKET_TTL_MS,
      });
    }
    return { tickets };
  },
});

/**
 * Build one submission PDF from the authoritative stored record. Internal:
 * reachable only from server code holding a valid ticket (via the HTTP
 * route's auth-checked handoff). Returns null when anything fails to
 * verify — the caller answers 404, never an internal detail.
 */
export const exportSubmissionPdf = internalAction({
  args: { ticket: v.string() },
  handler: async (ctx, args) => {
    // Single-use consumption BEFORE any generation work.
    const ticketHash = await sha256Hex(args.ticket);
    const row = await ctx.runQuery(internal.exams.getExportTicketRow, {
      ticketHash,
    });
    if (!row) return null;
    await ctx.runMutation(internal.exams.consumeExportTicket, { id: row._id });
    if (row.exp < Date.now()) return null;

    const room = await ctx.runQuery(internal.exams.getExportRoom, {
      roomId: row.roomId,
    });
    const student = await ctx.runQuery(internal.exams.getExportStudent, {
      studentId: row.studentId,
    });
    if (!room || !student) return null;
    // Re-verify the ticket still points at an owned pair.
    if (room.examinerId !== row.examinerId || student.roomId !== room._id) {
      return null;
    }
    const submission = await ctx.runQuery(internal.exams.getExportSubmission, {
      studentId: row.studentId,
    });
    if (!submission) return null;

    // Integrity reference: lets anyone later compare the downloaded
    // document against the live database record. It is a verification
    // AID — the PDF itself is not cryptographically protected and can be
    // edited by any PDF editor; the database record stays authoritative.
    const contentHash = await sha256Hex(
      [room.code, room.name, student.name, student.studentUid, submission.code].join(
        "\u0000",
      ),
    );

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const mono = await pdf.embedFont(StandardFonts.Courier);

    const W = 595.28;
    const H = 841.89;
    const M = 56;
    const CONTENT_W = W - M * 2;
    // Sanitize: PDF standard fonts are Latin-1 — non-representable glyphs
    // would throw at draw time. Control characters are stripped, long
    // values capped.
    const sanitize = (value: string): string =>
      value.replace(/[^\x20-\x7e\xa0-\xff]/g, "").slice(0, 300) || "(none)";

    const cleanName = sanitize(room.name);
    const cleanStudent = sanitize(student.name);
    const cleanUid = sanitize(student.studentUid);
    const cleanReg = student.regNo ? sanitize(student.regNo) : null;
    const codeSize = 8;

    let page = pdf.addPage([W, H]);
    let y = 0;

    // Header identity block — repeated on every page so a multi-page
    // export is never missing its metadata.
    const drawHeader = () => {
      page.drawRectangle({
        x: 0,
        y: H - 112,
        width: W,
        height: 112,
        color: rgb(0.968, 0.953, 0.925),
      });
      page.drawText("CODE VENUE", {
        x: M,
        y: H - 44,
        size: 16,
        font: bold,
        color: rgb(0.71, 0.45, 0.29),
      });
      page.drawText("Submission Record", {
        x: M,
        y: H - 62,
        size: 9,
        font,
        color: rgb(0.42, 0.36, 0.31),
      });
      page.drawText(`Generated ${new Date().toISOString()}`, {
        x: M,
        y: H - 76,
        size: 8,
        font,
        color: rgb(0.42, 0.36, 0.31),
      });
      page.drawText(`Submission ID: ${submission._id}`, {
        x: M,
        y: H - 90,
        size: 7.5,
        font: mono,
        color: rgb(0.42, 0.36, 0.31),
      });
      page.drawText(`Integrity: sha256:${contentHash.slice(0, 32)}`, {
        x: M,
        y: H - 102,
        size: 7.5,
        font: mono,
        color: rgb(0.42, 0.36, 0.31),
      });
      y = H - 130;
    };

    const newPage = () => {
      page = pdf.addPage([W, H]);
      drawHeader();
    };

    const ensure = (needed: number) => {
      if (y - needed < M) newPage();
    };

    const drawLabel = (label: string, value: string, useMono = false) => {
      ensure(16);
      page.drawText(label, {
        x: M,
        y,
        size: 8,
        font: bold,
        color: rgb(0.55, 0.47, 0.4),
      });
      page.drawText(value, {
        x: M + 96,
        y,
        size: 9.5,
        font: useMono ? mono : font,
        color: rgb(0.17, 0.14, 0.12),
      });
      y -= 16;
    };

    drawHeader();

    drawLabel("Exam", cleanName);
    drawLabel("Exam code", sanitize(room.code));
    drawLabel("Student", cleanStudent);
    drawLabel("Student UID", cleanUid, true);
    if (cleanReg) drawLabel("Student ID", cleanReg);
    drawLabel("Status", submission.isFinal ? "Final submission" : "Draft");
    drawLabel(
      "Submitted",
      submission.submittedAt ? new Date(submission.submittedAt).toISOString() : "— (draft)",
    );
    drawLabel("Last saved", new Date(submission.updatedAt).toISOString());

    ensure(30);
    page.drawText("QUESTION", {
      x: M,
      y,
      size: 8,
      font: bold,
      color: rgb(0.55, 0.47, 0.4),
    });
    y -= 16;
    for (const line of wrapText(sanitize(room.prompt).replace(/\t/g, "    "), 9, CONTENT_W, font)) {
      ensure(14);
      page.drawText(line, { x: M, y, size: 9, font, color: rgb(0.17, 0.14, 0.12) });
      y -= 13;
    }
    y -= 8;

    ensure(30);
    page.drawText("SUBMITTED CODE", {
      x: M,
      y,
      size: 8,
      font: bold,
      color: rgb(0.55, 0.47, 0.4),
    });
    y -= 16;
    const codeText = submission.code.length ? submission.code : "(empty)";
    // Courier is monospaced → exact character math for the code box width.
    const maxChars = Math.floor((CONTENT_W - 16) / (codeSize * 0.6));
    for (const rawLine of codeText.split("\n")) {
      const expanded = rawLine.replace(/\t/g, "    ");
      if (expanded.length <= maxChars) {
        ensure(13);
        page.drawText(expanded, {
          x: M + 8,
          y,
          size: codeSize,
          font: mono,
          color: rgb(0.17, 0.14, 0.12),
        });
        y -= 12;
      } else {
        for (let i = 0; i < expanded.length; i += maxChars) {
          ensure(13);
          page.drawText(expanded.slice(i, i + maxChars), {
            x: M + 8,
            y,
            size: codeSize,
            font: mono,
            color: rgb(0.17, 0.14, 0.12),
          });
          y -= 12;
        }
      }
    }

    const bytes = await pdf.save();
    // Exact-copy ArrayBuffer: the runAction boundary serializes bytes, and a
    // pooled view could carry padding — copy to the exact length.
    return { bytes: Uint8Array.from(bytes).buffer, contentHash };
  },
});

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Word-wrap against measured widths; hard-breaks over-long words. */
function wrapText(
  text: string,
  size: number,
  maxWidth: number,
  font: PDFFont,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (font.widthOfTextAtSize(paragraph, size) <= maxWidth) {
      lines.push(paragraph);
      continue;
    }
    let current = "";
    for (const word of paragraph.split(" ")) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        if (font.widthOfTextAtSize(word, size) > maxWidth) {
          let piece = "";
          for (const ch of word) {
            if (font.widthOfTextAtSize(piece + ch, size) > maxWidth) {
              lines.push(piece);
              piece = ch;
            } else {
              piece += ch;
            }
          }
          current = piece;
        } else {
          current = word;
        }
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

// Internal read helpers for the export action (actions cannot touch ctx.db).
export const getExportTicketRow = internalQuery({
  args: { ticketHash: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("exportTickets")
      .withIndex("by_hash", (q) => q.eq("ticketHash", args.ticketHash))
      .unique();
  },
});

export const consumeExportTicket = internalMutation({
  args: { id: v.id("exportTickets") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

export const getExportRoom = internalQuery({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => await ctx.db.get(args.roomId),
});

export const getExportStudent = internalQuery({
  args: { studentId: v.id("students") },
  handler: async (ctx, args) => await ctx.db.get(args.studentId),
});

export const getExportSubmission = internalQuery({
  args: { studentId: v.id("students") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("submissions")
      .withIndex("by_student", (q) => q.eq("studentId", args.studentId))
      .unique();
  },
});
