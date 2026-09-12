import { Email } from "@convex-dev/auth/providers/Email";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";

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

export const emailOtp = Email({
  id: "email-otp",
  maxAge: 60 * 15, // 15 minutes
  // This function can be asynchronous
  async generateVerificationToken() {
    const random: RandomReader = {
      read(bytes: Uint8Array) {
        crypto.getRandomValues(bytes);
      },
    };
    const alphabet = "0123456789";
    return generateRandomString(random, alphabet, 6);
  },
  async sendVerificationRequest({ identifier: email, token }) {
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
  },
});
