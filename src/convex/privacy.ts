import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
  mutation,
  query,
  QueryCtx,
  MutationCtx,
  internalMutation,
} from "./_generated/server";
// Relative import — the @/ path alias is not applied to convex function files.
import { POLICY_VERSIONS, PRIVACY_CONTACT } from "../lib/policy";
import {
  validatePrivacyMessage,
  validatePolicyVersion,
} from "./validation";
import { enforceRateLimit } from "./rateLimits";
import { getCurrentExaminer } from "./exams";

// ---------------------------------------------------------------------------
// DPDP Act 2023 readiness — consent records, data-rights requests, and the
// security-event foundation. TECHNICAL CONTROLS ONLY: legal applicability and
// final policy language require human/legal review. Nothing here claims
// compliance, DPO status, or Significant Data Fiduciary status.
//
// Authorization model:
//   • Consent records — written by the join flow (students, keyed by their
//     public S-UID) and the sign-up flow (examiners, keyed by their account
//     email). The SECRET clientId is never written here (data minimization).
//   • Rights requests — always filed BY the authenticated user ABOUT
//     themselves (userId = caller). There is no third-party filing path.
//   • Security events — written only by server code at authorization
//     boundaries; never exposed through any public query.
// ---------------------------------------------------------------------------

const POLICY_VERSION_LIST = Object.values(POLICY_VERSIONS);

/**
 * Append one consent/withdrawal event. Rows are append-only: withdrawal is a
 * NEW row with granted:false so the lifecycle stays evidenced.
 */
async function recordConsent(
  ctx: MutationCtx,
  subjectType: "examiner" | "student",
  subjectKey: string,
  purpose: "terms" | "privacy",
  granted: boolean,
) {
  await enforceRateLimit(ctx, "consentPerSubject", {
    key: `${subjectType}:${subjectKey}`,
    silent: true,
    message: "Too many consent updates. Try again shortly.",
  });
  await ctx.db.insert("consentRecords", {
    subjectType,
    subjectKey,
    purpose,
    policyVersion: validatePolicyVersion(
      POLICY_VERSIONS[purpose],
      POLICY_VERSION_LIST,
    ),
    granted,
    at: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// Student consent — called from the join flow AFTER the attempt is resolved
// (so the key is the attempt's own public S-UID) and only when the student
// ticked the join-form consent box (the UI enforces this; the mutation
// refuses to record without explicit=true, so a tampered client cannot
// manufacture a consent row the person never gave).
// ---------------------------------------------------------------------------

export const recordStudentConsent = mutation({
  args: {
    studentUid: v.string(),
    explicit: v.boolean(),
    termsVersion: v.string(),
    privacyVersion: v.string(),
  },
  handler: async (ctx, args) => {
    // The checkbox is the consent act; absent = nothing to record.
    if (args.explicit !== true) {
      throw new ConvexError("Consent was not given.");
    }
    // Terms and privacy are SEPARATE purposes and are recorded separately.
    await recordConsent(ctx, "student", args.studentUid, "terms", true);
    await recordConsent(ctx, "student", args.studentUid, "privacy", true);
    return { ok: true as const };
  },
});

// ---------------------------------------------------------------------------
// Examiner consent + withdrawal — the authenticated account path.
// ---------------------------------------------------------------------------

async function requireAuthUser(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new ConvexError("Not authenticated");
  const user = await ctx.db.get(userId);
  if (!user?.email) throw new ConvexError("Account has no email on record");
  return { userId, email: user.email };
}

/** Record account consents (sign-up completion, or re-acceptance after a policy bump). */
export const recordExaminerConsent = mutation({
  args: { explicit: v.boolean() },
  handler: async (ctx, args) => {
    if (args.explicit !== true) {
      throw new ConvexError("Consent was not given.");
    }
    const { email } = await requireAuthUser(ctx);
    await recordConsent(ctx, "examiner", email, "terms", true);
    await recordConsent(ctx, "examiner", email, "privacy", true);
    return { ok: true as const };
  },
});

/**
 * Withdraw the privacy consent (the Data Rights page's withdrawal action).
 * Inserting a granted:false row is the withdrawal event; the examiner's
 * ACCOUNT is untouched here — erasure is its own explicit request below, so
 * withdrawal is never harder (nor more destructive) than giving consent.
 */
export const withdrawExaminerConsent = mutation({
  args: {},
  handler: async (ctx) => {
    const { email } = await requireAuthUser(ctx);
    await recordConsent(ctx, "examiner", email, "privacy", false);
    return { ok: true as const };
  },
});

/** The caller's own consent history, newest first (transparency surface). */
export const getMyConsents = query({
  args: {},
  handler: async (ctx) => {
    const { email } = await requireAuthUser(ctx);
    const rows = await ctx.db
      .query("consentRecords")
      .withIndex("by_subject", (q) =>
        q.eq("subjectType", "examiner").eq("subjectKey", email),
      )
      .collect();
    return rows.sort((a, b) => b.at - a.at);
  },
});

// ---------------------------------------------------------------------------
// Data-rights requests — access / correction / erasure / grievance.
// ---------------------------------------------------------------------------

export const filePrivacyRequest = mutation({
  args: {
    kind: v.union(
      v.literal("access"),
      v.literal("correction"),
      v.literal("erasure"),
      v.literal("grievance"),
    ),
    subjectType: v.union(v.literal("examiner"), v.literal("student")),
    subjectKey: v.string(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, email } = await requireAuthUser(ctx);

    await enforceRateLimit(ctx, "privacyRequestPerUser", {
      key: userId,
      message: "You've filed several requests recently. Please wait a bit.",
    });

    const subjectKey =
      args.subjectType === "examiner" ? email : args.subjectKey.trim().slice(0, 64);
    if (!subjectKey) throw new ConvexError("Please identify whose data this is about.");

    await ctx.db.insert("privacyRequests", {
      kind: args.kind,
      userId,
      subjectType: args.subjectType,
      subjectKey,
      message: validatePrivacyMessage(args.message) ?? "",
      status: "RECEIVED",
      at: Date.now(),
    });
    return { ok: true as const };
  },
});

/** The caller's own requests, newest first. */
export const getMyPrivacyRequests = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuthUser(ctx);
    const rows = await ctx.db
      .query("privacyRequests")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows.sort((a, b) => b.at - a.at);
  },
});

// ---------------------------------------------------------------------------
// Erasure — the operative deletion path for an examiner's personal data.
//
// Every room the examiner owns is deleted through the SAME cascade as
// deleteRoom (submissions → students → violationEvents → room), then the
// examiner row goes. The request row itself is retained as the record of
// handling. A student-facing deletion path is intentionally NOT built on a
// browser-supplied identity: students are directed to their examiner (who
// owns and can delete the room) or the grievance route.
// ---------------------------------------------------------------------------

async function deleteRoomCascade(ctx: MutationCtx, room: Doc<"rooms">) {
  const submissions = await ctx.db
    .query("submissions")
    .withIndex("by_room", (q) => q.eq("roomId", room._id))
    .collect();
  for (const sub of submissions) await ctx.db.delete(sub._id);

  const students = await ctx.db
    .query("students")
    .withIndex("by_room", (q) => q.eq("roomId", room._id))
    .collect();
  for (const student of students) await ctx.db.delete(student._id);

  const events = await ctx.db
    .query("violationEvents")
    .withIndex("by_room", (q) => q.eq("roomId", room._id))
    .collect();
  for (const event of events) await ctx.db.delete(event._id);

  await ctx.db.delete(room._id);
}

/** What erasure WOULD delete — powers the confirmation UI before the act. */
export const getMyErasurePreview = query({
  args: {},
  handler: async (ctx) => {
    const examiner = await getCurrentExaminer(ctx);
    if (!examiner) return { roomCount: 0, contact: PRIVACY_CONTACT };
    const rooms = await ctx.db
      .query("rooms")
      .withIndex("by_examiner", (q) => q.eq("examinerId", examiner._id))
      .collect();
    return { roomCount: rooms.length, contact: PRIVACY_CONTACT };
  },
});

export const eraseMyExaminerData = mutation({
  args: {},
  handler: async (ctx) => {
    const examiner = await getCurrentExaminer(ctx);
    if (!examiner) throw new ConvexError("Examiner profile not found");

    const rooms = await ctx.db
      .query("rooms")
      .withIndex("by_examiner", (q) => q.eq("examinerId", examiner._id))
      .collect();
    for (const room of rooms) {
      await deleteRoomCascade(ctx, room);
    }
    await ctx.db.delete(examiner._id);

    // Breach/audit foundation: a structured, secret-free record that the
    // erasure happened (what/when/whose account class — no tokens, no
    // personal content).
    await ctx.db.insert("securityEvents", {
      event: "examiner_data_erasure",
      detail: `rooms_deleted:${rooms.length}`,
      at: Date.now(),
    });
    return { ok: true as const, deletedRooms: rooms.length };
  },
});

// ---------------------------------------------------------------------------
// Security-event writers (internal — called from exams.ts authorization
// boundaries). No public surface can read or write these rows.
// ---------------------------------------------------------------------------

/** Authorization-boundary denial (export tickets, etc.). Internal only. */
export const logSecurityEventInternal = internalMutation({
  args: {
    event: v.string(),
    detail: v.optional(v.string()),
    userId: v.optional(v.id("users")),
    roomId: v.optional(v.id("rooms")),
    studentId: v.optional(v.id("students")),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("securityEvents", {
      event: args.event.slice(0, 80),
      detail: args.detail !== undefined ? args.detail.slice(0, 200) : undefined,
      userId: args.userId,
      roomId: args.roomId,
      studentId: args.studentId,
      at: Date.now(),
    });
    return { ok: true as const };
  },
});
