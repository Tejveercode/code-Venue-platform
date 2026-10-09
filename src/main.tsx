import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import React, { StrictMode, lazy, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import "./index.css";
import "./index-monitor.css";

// Lazy load route components for better code splitting
const Landing = lazy(() => import("./pages/Landing.tsx"));
const About = lazy(() => import("./pages/About.tsx"));
const AuthPage = lazy(() => import("./pages/Auth.tsx"));
const PrivacyNotice = lazy(() => import("./pages/Legal.tsx").then((m) => ({ default: m.PrivacyNotice })));
const TermsOfService = lazy(() => import("./pages/Legal.tsx").then((m) => ({ default: m.TermsOfService })));
const CookiePolicy = lazy(() => import("./pages/Legal.tsx").then((m) => ({ default: m.CookiePolicy })));
const DataRights = lazy(() => import("./pages/Legal.tsx").then((m) => ({ default: m.DataRights })));
const Grievance = lazy(() => import("./pages/Legal.tsx").then((m) => ({ default: m.Grievance })));
const ExaminerPortal = lazy(() => import("./pages/ExaminerPortal.tsx"));
const ExaminerExamDetail = lazy(() => import("./pages/ExaminerExamDetail.tsx"));
const Submissions = lazy(() => import("./pages/Submissions.tsx"));
const StudentPortal = lazy(() => import("./pages/StudentPortal.tsx"));
const Exam = lazy(() => import("./pages/Exam.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

// Route-change fallback: the page's own cream tone and nothing animated.
// A pulsing gray block between routes read as a flash; this is invisible
// unless a chunk genuinely takes long, in which case the spinner-less tone
// still reads as "the same page, arriving".
function RouteLoading() {
  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--bg-color, #f7f3ec)" }}
      aria-hidden="true"
    />
  );
}

/**
 * Restore scroll on every route change. Without this, the browser keeps the
 * previous page's scroll offset while the next page mounts, and content
 * appears mid-page (perceived as "the page moved / fluttered"). Render-phase
 * guard keeps StrictMode's double-mount from doing anything twice.
 */
function ScrollToTop() {
  const { pathname } = useLocation();
  const [prev, setPrev] = useState(pathname);
  if (prev !== pathname) {
    setPrev(pathname);
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
  }
  return null;
}

/** Hard guard so runtime errors never leave the preview as a blank page. */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack: string }
> {
  state = { hasError: false, message: "", stack: "" };
  static getDerivedStateFromError(error: Error) {
    // Security (audit fix #12): the stack is captured in DEV only — production
    // crashes must never render source paths/frame details into the DOM. The
    // user-facing message stays identical in both environments.
    return {
      hasError: true,
      message: error.message || "Unknown runtime error",
      stack: import.meta.env.DEV ? error.stack || "" : "",
    };
  }
  componentDidCatch(err: Error) {
    console.error("[WebContainer preview] Root crash:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
          <div className="max-w-lg text-center">
            <p className="text-sm font-semibold">Preview runtime error</p>
            <p className="mt-2 text-xs text-muted-foreground break-words">
              {this.state.message}
            </p>
            {this.state.stack && (
              <pre className="mt-3 text-left text-[10px] leading-4 text-muted-foreground/80 max-h-40 overflow-auto rounded border border-border/60 p-2">
                {this.state.stack}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage(
      { type: "iframe-route-change", path: location.pathname },
      "*",
    );
  }, [location.pathname]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}

createRoot(document.getElementById("root")!).render(    <StrictMode>
      <RootErrorBoundary>
        <ConvexAuthProvider client={convex}>
        <BrowserRouter>
          <RouteSyncer />
          <ScrollToTop />
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/about" element={<About />} />
              <Route path="/auth" element={<AuthPage />} />
              <Route path="/privacy" element={<PrivacyNotice />} />
              <Route path="/terms" element={<TermsOfService />} />
              <Route path="/cookies" element={<CookiePolicy />} />
              <Route path="/data-rights" element={<DataRights />} />
              <Route path="/grievance" element={<Grievance />} />
              <Route
                path="/examiner-portal"
                element={
                  <RequireAuth>
                    <ExaminerPortal />
                  </RequireAuth>
                }
              />
              <Route
                path="/examiner/exams/:roomId"
                element={
                  <RequireAuth>
                    <ExaminerExamDetail />
                  </RequireAuth>
                }
              />
              <Route
                path="/submissions/:roomId"
                element={
                  <RequireAuth>
                    <Submissions />
                  </RequireAuth>
                }
              />
              <Route path="/student-portal" element={<StudentPortal />} />
              <Route path="/exam/:code" element={<Exam />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster />
      </ConvexAuthProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
