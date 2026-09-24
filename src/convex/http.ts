import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

// ---------------------------------------------------------------------------
// HTTP surface. Beyond Convex Auth's own routes there is exactly ONE custom
// endpoint: the examiner's submission download. It is a thin, auth-checked
// bridge — the browser forwards its Convex Auth JWT in an Authorization
// header to a server-side auth query, which validates the export ticket and
// only then hands off to the internal action that returns the submission's
// ORIGINAL bytes. No PII moves anywhere without that double check.
//
// ORIGIN CONTRACT (this route caused a user-facing 404 before): this router
// is served from the Convex deployment's *.convex.site host, NOT the app's
// own origin. Clients MUST build the URL with the Convex site URL (see
// exportUrl in src/lib/submissionFiles.ts) — a relative /export/submission
// path resolves against the app origin, where only the SPA exists (the old
// 404). The client also sends `Authorization: Bearer <JWT>` via
// useAuthToken(); a bare navigation sends no header and gets a deliberate
// 404 — anonymous callers never even reach ticket validation.
// ---------------------------------------------------------------------------

const http = httpRouter();

auth.addHttpRoutes(http);

/**
 * GET /export/submission?ticket=... → text/plain (Content-Disposition
 * attachment, UTF-8) or 404. The ticket is an opaque one-time token the
 * examiner's own session requested moments earlier; the action consumes it
 * single-use and re-verifies room ownership from the database before
 * returning the original bytes.
 */
http.route({
  path: "/export/submission",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const ticket = (url.searchParams.get("ticket") ?? "").trim();

    if (!ticket) return new Response("Not found", { status: 404 });

    // Authenticate: forward the caller's Convex Auth JWT and ask the server
    // who this is. No valid session → 404 before any ticket work.
    const authResult = await ctx.runQuery(internal.http_auth.resolveExportCaller, {
      ticket,
    });
    if (!authResult?.ok) {
      return new Response("Not found", { status: 404 });
    }

    const result = await ctx.runAction(internal.exams.exportSubmissionFile, {
      ticket,
    });
    if (!result) return new Response("Not found", { status: 404 });

    // The filename is computed SERVER-SIDE from the authoritative rows and
    // comes back with the action result — never from the query string, so
    // Content-Disposition can never be attacker-influenced.
    const body = new Uint8Array(result.bytes as ArrayBuffer);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }),
});

export default http;
