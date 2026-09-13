// Convex Auth configuration — email OTP is the ONLY provider.
//
// The Anonymous provider that the starter template registered here was
// removed (security audit: unused attack surface) — nothing in the app ever
// called signIn("anonymous"), and an open provider lets anyone mint a
// session and provision junk examiner rows. If a genuinely anonymous flow
// is ever wanted, re-add it deliberately with its own constraints.

import { convexAuth } from "@convex-dev/auth/server";
import { emailOtp } from "./auth/emailOtp";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [emailOtp],
});
