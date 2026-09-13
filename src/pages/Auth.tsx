import { api } from "@/convex/_generated/api";
import { CodeVenuePage } from "@/components/venue/ui";
import { useAuth } from "@/hooks/use-auth";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Suspense, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useMutation } from "convex/react";
import { getErrorMessage } from "@/lib/errors";

function resolveRedirectAfterAuth(
  returnTo: string | null,
  fallback = "/examiner-portal",
) {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) {
    return returnTo;
  }
  return fallback;
}

/**
 * sessionStorage state of an in-progress sign-in. Mobile browsers reload the
 * page when it is backgrounded (switching to the mail app to fetch the code)
 * — React state dies with the page. Persisting the flow means the reload
 * lands back on the same step with the email filled in, instead of firing a
 * SECOND OTP (the loop).
 */
type PendingFlow = { email: string; step: "code" | "name"; at: number };
const PENDING_FLOW_KEY = "cv_pending_otp_flow";
const PENDING_FLOW_TTL_MS = 15 * 60_000; // OTP validity window

/** Retries for the post-verification next-step decision before failing open. */
const NEXT_STEP_RETRIES = 3;
const NEXT_STEP_RETRY_DELAY_MS = 300;

function loadPendingFlow(): PendingFlow | null {
  try {
    const raw = sessionStorage.getItem(PENDING_FLOW_KEY);
    if (!raw) return null;
    const flow = JSON.parse(raw) as PendingFlow;
    if (!flow?.email || Date.now() - flow.at > PENDING_FLOW_TTL_MS) {
      sessionStorage.removeItem(PENDING_FLOW_KEY);
      return null;
    }
    return flow;
  } catch {
    return null;
  }
}

function savePendingFlow(flow: PendingFlow) {
  try {
    sessionStorage.setItem(PENDING_FLOW_KEY, JSON.stringify(flow));
  } catch {
    // storage unavailable — flow simply won't survive a reload
  }
}

function clearPendingFlow() {
  try {
    sessionStorage.removeItem(PENDING_FLOW_KEY);
  } catch {
    // ignore
  }
}

type Step = "email" | "code" | "name";

function AuthCard() {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const setExaminerName = useMutation(api.exams.setExaminerName);
  const signInNextStep = useMutation(api.exams.signInNextStep);
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(searchParams.get("returnTo"));

  // Resume an interrupted flow (mobile reload) at the saved step. There is
  // deliberately NO name field before verification: the name is asked once,
  // AFTER the code is verified, and only when the account is actually new.
  const [resumedFlow] = useState(loadPendingFlow);
  const [step, setStep] = useState<Step>(
    resumedFlow ? resumedFlow.step : "email",
  );
  const [email, setEmail] = useState(resumedFlow?.email ?? "");
  const [name, setName] = useState("");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Dedupes the post-auth decision across StrictMode's double effect run.
  const decidingRef = useRef(false);

  /**
   * Already-signed-in visitors: decide the next step server-side.
   *   - Returning examiner (examiner row exists) → straight to the portal,
   *     no name prompt, ever.
   *   - Authenticated but no examiner row → the ONE-TIME name step (this is
   *     account creation). Also catches a user who verified their code but
   *     closed the tab before naming themselves.
   *
   * A mutation — not the reactive examiner query — so the answer always
   * reflects the freshly-established session (reactive queries can briefly
   * serve results computed before sign-in, which would flash the name prompt
   * at returning examiners).
   */
  useEffect(() => {
    if (
      authLoading ||
      !isAuthenticated ||
      step !== "email" ||
      decidingRef.current
    ) {
      return;
    }
    decidingRef.current = true;
    const decide = async (attempt = 0) => {
      try {
        const { needsName } = await signInNextStep({});
        if (needsName) {
          setStep("name");
        } else {
          clearPendingFlow();
          navigate(redirect, { replace: true });
        }
      } catch (err) {
        if (attempt < NEXT_STEP_RETRIES) {
          setTimeout(() => void decide(attempt + 1), NEXT_STEP_RETRY_DELAY_MS);
          return;
        }
        // Auth is established but the decision failed — fail open to the
        // portal, which provisions any missing examiner row on arrival.
        // Failing to the name step instead could wrongly prompt a returning
        // examiner for their name.
        console.warn("[auth] sign-in next-step check failed", err);
        clearPendingFlow();
        navigate(redirect, { replace: true });
      }
    };
    void decide();
  }, [authLoading, isAuthenticated, step, navigate, redirect, signInNextStep]);

  const handleEmailSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("email", email);
      await signIn("email-otp", formData);
      savePendingFlow({ email, step: "code", at: Date.now() });
      setStep("code");
    } catch (err) {
      // ConvexError (e.g. rate limits) carries a safe user-facing message;
      // everything else (internal errors, stack traces) becomes generic.
      setError(
        getErrorMessage(
          err,
          "Failed to send the verification code. Please try again.",
        ),
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("email", email);
      formData.set("code", otp);
      await signIn("email-otp", formData);
    } catch (err) {
      // Rate-limit errors carry actionable messages; all other failures read
      // as a wrong code (the overwhelmingly common case).
      setError(
        getErrorMessage(err, "The verification code you entered is incorrect."),
      );
      setOtp("");
      setIsLoading(false);
      return;
    }

    // Verified. Ask the backend what this account still needs so the
    // experience is identical for new and returning examiners except for the
    // one-time name prompt.
    const nextStepWithRetry = async (): Promise<boolean> => {
      for (let attempt = 0; ; attempt++) {
        try {
          return (await signInNextStep({})).needsName;
        } catch (err) {
          if (attempt >= NEXT_STEP_RETRIES) throw err;
          await new Promise((resolve) =>
            setTimeout(resolve, NEXT_STEP_RETRY_DELAY_MS),
          );
        }
      }
    };

    let needsName: boolean;
    try {
      needsName = await nextStepWithRetry();
    } catch (err) {
      console.warn("[auth] sign-in next-step check failed", err);
      clearPendingFlow();
      navigate(redirect, { replace: true });
      setIsLoading(false);
      return;
    }

    if (needsName) {
      savePendingFlow({ email, step: "name", at: Date.now() });
      setStep("name");
    } else {
      clearPendingFlow();
      navigate(redirect, { replace: true });
    }
    setIsLoading(false);
  };

  const handleNameSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      // Creation-safe write: never overwrites an existing examiner's stored
      // name (server-enforced — see setExaminerName).
      await setExaminerName({ name: name.trim() });
      clearPendingFlow();
      navigate(redirect, { replace: true });
    } catch (err) {
      setError(getErrorMessage(err, "Something went wrong. Please try again."));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="cv-center">
      <div className="cv-card cv-auth-card">
        <h1 className="cv-auth-title">
          {step === "name" ? "One last thing" : "Sign in to Code Venue"}
        </h1>
        <p className="cv-auth-sub">
          {step === "email" &&
            "Enter your email and we'll send you a one-time sign-in code."}
          {step === "code" && (
            <>
              We sent a 6-digit code to {email}. It expires in 15 minutes.
            </>
          )}
          {step === "name" &&
            "Choose the name your dashboard and students will see. You can change it anytime from Profile."}
        </p>

        {error && <span className="cv-error">{error}</span>}

        {step === "email" && (
          <form onSubmit={handleEmailSubmit}>
            <div className="cv-field">
              <label className="cv-label" htmlFor="cv-email">
                Email
              </label>
              <input
                id="cv-email"
                className="cv-input"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@school.edu"
                autoComplete="email"
                disabled={isLoading}
              />
            </div>
            <button
              type="submit"
              className="cv-btn cv-btn-primary cv-btn-block"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Sending code…
                </>
              ) : (
                "Continue with email"
              )}
            </button>
          </form>
        )}

        {step === "code" && (
          <form onSubmit={handleOtpSubmit}>
            <div className="cv-field">
              <label className="cv-label" htmlFor="cv-otp">
                Verification code <span>· sent to {email}</span>
              </label>
              <input
                id="cv-otp"
                className="cv-input cv-otp-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                disabled={isLoading}
              />
            </div>
            <button
              type="submit"
              className="cv-btn cv-btn-primary cv-btn-block"
              disabled={isLoading || otp.length !== 6}
            >
              {isLoading ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Verifying…
                </>
              ) : (
                "Verify code"
              )}
            </button>
            <p className="cv-form-footer">
              Didn't get it?{" "}
              <button
                type="button"
                onClick={() => {
                  clearPendingFlow();
                  setOtp("");
                  setStep("email");
                }}
              >
                Use a different email
              </button>
            </p>
          </form>
        )}

        {step === "name" && (
          <form onSubmit={handleNameSubmit}>
            <div className="cv-field">
              <label className="cv-label" htmlFor="cv-name">
                Your name
              </label>
              <input
                id="cv-name"
                className="cv-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ada Lovelace"
                autoComplete="name"
                maxLength={80}
                required
                disabled={isLoading}
              />
            </div>
            <button
              type="submit"
              className="cv-btn cv-btn-primary cv-btn-block"
              disabled={isLoading || !name.trim()}
            >
              {isLoading ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Saving…
                </>
              ) : (
                "Continue"
              )}
            </button>
          </form>
        )}

        <p className="cv-form-footer" style={{ marginTop: 16 }}>
          <Link to="/" className="cv-back-link" style={{ marginBottom: 0 }}>
            <ArrowLeft size={14} /> Back to home
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function AuthPage() {
  return (
    <CodeVenuePage>
      <Suspense
        fallback={
          <div className="cv-center">
            <Loader2 className="animate-spin" style={{ color: "var(--accent-caramel)" }} />
          </div>
        }
      >
        <AuthCard />
      </Suspense>
    </CodeVenuePage>
  );
}
