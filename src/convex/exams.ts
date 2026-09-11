import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  mutation,
  query,
  QueryCtx,
  MutationCtx,
} from "./_generated/server";

// ---------------------------------------------------------------------------
// Limits (server-side, so the UI can't be bypassed)
// ---------------------------------------------------------------------------

const MAX_LIST_ROOMS = 200; // per examiner
const MAX_COUNT_ROOMS = 50; // per getRoomCounts call
const MAX_STUDENT_NAME = 60;
const MAX_ROOM_NAME = 120;
const MAX_ROOM_PROMPT = 10_000;
const MAX_SUBMISSION_CODE = 64_000; // ~64KB of code per student
const AUTOSAVE_MIN_INTERVAL_MS = 1_000; // damp spammy autosave writes

// Rate limits (fixed-window counters in the rateLimits table)
const JOIN_LIMIT_PER_CLIENT = 5; // per 60s, per client session
const JOIN_LIMIT_WINDOW_MS = 60_000;

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
  if (!examiner) throw new Error("Only examiners can do this");
  return examiner;
}

/**
 * Simple fixed-window rate limiter backed by the rateLimits table.
 * Returns false when the key's budget for the current window is exhausted.
 * Best-effort only: a failed counter write never blocks the caller.
 */
async function checkRateLimit(
  ctx: MutationCtx,
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  try {
    const now = Date.now();
    const row = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (!row || now - row.windowStart >= windowMs) {
      if (row) {
        await ctx.db.patch(row._id, { windowStart: now, count: 1 });
      } else {
        await ctx.db.insert("rateLimits", { key, windowStart: now, count: 1 });
      }
      return true;
    }
    if (row.count >= limit) return false;
    await ctx.db.patch(row._id, { count: row.count + 1 });
    return true;
  } catch {
    return true; // never let limiter errors break the real flow
  }
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
 * Name resolution priority:
 *   1. `pendingName` — the name typed into the signup form (stashed by /auth
 *      and passed by the portal). Applied UNCONDITIONALLY, even over an
 *      existing row, so examiner rows created with the email fallback before
 *      this fix heal themselves on the next portal visit.
 *   2. users.name — but ONLY when it isn't email-like (Convex Auth copies
 *      the OTP email identifier into users.name; that must never be shown).
 *   3. email local-part — last resort when no name was ever provided.
 *
 * Returns `{ examinerId, isNew }`; new rows always start with welcomed:
 * false so the portal can greet first-time users differently.
 */
export const ensureExaminer = mutation({
  args: { pendingName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const user = await ctx.db.get(userId);
    const email = user?.email ?? `guest-${userId.slice(0, 8)}@codevenue.local`;
    const pendingName = args.pendingName?.trim();

    const existing = await ctx.db
      .query("examiners")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing) {
      if (pendingName) {
        // The typed name is the source of truth — always win.
        if (existing.name !== pendingName) {
          await ctx.db.patch(existing._id, { name: pendingName });
        }
        if (user && isEmailLike(user.name ?? "") && user.name !== pendingName) {
          await ctx.db.patch(user._id, { name: pendingName });
        }
      } else {
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
      }
      return { examinerId: existing._id, isNew: false };
    }

    const name =
      pendingName ??
      (user?.name && !isEmailLike(user.name)
        ? user.name
        : email.split("@")[0]);
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
 * Store the examiner's typed display name (called right after signup).
 * Creates the examiner record if it doesn't exist yet, so the name survives
 * even when this mutation races with ensureExaminer.
 */
export const setExaminerName = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (!name) return { ok: false };
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const user = await ctx.db.get(userId);
    if (user) {
      await ctx.db.patch(user._id, { name });
    }

    const email = user?.email ?? `guest-${userId.slice(0, 8)}@codevenue.local`;
    const examiner = await ctx.db
      .query("examiners")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (examiner) {
      await ctx.db.patch(examiner._id, { name });
    } else {
      await ctx.db.insert("examiners", {
        userId,
        name,
        email,
        createdAt: Date.now(),
        welcomed: false,
      });
    }
    return { ok: true };
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
  },
  handler: async (ctx, args) => {
    const examiner = await requireExaminer(ctx);

    // Validation — the UI checks too, but never trust the client.
    const name = args.name.trim();
    const prompt = args.prompt.trim();
    if (!name || name.length > MAX_ROOM_NAME) {
      throw new Error(`Room name must be 1–${MAX_ROOM_NAME} characters`);
    }
    if (!prompt || prompt.length > MAX_ROOM_PROMPT) {
      throw new Error(`Prompt must be 1–${MAX_ROOM_PROMPT} characters`);
    }
    const durationMinutes = Math.floor(args.durationMinutes);
    const enrolledLimit = Math.floor(args.enrolledLimit);
    if (!Number.isFinite(durationMinutes) || durationMinutes < 1 || durationMinutes > 24 * 60) {
      throw new Error("Duration must be between 1 and 1440 minutes");
    }
    if (!Number.isFinite(enrolledLimit) || enrolledLimit < 1 || enrolledLimit > 500) {
      throw new Error("Enrolled limit must be between 1 and 500");
    }

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
 * Joined + final-submitted counts for a list of rooms (live via subscription).
 *
 * Ownership first: unknown or foreign roomIds are simply omitted — this is a
 * public-shaped query, so the examiner check is the only access control.
 *
 * Batching: per room we run exactly two indexed reads (students by_room,
 * submissions by_room) instead of the previous pattern that issued one
 * by_student query PER STUDENT per room. Worst case for a full dashboard:
 * 2 × MAX_COUNT_ROOMS indexed queries.
 */
export const getRoomCounts = query({
  args: { roomIds: v.array(v.id("rooms")) },
  handler: async (ctx, args) => {
    const examiner = await getCurrentExaminer(ctx);
    if (!examiner) return {};

    const roomIds = args.roomIds.slice(0, MAX_COUNT_ROOMS);
    const counts: Record<string, { joined: number; submitted: number }> = {};

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
      counts[roomId] = { joined: students.length, submitted };
    }
    return counts;
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
  },
  handler: async (ctx, args) => {
    const examiner = await requireExaminer(ctx);
    const room = await requireOwnedRoom(ctx, args.roomId, examiner._id);
    if (!room) throw new Error("Room not found");
    if (room.status !== "LIVE") {
      throw new Error("Closed rooms cannot be edited");
    }

    const name = args.name.trim();
    const prompt = args.prompt.trim();
    if (!name || name.length > MAX_ROOM_NAME) {
      throw new Error(`Room name must be 1–${MAX_ROOM_NAME} characters`);
    }
    if (!prompt || prompt.length > MAX_ROOM_PROMPT) {
      throw new Error(`Prompt must be 1–${MAX_ROOM_PROMPT} characters`);
    }
    const durationMinutes = Math.floor(args.durationMinutes);
    const enrolledLimit = Math.floor(args.enrolledLimit);
    if (!Number.isFinite(durationMinutes) || durationMinutes < 1 || durationMinutes > 24 * 60) {
      throw new Error("Duration must be between 1 and 1440 minutes");
    }
    if (!Number.isFinite(enrolledLimit) || enrolledLimit < 1 || enrolledLimit > 500) {
      throw new Error("Enrolled limit must be between 1 and 500");
    }

    await ctx.db.patch(args.roomId, {
      name,
      prompt,
      durationMinutes,
      enrolledLimit,
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
    if (!room) throw new Error("Room not found");
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
    if (!room) throw new Error("Room not found");

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

    await ctx.db.delete(args.roomId);
    return {
      ok: true as const,
      deletedSubmissions: submissions.length,
      deletedStudents: students.length,
    };
  },
});

// ---------------------------------------------------------------------------
// Student join
// ---------------------------------------------------------------------------

/** Public: validate a room code (name + status only, no prompt). */
export const lookupRoomByCode = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const code = args.code.trim().toUpperCase();
    if (!/^CV-\d{4}$/.test(code)) return null;
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!room) return null;
    return { name: room.name, status: room.status };
  },
});

/** Public: join a room. Returns clientId + room details (incl. prompt). */
export const joinRoom = mutation({
  args: {
    code: v.string(),
    name: v.string(),
    regNo: v.optional(v.string()),
    existingClientId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Rate limit: 5 join attempts/min per client session. Cheap check runs
    // before any DB lookups so scripted spam dies at the gate. Legit refresh
    // flows (1–2 attempts) never hit this.
    const bucketKey = `join:${args.existingClientId ?? "new"}`;
    if (
      !(await checkRateLimit(
        ctx,
        bucketKey,
        JOIN_LIMIT_PER_CLIENT,
        JOIN_LIMIT_WINDOW_MS,
      ))
    ) {
      return {
        error: "Too many join attempts. Wait a minute and try again.",
      };
    }

    // Validation / spam damping: reject malformed input with one cheap check
    // before it ever hits the database.
    const code = args.code.trim().toUpperCase();
    if (!/^CV-\d{4}$/.test(code)) {
      return {
        error: 'Room codes look like "CV-1234". Double-check it with your examiner.',
      };
    }
    const name = args.name.trim();
    if (!name || name.length > MAX_STUDENT_NAME) {
      return {
        error: `Please enter your name (1–${MAX_STUDENT_NAME} characters).`,
      };
    }
    if (args.existingClientId && args.existingClientId.length > 128) {
      return { error: "Invalid session. Please join again." };
    }
    // Optional institutional ID (e.g. "24BCA10210") — validated loosely since
    // formats vary by institution; only length and charset are enforced.
    const regNo = args.regNo?.trim().toUpperCase();
    if (regNo && !/^[A-Z0-9-]{3,24}$/.test(regNo)) {
      return {
        error: "Student ID should be 3–24 letters/numbers (e.g. 24BCA10210).",
      };
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
    if (!args.existingClientId) {
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
    if (args.existingClientId) {
      const existing = await ctx.db
        .query("students")
        .withIndex("by_client_id", (q) =>
          q.eq("clientId", args.existingClientId as string),
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
 * A 1s write-throttle damps scripted/rapid-fire autosave spam.
 */
export const saveSubmission = mutation({
  args: {
    clientId: v.string(),
    code: v.string(),
    isFinal: v.boolean(),
  },
  handler: async (ctx, args) => {
    if (args.clientId.length > 128) {
      return { error: "Invalid session — please rejoin the room." } as const;
    }
    if (args.code.length > MAX_SUBMISSION_CODE) {
      return { error: "Submission is too large (64KB limit)." } as const;
    }

    const student = await ctx.db
      .query("students")
      .withIndex("by_client_id", (q) => q.eq("clientId", args.clientId))
      .unique();
    if (!student) {
      return { error: "Student not found — please rejoin the room." } as const;
    }
    const room = await ctx.db.get(student.roomId);
    if (!room) return { error: "Room not found." } as const;

    if (args.isFinal) {
      // Late submits are accepted but flagged — clock drift should never
      // silently reject a student's work.
      const elapsed = Date.now() - room.startedAt;
      const late =
        room.status === "CLOSED" || elapsed > room.durationMinutes * 60_000;
      const submissionId = await upsertSubmission(
        ctx,
        room._id,
        student._id,
        args.code,
        true,
      );
      return { submissionId, late } as const;
    }

    // Autosave: blocked once final or the room is closed.
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

    const submissionId = await upsertSubmission(
      ctx,
      room._id,
      student._id,
      args.code,
      false,
    );
    return { submissionId } as const;
  },
});

/** Student's own submission state for /exam/:code (resume + submitted state). */
export const getMySubmission = query({
  args: { clientId: v.string() },
  handler: async (ctx, args) => {
    if (args.clientId.length > 128) return null;
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

/** Public: room state for the exam page (prompt, timer basis, status). */
export const getExamRoomState = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const code = args.code.trim().toUpperCase();
    if (!/^CV-\d{4}$/.test(code)) return null;
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!room) return null;
    const students = await ctx.db
      .query("students")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .take(room.enrolledLimit + 1);
    return {
      roomId: room._id,
      name: room.name,
      prompt: room.prompt,
      durationMinutes: room.durationMinutes,
      status: room.status,
      startedAt: room.startedAt,
      endedAt: room.endedAt ?? null,
      joined: students.length,
      enrolledLimit: room.enrolledLimit,
    };
  },
});
