import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // ---- Code Venue ----

    // An examiner identity tied to a signed-in auth user (one per user).
    examiners: defineTable({
      userId: v.id("users"),
      name: v.string(),
      email: v.string(),
      createdAt: v.number(),
      // False/absent until the examiner has seen their first-visit welcome
      // greeting in the portal (drives "Welcome" vs "Welcome back").
      welcomed: v.optional(v.boolean()),
    })
      .index("by_user", ["userId"])
      .index("by_email", ["email"]),

    // A live coding exam room. status mirrors RoomStatus: LIVE | CLOSED.
    rooms: defineTable({
      code: v.string(), // "CV-####", unique
      name: v.string(),
      prompt: v.string(),
      durationMinutes: v.number(),
      status: v.union(v.literal("LIVE"), v.literal("CLOSED")),
      enrolledLimit: v.number(),
      startedAt: v.number(),
      endedAt: v.optional(v.number()),
      examinerId: v.id("examiners"),
    })
      .index("by_code", ["code"])
      .index("by_examiner", ["examinerId"]),

    // A student identity inside one room. clientId is a client-generated
    // UUID echoed back on every request — the durable identity.
    // studentUid is a short public identifier (e.g. "S-7F3K2Q") shown to the
    // student and used in download filenames so same-named students never
    // collide — it is NOT a secret, unlike clientId.
    // regNo is the student's own institutional ID (e.g. "24BCA10210"), typed
    // at join. When present it takes precedence in download filenames.
    students: defineTable({
      clientId: v.string(), // unique, secret session token
      studentUid: v.string(), // unique, public short identifier
      regNo: v.optional(v.string()), // student-entered institutional ID
      name: v.string(),
      joinedAt: v.number(),
      roomId: v.id("rooms"),
    })
      .index("by_client_id", ["clientId"])
      .index("by_uid", ["studentUid"])
      .index("by_room", ["roomId"]),

    // One row per student, ever (studentId unique). Autosave upserts with
    // isFinal: false; Submit upserts with isFinal: true + submittedAt.
    submissions: defineTable({
      code: v.string(),
      isFinal: v.boolean(),
      updatedAt: v.number(),
      submittedAt: v.optional(v.number()),
      roomId: v.id("rooms"),
      studentId: v.id("students"),
    })
      .index("by_student", ["studentId"])
      .index("by_room", ["roomId"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
