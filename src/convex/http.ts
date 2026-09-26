import { httpRouter } from "convex/server";
import { auth } from "./auth"; // registers Convex Auth's /api/auth/* routes (sign-in)
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
//
// CORS CONTRACT (this gap caused the deployed "download won't start" +
// "empty ZIP" failures): the app origin and this route's origin differ, and
// the fetch carries an Authorization header — a NON-safelisted header — so
// the browser MUST preflight (OPTIONS) before sending the real GET, and the
// GET response must carry Access-Control-Allow-Origin or the browser hides
// the response from JS entirely (fetch rejects with a TypeError that looked
// like an auth problem). Both are handled below: the OPTIONS route answers
// the preflight, and every response includes the ACAO header.
// ---------------------------------------------------------------------------

/**
 * CORS for the export route. `*` is safe here by construction: the response
 * carries no credentials (no cookies — auth travels in the caller's own
 * Authorization header), and every request is independently authorized
 * server-side (JWT identity + single-use ticket + ownership re-check), so
 * no origin gains anything by being allowed to READ a response it forced a
 * victim's browser to request.
 */
const EXPORT_CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
};

const http = httpRouter();

auth.addHttpRoutes(http);

/**
 * CORS preflight for the export download. The browser sends this BEFORE the
 * real GET whenever the request is cross-origin with an Authorization
 * header (always, for downloads from the app). Without this route Convex
 * answers 404 "No matching routes found" with no CORS headers, the browser
 * blocks the download, and the client sees an opaque network error.
 */
http.route({
  path: "/export/submission",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, request) => {
    // A valid preflight names the origin, the method it wants, and the
    // non-safelisted headers it will send ("authorization" for downloads).
    const reqHeaders = request.headers.get("Access-Control-Request-Headers");
    if (
      request.headers.get("Origin") === null ||
      request.headers.get("Access-Control-Request-Method") === null ||
      reqHeaders === null
    ) {
      return new Response(null, { status: 400 });
    }
    // Echo the requested headers back: the browser only ever asks for
    // "authorization" here, and anything else is irrelevant — the GET
    // handler reads exactly one header (Authorization) and ignores the rest.
    return new Response(null, {
      status: 204,
      headers: {
        ...EXPORT_CORS,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": reqHeaders,
        "Access-Control-Max-Age": "86400",
      },
    });
  }),
});

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

    if (!ticket) {
      console.error("[export] 400: missing ticket parameter");
      return new Response("Missing ticket", { status: 400, headers: EXPORT_CORS });
    }

    // Authenticate: read the caller's Convex Auth JWT from the Authorization
    // header. getUserIdentity() is the DOCUMENTED way to consume a Bearer
    // token inside an httpAction — the header is validated against this
    // deployment's auth.config.ts provider, and null means no/invalid token.
    // (This previously ran as a nested internalQuery via getAuthUserId; the
    // direct call is equivalent for this gate — "is there a live session?" —
    // with one less hop and no dependency on auth-context propagation into
    // nested queries. The ticket itself carries the real authorization: it
    // was minted by an owner-checked mutation and is consumed single-use,
    // re-verified against room ownership inside the action below.)
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      console.error(
        "[export] 401: no valid session on Authorization header (ticket present, len",
        ticket.length,
        ")",
      );
      return new Response("Not authenticated", {
        status: 401,
        headers: EXPORT_CORS,
      });
    }

    const result = await ctx.runAction(internal.exams.exportSubmissionFile, {
      ticket,
    });
    if (!result) {
      // Ticket unknown, expired (90s), already consumed, or its room/student
      // pair failed the ownership re-check. One status, four causes — all of
      // them "get a fresh ticket", never "retry this URL".
      console.error("[export] 404: ticket rejected by export action (expired, consumed, unknown, or ownership re-check failed)");
      return new Response("Export not found or expired", {
        status: 404,
        headers: EXPORT_CORS,
      });
    }

    // The filename is computed SERVER-SIDE from the authoritative rows and
    // comes back with the action result — never from the query string, so
    // Content-Disposition can never be attacker-influenced.
    const body = new Uint8Array(result.bytes as ArrayBuffer);
    return new Response(body, {
      status: 200,
      headers: {
        ...EXPORT_CORS,
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }),
});

export default http;
