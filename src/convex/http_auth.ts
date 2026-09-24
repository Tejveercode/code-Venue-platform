import { getAuthUserId } from "@convex-dev/auth/server";
import { internalQuery } from "./_generated/server";
import { v } from "convex/values";

// ---------------------------------------------------------------------------
// Internal authorization check for the /export/submission HTTP route.
//
// The route forwards the caller's browser session here; this query answers
// one question only: "is the caller a signed-in examiner?" It deliberately
// does NOT validate the ticket's contents — that is the PDF action's job
// (single-use consumption, expiry, ownership re-check) — it just guarantees
// that anonymous callers can never even attempt ticket validation.
// ---------------------------------------------------------------------------

export const resolveExportCaller = internalQuery({
  args: { ticket: v.string() },
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { ok: false as const };
    const user = await ctx.db.get(userId);
    if (!user) return { ok: false as const };
    return { ok: true as const, userId };
  },
});
