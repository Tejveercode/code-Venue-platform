import type { AuthConfig } from "convex/server";

// Standalone hosting: only the standard Convex Auth provider below.
// (The Freebuff federation provider — a `customJwt` entry whose issuer came
// from VLY_CONVEX_AUTH_ISSUER — was removed when moving off Freebuff's
// infrastructure; it required a platform-injected env var and JWKS endpoint
// that don't exist on a self-hosted Convex deployment. This app's sign-in
// flows never used it: examiner email OTP and guest sign-in both go through
// the standard provider.)

export default {
  providers: [
    // Standard Convex Auth provider for this project's own sign-in ("Get
    // Started" email/guest, see src/convex/auth.ts). The deployment
    // self-issues JWTs (iss = CONVEX_SITE_URL, no `kid` header) validated
    // via OIDC discovery at `${domain}/.well-known/openid-configuration`,
    // served by auth.addHttpRoutes() in convex/http.ts. Do NOT convert this
    // entry to `type: "customJwt"` — that path rejects tokens without a
    // `kid` header, so sign-in would silently never confirm and RequireAuth
    // would loop back to /auth forever.
    {
      domain: process.env.CONVEX_SITE_URL!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
