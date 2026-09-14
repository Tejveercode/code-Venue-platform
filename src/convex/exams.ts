import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  mutation,
  query,
  QueryCtx,
  MutationCtx,
} from "./_generated/server";
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
  validateSubmissionCode,
  validateExaminerName,
  validateViolationLimit,
} from "./validation";
import { enforceRateLimit } from "./rateLimits";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get the examiner record for the current signed-in user (or null). */
async function getCurrentExaminer(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  return await ctx.db
    .query("examiners")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

function generateRoomCode(): string {
  const digits = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, "0");
  return `CV-${digits}`;
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

    const roomIds = args.roomIds.slice(0, MAX_ROOM_IDS_PER_QUERY);
    const counts: Record<
      string,
      { joined: number; submitted: number; flagged: number; autoSubmitted: number }
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
      let flagged = 0;
      let autoSubmitted = 0;
      for (const s of students) {
        if (s.flagged === true) flagged++;
        if (s.autoSubmittedAt !== undefined) autoSubmitted++;
      }
      counts[roomId] = { joined: students.length, submitted, flagged, autoSubmitted };
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
      room: { violationLimit: room.violationLimit ?? 0, status: room.status },
      rows,
    } as const;
  },
});

// ---------------------------------------------------------------------------
// Student join
// ---------------------------------------------------------------------------

/**
 * Public: join a room. Returns clientId + room details (incl. prompt).
 *
 * Rate limiting (see rateLimits.ts for thresholds): a per-room-code window
 * blunts code brute-forcing; a per-session bucket blunts rejoin spam from a
 * single browser. Fresh joins (no session yet) are covered by the per-code
 * limit — the whole class joining at once is unaffected.
 */
export const joinRoom = mutation({
  args: {
    code: v.string(),
    name: v.string(),
    regNo: v.optional(v.string()),
    existingClientId: v.optional(v.string()),
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

    // Per-code window: only consumes when the mutation completes (committed
    // returns count; thrown errors roll back), which is exactly the behavior
    // a brute-force guard needs.
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

    // Capacity: enforce the room's enrolled limit server-side. Rejoining
    // students (same clientId → same row) never count against it.
    if (!existingClientId) {
      const joined = await ctx.db
        .query("students")
        .withIndex("by_room", (q) => q.eq("roomId", room._id))
        .collect();
      if (joined.length >= room.enrolledLimit) {
        return {
          error: `"${room.name}" is full (${room.enrolledLimit} enrolled). Ask your examiner for help.`,
        };
      }
    }

    // Rejoin with the same clientId → same student row (refresh-safe).
    // A clientId only maps to one student row, so joining a different room
    // always mints a fresh one.
    if (existingClientId) {
      const existing = await ctx.db
        .query("students")
        .withIndex("by_client_id", (q) =>
          q.eq("clientId", existingClientId),
        )
        .unique();
      if (existing && existing.roomId === room._id) {
        // Adopt a newly provided regNo on rejoin (e.g. they added it after a
        // first quick join).
        if (regNo && existing.regNo !== regNo) {
          await ctx.db.patch(existing._id, { regNo });
        }
        return {
          clientId: existing.clientId,
          studentId: existing._id,
          studentUid: existing.studentUid,
          regNo: regNo ?? existing.regNo ?? null,
          room,
        };
      }
    }

    const clientId = randomToken();
    const studentUid = await generateStudentUid(ctx);
    const studentId = await ctx.db.insert("students", {
      clientId,
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
) {
  const existing = await ctx.db
    .query("submissions")
    .withIndex("by_student", (q) => q.eq("studentId", studentId))
    .unique();
  const now = Date.now();
  if (existing) {
    // Keep the FIRST final timestamp; content/updatedAt always refresh.
    await ctx.db.patch(existing._id, {
      code,
      isFinal: existing.isFinal || isFinal,
      updatedAt: now,
      ...(isFinal ? { submittedAt: existing.submittedAt ?? now } : {}),
    });
    return existing._id;
  }
  return await ctx.db.insert("submissions", {
    code,
    isFinal,
    updatedAt: now,
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
  },
  handler: async (ctx, args) => {
    const clientId = validateClientId(args.clientId);
    const code = validateSubmissionCode(args.code);

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

    // Spam damping: at most one autosave write per second. The content is
    // identical from the student's point of view (next keystroke re-saves);
    // we just skip the redundant DB write.
    if (
      existing &&
      Date.now() - existing.updatedAt < AUTOSAVE_MIN_INTERVAL_MS
    ) {
      return { submissionId: existing._id } as const;
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
    );
    return { submissionId } as const;
  },
});

/** Student's own submission state for /exam/:code (resume + submitted state). */
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
          // clientId doubles as the short-ID suffix for download filenames
          // ({name}_{ID}.txt). Owner-only query, so exposing it here is safe.
          clientId: student.clientId,
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
