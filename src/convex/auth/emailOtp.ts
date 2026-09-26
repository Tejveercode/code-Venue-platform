import { Email } from "@convex-dev/auth/providers/Email";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";
import { enforceRateLimit } from "../rateLimits";

// OTP delivery via Resend (replaced Freebuff's auth.freebuff.app/send_otp).
//
// Required env var, set on the Convex deployment (`npx convex env set ...`):
//   RESEND_API_KEY — from https://resend.com/api-keys
//
// Optional:
//   OTP_EMAIL_FROM — "Name <address>" sender identity. Defaults to Resend's
//   sandbox sender (onboarding@resend.dev), which ONLY delivers to your own
//   Resend account email until you verify a domain at resend.com/domains.
//   For real exam-day traffic, set OTP_EMAIL_FROM to an address on a
//   verified domain, e.g. "Code Venue <noreply@yourdomain.com>".
//
// Rate limiting (thresholds in ../rateLimits.ts):
//   - Per email: token bucket (burst + smooth refill) — blocks OTP-bombing a
//     single inbox while allowing legitimate resends.
//   - Global: fixed window per hour — caps the email budget a script
//     rotating addresses could drain.
//   The limiter FAILS OPEN on internal errors, so an outage in the limiter
//   component can never block sign-in. OTP *verification* is limited
//   natively by @convex-dev/auth (10 failed attempts/hour per identifier,
//   refill-based — no hard lockout).

/**
 * Runs inside the auth component's `signIn` mutation. The library passes its
 * mutation ctx as a second argument at runtime but omits it from the public
 * type, so the cast lives only at the call site below (the library itself
 * keeps a @ts-expect-error there for the same reason).
 */
async function sendVerificationRequest(
  { identifier: email, token }: { identifier: string; token: string },
  ctx?: unknown,
): Promise<void> {
  // TEMPORARY DEV TEST HOOK (remove before the production push): when
  // TEST_OTP_CODE is set on the deployment, sign-in accepts this fixed code
  // and no real email is sent, so automated end-to-end tests can drive a
  // genuine authenticated session. NEVER set TEST_OTP_CODE in production.
  if (process.env.TEST_OTP_CODE) {
    console.log(`[TEST MODE] OTP send suppressed for ${email} (fixed test code active)`);
    return;
  }
  if (ctx) {
    // Type comes from the runtime contract, not the library's declared
    // (single-param) signature — see note above.
    type LimitCtx = Parameters<typeof enforceRateLimit>[0];
    const limitCtx = ctx as LimitCtx;
    await enforceRateLimit(limitCtx, "otpSendPerEmail", {
      key: email,
      message: "Too many verification codes requested for this email.",
    });
    await enforceRateLimit(limitCtx, "otpSendGlobal", {
      message: "Sign-in is very busy right now.",
    });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error(
      "RESEND_API_KEY is not configured — set it on the Convex deployment with `npx convex env set RESEND_API_KEY ...` so OTP emails can be sent.",
    );
  }
  const from =
    process.env.OTP_EMAIL_FROM ?? "Code Venue <onboarding@resend.dev>";

  // Plain fetch: the Resend send API is a single authenticated POST, so no
  // SDK dependency is needed (works in Convex's default runtime).
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: `${token} is your Code Venue verification code`,
      text: [
        "Your Code Venue verification code is:",
        "",
        `  ${token}`,
        "",
        "It expires in 15 minutes. If you didn't request it, you can safely ignore this email.",
      ].join("\n"),
      html: [
        '<div style="margin:0;padding:24px;background:#faf6f0;font-family:Arial,Helvetica,sans-serif;">',
        '<div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #eadfcd;border-radius:12px;padding:32px;text-align:center;">',
        '<p style="margin:0 0 8px;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#8a7a63;">Code Venue</p>',
        '<h1 style="margin:0 0 20px;font-size:20px;color:#2b2118;">Your verification code</h1>',
        `<p style="margin:0 0 24px;font-size:36px;letter-spacing:8px;font-weight:700;color:#b5734a;">${token}</p>`,
        '<p style="margin:0 0 4px;font-size:13px;color:#6b5d4a;">This code expires in 15 minutes.</p>',
        '<p style="margin:0;font-size:13px;color:#6b5d4a;">If you didn\'t request it, you can safely ignore this email.</p>',
        "</div></div>",
      ].join(""),
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Resend OTP send failed (${response.status}): ${await response.text()}`,
    );
  }
}

export const emailOtp = Email({
  id: "email-otp",
  maxAge: 60 * 15, // 15 minutes
  // This function can be asynchronous
  async generateVerificationToken() {
    // TEMPORARY DEV TEST HOOK (remove before the production push): when
    // TEST_OTP_CODE is set on the deployment, the "generated" token IS the
    // fixed test code, so verification of that code succeeds without any
    // email being read. Pairs with the send-suppression below. NEVER set
    // TEST_OTP_CODE in production.
    if (process.env.TEST_OTP_CODE) return process.env.TEST_OTP_CODE;
    const random: RandomReader = {
      read(bytes: Uint8Array) {
        crypto.getRandomValues(bytes);
      },
    };
    const alphabet = "0123456789";
    return generateRandomString(random, alphabet, 6);
  },
  // The runtime signature includes the auth mutation ctx; the declared type
  // doesn't. Contained cast — the library's own call site suppresses this
  // same mismatch internally.
  sendVerificationRequest: sendVerificationRequest as unknown as (input: {
    identifier: string;
    token: string;
  }) => Promise<void>,
});
