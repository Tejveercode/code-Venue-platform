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
      // Exam-session monitoring. 0 or absent = zero-tolerance (first
      // violation flags the student); >0 = warnings until exceeded.
      violationLimit: v.optional(v.number()),
    })
      .index("by_code", ["code"])
      .index("by_examiner", ["examinerId"]),

    // A student identity inside one room — ONE row per exam ATTEMPT.
    //
    // Identity model (security audit — attempt isolation):
    //   clientId   = the SECRET capability token. All reads/writes resolve
    //                through it (requireStudentByClient); it is the only
    //                authorization path for submissions and monitoring.
    //   browserId  = an opaque client-generated browser-session id (optional,
    //                per-tab-flow, NOT a secret, NOT a permission). Stored so
    //                the SERVER can answer "may this browser resume attempt X
    //                or does its join describe a different attempt?" — the
    //                answer must live server-side because the browser cannot
    //                be trusted to send the right clientId. A resume is only
    //                ever granted when BOTH the presented clientId maps to a
    //                row in this room AND that row's name+regNo match what
    //                the joiner typed this time (see joinRoom). A different
    //                name or UID therefore always mints a NEW attempt and
    //                never inherits another attempt's submission.
    //   studentUid = short PUBLIC identifier ("S-7F3K2Q") shown to the student
    //                and used in export filenames so same-named students never
    //                collide — NOT a secret, unlike clientId.
    //   regNo      = the student's own institutional ID (e.g. "24BCA10210").
    //                Never treated as authentication — display/label only.
    students: defineTable({
      clientId: v.string(), // unique, secret session token
      browserId: v.optional(v.string()), // opaque browser-session id (non-secret)
      studentUid: v.string(), // unique, public short identifier
      regNo: v.optional(v.string()), // student-entered institutional ID
      name: v.string(),
      joinedAt: v.number(),
      roomId: v.id("rooms"),
      // Monitoring tallies (server-maintained; clients never send counts).
      violationCount: v.optional(v.number()),
      // Zero-tolerance flag: first violation marked this student suspicious.
      flagged: v.optional(v.boolean()),
      // Server auto-submitted this student for exceeding the violation limit.
      autoSubmittedAt: v.optional(v.number()),
    })
      .index("by_client_id", ["clientId"])
      .index("by_browser", ["browserId"])
      .index("by_uid", ["studentUid"])
      .index("by_room", ["roomId"]),

    // One row per student, ever (studentId unique). Autosave upserts with
    // isFinal: false; Submit upserts with isFinal: true + submittedAt.
    // rev is the client's monotonic edit counter: the server refuses a
    // non-final write whose rev is not newer than the stored one, so a slow
    // in-flight autosave can never overwrite newer persisted content.
    submissions: defineTable({
      code: v.string(),
      isFinal: v.boolean(),
      updatedAt: v.number(),
      submittedAt: v.optional(v.number()),
      rev: v.optional(v.number()),
      roomId: v.id("rooms"),
      studentId: v.id("students"),
    })
      .index("by_student", ["studentId"])
      .index("by_room", ["roomId"]),

    // One timestamped exam-session monitoring event per occurrence, written
    // by the server as the client reports events. Contents never include
    // clipboard data — only the event type and time.
    violationEvents: defineTable({
      roomId: v.id("rooms"),
      studentId: v.id("students"),
      type: v.union(
        v.literal("blur"), // tab switch / window blur
        v.literal("paste"), // paste into the code editor
        v.literal("copy"), // copy out of the code editor
        v.literal("rejoin"), // exam page load for this clientId (incl. first)
      ),
      at: v.number(),
    })
      .index("by_room", ["roomId"])
      .index("by_student", ["studentId"]),

    // ---- DPDP Act 2023 readiness (technical controls) ------------------------
    // Every record below is written ONLY by server mutations after their own
    // authorization checks. The legal notice text itself lives in versioned
    // policy constants (src/lib/policy.ts) so the recorded version always
    // matches the notice a person actually saw.

    // Separately-recorded consents. One row per (subject, purpose, version):
    // terms acceptance and privacy consent are distinct purposes and are
    // never bundled into one checkbox. Withdrawal inserts a new row with
    // granted:false — history is append-only so a withdrawal event can be
    // evidenced later. Rows are keyed by email for examiners (authenticated)
    // and by studentUid for students (their one public identifier; the
    // secret clientId is deliberately NOT written here — data minimization).
    consentRecords: defineTable({
      subjectType: v.union(v.literal("examiner"), v.literal("student")),
      subjectKey: v.string(), // email (examiner) or studentUid (student)
      purpose: v.union(v.literal("terms"), v.literal("privacy")),
      policyVersion: v.string(), // matches the notice shown at consent time
      granted: v.boolean(), // false = withdrawal event
      at: v.number(),
    })
      .index("by_subject", ["subjectType", "subjectKey"]),

    // Data-rights requests (access / correction / erasure / grievance).
    // Self-service: an examiner files for their own account; erasure deletes
    // the examiner's rooms (with students, submissions, events) through the
    // same cascade as deleteRoom, then removes the examiner row. The request
    // row itself is retained as the record of handling (legitimate purpose:
    // evidencing the response). Students' exam data is scoped by the examiner
    // who owns their room — the notice directs students to their institution.
    privacyRequests: defineTable({
      kind: v.union(
        v.literal("access"),
        v.literal("correction"),
        v.literal("erasure"),
        v.literal("grievance"),
      ),
      userId: v.id("users"), // always the CALLER — no third-party filing path
      subjectType: v.union(v.literal("examiner"), v.literal("student")),
      subjectKey: v.string(),
      message: v.string(), // free text, capped in limits.ts, optional
      status: v.union(v.literal("RECEIVED"), v.literal("COMPLETED")),
      at: v.number(),
    }).index("by_user", ["userId"]),

    // Security-event foundation (breach readiness): structured rows written
    // by server mutations at authorization-boundary failures. Contents are
    // deliberately minimal (event class + identifiers + time) — never tokens,
    // never personal content. Convex function logs are the raw stream; these
    // rows are the queryable index a breach assessment needs.
    securityEvents: defineTable({
      event: v.string(), // e.g. "export_ticket_denied", "examiner_erasure"
      detail: v.optional(v.string()), // capped short string, no secrets
      userId: v.optional(v.id("users")),
      roomId: v.optional(v.id("rooms")),
      studentId: v.optional(v.id("students")),
      at: v.number(),
    }).index("by_event", ["event"]),

    // ---- Submission export (original file, server-authorized) ----------------
    // A ONE-TIME, 90-second ticket binding (examiner, room, student) to a
    // SHA-256 hash of a random token. The ticket itself is never stored —
    // only its hash — so a database snapshot cannot mint export URLs. The
    // export action re-verifies ownership and submission existence at
    // download time; a consumed ticket is deleted before generation (single
    // use).
    exportTickets: defineTable({
      ticketHash: v.string(), // SHA-256 hex of the opaque ticket
      examinerId: v.id("examiners"), // re-verified by the generator
      roomId: v.id("rooms"),
      studentId: v.id("students"),
      exp: v.number(),
    })
      .index("by_hash", ["ticketHash"])
      .index("by_room", ["roomId"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
