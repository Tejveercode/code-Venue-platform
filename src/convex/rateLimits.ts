import { ConvexError } from "convex/values";
import { RateLimiter, SECOND, MINUTE, HOUR } from "@convex-dev/rate-limiter";
import type { RunMutationCtx, RateLimitConfig } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";

// ---------------------------------------------------------------------------
// Rate limits — EVERY threshold lives here. Change values, nothing else.
//
// Algorithms:
//   "token bucket"  — refills smoothly (rate per period), allows short bursts
//                     up to `capacity`. Used where legit users can spike
//                     (resends, retries) but sustained spam must be capped.
//   "fixed window"  — a hard quota per window. Used for coarse global caps.
//
// Note on auth: OTP *verification* is additionally protected natively by
// @convex-dev/auth's failed-attempt limiter — 10 failed attempts/hour per
// identifier (refill-based, exponential-style backoff, no hard lockout),
// configurable via convexAuth({ signIn: { maxFailedAttempsPerHour } }).
// OTP *send* limits (otpSendPerEmail / otpSendGlobal) are enforced inside
// the email provider (auth/emailOtp.ts): the auth component's signIn action
// is the ONLY client-reachable path for sending codes, so these cannot be
// bypassed. -----------------------------------------------------------------
// ---------------------------------------------------------------------------

export const RATE_LIMITS = {
  // --- Auth: requesting an OTP code (strictest) -----------------------------
  // Per email: 3 quick resends (capacity), then refills 1 per 2 minutes.
  otpSendPerEmail: {
    kind: "token bucket",
    rate: 5,
    period: 10 * MINUTE,
    capacity: 3,
  },
  // Global ceiling so one script rotating addresses can't drain the email
  // provider's quota (and budget).
  otpSendGlobal: {
    kind: "fixed window",
    rate: 120,
    period: HOUR,
  },

  // --- Auth: verifying an OTP code (defense in depth; auth lib also limits
  // failed attempts per email natively) --------------------------------------
  otpVerifyPerEmail: {
    kind: "token bucket",
    rate: 20,
    period: HOUR,
    capacity: 10,
  },
  otpVerifyGlobal: {
    kind: "fixed window",
    rate: 600,
    period: HOUR,
  },

  // --- Room join (moderate — resist brute-forcing the 10,000-code space) ----
  // Per browser session: 5 quick (re)joins, then refills 1 per 6s. A whole
  // classroom joining at once is fine: the limit is per device, not per room.
  joinPerSession: {
    kind: "token bucket",
    rate: 10,
    period: MINUTE,
    capacity: 5,
  },
  // Per room code: protects one room from targeted guessing; sized above the
  // largest realistic class joining in a minute.
  joinPerCode: {
    kind: "fixed window",
    rate: 60,
    period: MINUTE,
  },

  // --- Student autosave (loose — fires every few seconds while typing) ------
  // Debounced autosave is ~24 writes/min; 60/min refill with a 30-write burst
  // absorbs fast typers and network retries while still capping abuse.
  autosavePerStudent: {
    kind: "token bucket",
    rate: 60,
    period: MINUTE,
    capacity: 30,
  },

  // --- Student final submit --------------------------------------------------
  submitPerStudent: {
    kind: "token bucket",
    rate: 15,
    period: MINUTE,
    capacity: 5,
  },

  // --- Examiner room creation ------------------------------------------------
  createRoomPerExaminer: {
    kind: "fixed window",
    rate: 20,
    period: HOUR,
  },
} satisfies Record<string, RateLimitConfig>;

export const rateLimiter = new RateLimiter(components.rateLimiter, RATE_LIMITS);

export type RateLimitName = Extract<keyof typeof RATE_LIMITS, string>;

type EnforceOptions = {
  /** Per-identity key (email, clientId, room code, …). Omit for global. */
  key?: string;
  /** Units to consume (defaults to 1). */
  count?: number;
  /** User-facing message shown when the limit is hit. */
  message: string;
  /**
   * When true, return false instead of throwing. Use for background flows
   * (autosave) where a thrown error would disrupt the user.
   */
  silent?: boolean;
};

/**
 * Consume a rate limit. Returns true when allowed. When the limit is exceeded:
 * throws a ConvexError with a friendly message + wait time (loud mode), or
 * returns false (silent mode).
 *
 * Fails OPEN if the limiter itself errors (availability over strictness) —
 * the failure is logged to the Convex function logs for diagnosis.
 */
export async function enforceRateLimit(
  ctx: RunMutationCtx,
  name: RateLimitName,
  opts: EnforceOptions,
): Promise<boolean> {
  let status: { ok: boolean; retryAfter?: number };
  try {
    status = await rateLimiter.limit(ctx, name, {
      key: opts.key,
      count: opts.count,
    });
  } catch (error) {
    console.error(`[rateLimits] limiter error on "${name}" (failing open)`, error);
    return true;
  }
  if (status.ok) return true;
  if (opts.silent) return false;

  const seconds = Math.ceil((status.retryAfter ?? 60 * SECOND) / SECOND);
  const wait =
    seconds >= 90
      ? `about ${Math.ceil(seconds / 60)} minutes`
      : `${seconds} second${seconds === 1 ? "" : "s"}`;
  throw new ConvexError(`${opts.message} Try again in ${wait}.`);
}
