import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// ---------------------------------------------------------------------------
// HTTP surface. Beyond Convex Auth's own routes there is exactly ONE custom
// endpoint: the examiner's PDF submission download. It is a thin, auth-checked
// bridge — the browser's Convex Auth session is forwarded to a server-side
// auth query, which validates the export ticket and only then hands off to
// the internal PDF action. No PII moves anywhere without that double check.
// ---------------------------------------------------------------------------

const http = httpRouter();

auth.addHttpRoutes(http);

/**
 * GET /export/submission?ticket=... → application/pdf (Content-Disposition
 * attachment) or 404. The ticket is an opaque one-time token the examiner's
 * own session requested moments earlier; the PDF action consumes it single-use
 * and re-verifies room ownership from the database before generating bytes.
 */
http.route({
  path: "/export/submission",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const ticket = (url.searchParams.get("ticket") ?? "").trim();
    const filename = (url.searchParams.get("filename") ?? "").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 120) || "submission.pdf";

    if (!ticket) return new Response("Not found", { status: 404 });

    // Authenticate: forward the caller's Convex Auth session and ask the
    // server who this is. No session → no ticket validation at all.
    const authResult = await ctx.runQuery(internal.http_auth.resolveExportCaller, {
      ticket,
    });
    if (!authResult?.ok) {
      return new Response("Not found", { status: 404 });
    }

    const result = await ctx.runAction(internal.exams.exportSubmissionPdf, {
      ticket,
    });
    if (!result) return new Response("Not found", { status: 404 });

    const body = new Uint8Array(result.bytes as ArrayBuffer);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }),
});

export default http;
