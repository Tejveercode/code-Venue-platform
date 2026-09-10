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

async function requireExaminer(ctx: MutationCtx) {
  const examiner = await getCurrentExaminer(ctx);
  if (!examiner) throw new Error("Only examiners can do this");
  return examiner;
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
      name: args.name,
      prompt: args.prompt,
      durationMinutes: Math.max(1, Math.floor(args.durationMinutes)),
      status: "LIVE",
      enrolledLimit: Math.max(1, Math.floor(args.enrolledLimit)),
      startedAt: now,
      examinerId: examiner._id,
    });
    return { roomId, code };
  },
});

/** All rooms owned by the current examiner, newest first. */
export const listMyRooms = query({
  args: {},
  handler: async (ctx) => {
    const examiner = await getCurrentExaminer(ctx);
    if (!examiner) return [];
    const rooms = await ctx.db
      .query("rooms")
      .filter((q) => q.eq(q.field("examinerId"), examiner._id))
      .collect();
    return rooms.sort((a, b) => b.startedAt - a.startedAt);
  },
});

/** Joined + final-submitted counts for a list of rooms (live via subscription). */
export const getRoomCounts = query({
  args: { roomIds: v.array(v.id("rooms")) },
  handler: async (ctx, args) => {
    const counts: Record<string, { joined: number; submitted: number }> = {};
    for (const roomId of args.roomIds) {
      const students = await ctx.db
        .query("students")
        .withIndex("by_room", (q) => q.eq("roomId", roomId))
        .collect();
      let submitted = 0;
      for (const s of students) {
        const sub = await ctx.db
          .query("submissions")
          .withIndex("by_student", (q) => q.eq("studentId", s._id))
          .unique();
        if (sub && sub.isFinal) submitted++;
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
    const room = await ctx.db.get(args.roomId);
    if (!room || room.examinerId !== examiner._id) {
      throw new Error("Room not found");
    }
    if (room.status !== "LIVE") {
      throw new Error("Closed rooms cannot be edited");
    }
    await ctx.db.patch(args.roomId, {
      name: args.name,
      prompt: args.prompt,
      durationMinutes: Math.max(1, Math.floor(args.durationMinutes)),
      enrolledLimit: Math.max(1, Math.floor(args.enrolledLimit)),
    });
    return { ok: true };
  },
});

/** Close a room — final, no reopen anywhere. */
export const endRoom = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    const examiner = await requireExaminer(ctx);
    const room = await ctx.db.get(args.roomId);
    if (!room || room.examinerId !== examiner._id) {
      throw new Error("Room not found");
    }
    if (room.status === "CLOSED") return { ok: true };
    await ctx.db.patch(args.roomId, {
      status: "CLOSED",
      endedAt: Date.now(),
    });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Student join
// ---------------------------------------------------------------------------

/** Public: validate a room code (name + status only, no prompt). */
export const lookupRoomByCode = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", args.code))
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
    existingClientId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .unique();
    if (!room) {
      return {
        error: `No room found with code "${args.code}". Double-check it with your examiner.`,
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
        return { clientId: existing.clientId, studentId: existing._id, room };
      }
    }

    const clientId = randomToken();
    const studentId = await ctx.db.insert("students", {
      clientId,
      name: args.name,
      joinedAt: Date.now(),
      roomId: room._id,
    });
    return { clientId, studentId, room };
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

/** Student autosave (isFinal: false) or final submit (isFinal: true). */
export const saveSubmission = mutation({
  args: {
    clientId: v.string(),
    code: v.string(),
    isFinal: v.boolean(),
  },
  handler: async (ctx, args) => {
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
    const room = await ctx.db.get(args.roomId);
    if (!room || room.examinerId !== examiner._id) {
      return { error: "Room not found" } as const;
    }
    const students = await ctx.db
      .query("students")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .collect();
    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .collect();
    const byStudent = new Map(submissions.map((s) => [s.studentId, s]));
    const rows = students
      .map((student) => {
        const sub = byStudent.get(student._id);
        return {
          studentId: student._id,
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
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .unique();
    if (!room) return null;
    const students = await ctx.db
      .query("students")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();
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
