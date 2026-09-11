import { api } from "@/convex/_generated/api";
import { CodeVenuePage } from "@/components/venue/ui";
import { useAuth } from "@/hooks/use-auth";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useMutation } from "convex/react";

function resolveRedirectAfterAuth(
  returnTo: string | null,
  fallback = "/examiner-portal",
) {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) {
    return returnTo;
  }
  return fallback;
}

type Mode = "signin" | "signup";

/**
 * sessionStorage key holding the typed signup name until the portal consumes
 * it — covers the race where the examiner record is created before
 * setExaminerName can run after the OTP step.
 */
export const PENDING_NAME_KEY = "cv_pending_examiner_name";

/**
 * sessionStorage state of an in-progress OTP sign-in. Mobile browsers reload
 * the page when it is backgrounded (switching to the mail app to fetch the
 * code) — React state dies with the page. Persisting the flow means the
 * reload lands back on the code step with the email filled in, instead of
 * restarting at the email form and firing a SECOND OTP (the loop).
 */
type PendingFlow = { email: string; mode: Mode; at: number };
const PENDING_FLOW_KEY = "cv_pending_otp_flow";
const PENDING_FLOW_TTL_MS = 15 * 60_000; // OTP validity window

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

function AuthCard() {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const setExaminerName = useMutation(api.exams.setExaminerName);
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(searchParams.get("returnTo"));

  const [mode, setMode] = useState<Mode>("signin");
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  // Resume an interrupted OTP flow after a page reload (mobile mail-check).
  // Runs once on mount: if a fresh flow exists, jump straight to the code
  // step with the email restored — no second OTP is sent. For signups the
  // typed name is restored too (stashed before the email step).
  useEffect(() => {
    const flow = loadPendingFlow();
    if (flow) {
      setEmail(flow.email);
      setMode(flow.mode);
      setStep("code");
      if (flow.mode === "signup") {
        try {
          const pending = sessionStorage.getItem(PENDING_NAME_KEY);
          if (pending) setName(pending);
        } catch {
          // ignore — the portal's ensureExaminer fallback still covers the name
        }
      }
    }
  }, []);

  useEffect(() => {
    // `verifying` guards the window between the email step confirming and the
    // OTP submit finishing — without it the effect would yank the user to the
    // portal the instant the code step mounts (the account exists by then).
    if (!authLoading && !verifying && isAuthenticated) {
      navigate(redirect, { replace: true });
    }
  }, [authLoading, verifying, isAuthenticated, navigate, redirect]);

  const handleEmailSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    // Stash the typed name before the account exists: ensureExaminer in the
    // portal reads it if the account is created before setExaminerName runs,
    // so the typed name — never the email prefix — becomes the display name.
    if (mode === "signup" && name.trim()) {
      try {
        sessionStorage.setItem(PENDING_NAME_KEY, name.trim());
      } catch {
        // storage unavailable — setExaminerName after the OTP still covers it
      }
    }
    try {
      const formData = new FormData();
      formData.set("email", email);
      await signIn("email-otp", formData);
      savePendingFlow({ email, mode, at: Date.now() });
      setVerifying(true);
      setStep("code");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to send the verification code. Please try again.",
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
      if (mode === "signup" && name.trim()) {
        formData.set("name", name.trim());
      }
      await signIn("email-otp", formData);

      clearPendingFlow();
      setVerifying(false);

      // Persist the typed name onto the examiner record right after the
      // account exists — this is the name the portal greets the examiner with.
      if (mode === "signup" && name.trim()) {
        try {
          await setExaminerName({ name: name.trim() });
          try {
            sessionStorage.removeItem(PENDING_NAME_KEY);
          } catch {
            // ignore storage failures
          }
        } catch {
          // The portal consumes the stashed name as a fallback and retries.
        }
      }

      navigate(redirect, { replace: true });
    } catch {
      setVerifying(false);
      setError("The verification code you entered is incorrect.");
      setOtp("");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="cv-center">
      <div className="cv-card cv-auth-card">
        <h1 className="cv-auth-title">
          {mode === "signin" ? "Examiner sign in" : "Create examiner account"}
        </h1>
        <p className="cv-auth-sub">
          {mode === "signin"
            ? "Welcome back. Sign in to run your exam rooms."
            : "Set up your examiner identity in seconds."}
        </p>

        <div className="cv-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "signin"}
            className={"cv-tab" + (mode === "signin" ? " active" : "")}
            onClick={() => {
              setMode("signin");
              setStep("email");
              setError(null);
              clearPendingFlow();
            }}
          >
            Sign In
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "signup"}
            className={"cv-tab" + (mode === "signup" ? " active" : "")}
            onClick={() => {
              setMode("signup");
              setStep("email");
              setError(null);
              clearPendingFlow();
            }}
          >
            Sign Up
          </button>
        </div>

        {error && <span className="cv-error">{error}</span>}

        {step === "email" ? (
          <form onSubmit={handleEmailSubmit}>
            {mode === "signup" && (
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
                  disabled={isLoading}
                />
              </div>
            )}
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
            <button type="submit" className="cv-btn cv-btn-primary cv-btn-block" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Sending code…
                </>
              ) : (
                "Continue with email code"
              )}
            </button>
          </form>
        ) : (
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
              ) : mode === "signup" ? (
                "Create account"
              ) : (
                "Sign in"
              )}
            </button>
            <p className="cv-form-footer">
              Didn't get it?{" "}
              <button
                type="button"
                onClick={() => {
                  clearPendingFlow();
                  setStep("email");
                }}
              >
                Try again
              </button>
            </p>
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
