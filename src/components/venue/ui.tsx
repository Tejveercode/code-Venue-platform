import { memo, useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { Equal, X } from "lucide-react";
import { VoidFieldCanvas } from "./VoidFieldCanvas";
import { useAuth } from "@/hooks/use-auth";

// ---------------------------------------------------------------------------
// Page shell: warm cream bg + pixel canvas ambient animation
// ---------------------------------------------------------------------------

export function CodeVenuePage({ children }: { children: ReactNode }) {
  return (
    <div data-code-venue-page className="min-h-screen flex flex-col">
      <VoidFieldCanvas />
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header — fully transparent so the pixel canvas shows through
// ---------------------------------------------------------------------------

/** Auth-aware header actions: examiner sign-in CTA when signed out,
 *  portal link when signed in. Students never need an account.
 *
 *  On /examiner-portal itself the portal entry renders as the header's
 *  standard nav link with aria-current="page" — the current location is
 *  navigation state, not an action button (usability audit #4). */
function AuthAwareActions() {
  const { isLoading, isAuthenticated } = useAuth();
  const onPortal = useLocation().pathname.startsWith("/examiner-portal");
  if (isLoading) return <span style={{ width: 76 }} />;
  if (!isAuthenticated) {
    return (
      <Link className="cv-btn cv-btn-primary cv-btn-sm" to="/auth?returnTo=%2Fexaminer-portal">
        Examiner Sign In
      </Link>
    );
  }
  if (onPortal) {
    return (
      <Link className="cv-nav-link active" to="/examiner-portal" aria-current="page">
        Examiner Portal
      </Link>
    );
  }
  return (
    <Link className="cv-btn cv-btn-secondary cv-btn-sm" to="/examiner-portal">
      Examiner Portal
    </Link>
  );
}

export function VenueHeader({ actions }: { actions?: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // Floating-glass-pill state: once the page scrolls past the reference's
  // 50px threshold, the header condenses into a sticky glass pill (CSS in
  // index.css). The updater bails out on unchanged values, so scrolling
  // costs no re-renders except at the threshold crossings.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    // Hysteresis, not a single threshold: when Android Chrome collapses/
    // expands the URL bar, scrollY oscillates around any fixed cutoff, which
    // flips `scrolled` back and forth and visibly blinks the header between
    // its two geometries. Entering the scrolled state at >60px and leaving
    // it only below <44px gives a dead band the oscillation can't cross.
    const ENTER = 60;
    const EXIT = 44;
    const onScroll = () => {
      setScrolled((prev) => {
        const y = window.scrollY;
        const next = prev ? y > EXIT : y > ENTER;
        return prev === next ? prev : next;
      });
    };
    // Sync once on mount WITHOUT calling setState synchronously inside the
    // effect body (react-hooks lint): rAF defers it to the next frame.
    const raf = requestAnimationFrame(onScroll);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  // Close the mobile menu whenever the route changes — render-phase
  // adjustment (React's "derive state from props" pattern) rather than an
  // effect, so no extra render pass is scheduled.
  const [prevPath, setPrevPath] = useState(location.pathname);
  if (prevPath !== location.pathname) {
    setPrevPath(location.pathname);
    setMenuOpen(false);
  }

  // Header structure (layout contract lives in CSS — .cv-header is a
  // centered 1fr auto 1fr grid; see index.css + index-monitor.css):
  //   row 1: .cv-logo (left) · nav (center) · .cv-auth-buttons (right)
  //   ≤860px: nav/auth collapse away; the hamburger occupies the right cell
  //   .cv-mobile-menu spans all columns on row 2 when open
  const path = location.pathname;
  const navLinks = (
    <>
      <li>
        <Link
          className={"cv-nav-link" + (path.startsWith("/about") ? " active" : "")}
          to="/about"
        >
          About
        </Link>
      </li>
      <li>
        <Link
          className={
            "cv-nav-link" +
            (path.startsWith("/examiner-portal") || path.startsWith("/submissions")
              ? " active"
              : "")
          }
          to="/examiner-portal"
        >
          For Teachers
        </Link>
      </li>
      <li>
        <Link
          className={
            "cv-nav-link" +
            (path.startsWith("/student-portal") || path.startsWith("/exam")
              ? " active"
              : "")
          }
          to="/student-portal"
        >
          Student
        </Link>
      </li>
    </>
  );

  return (
    <header
      className={"cv-header" + (scrolled ? " scrolled" : "")}
    >
      <Link to="/" className="cv-logo" aria-label="Code Venue home">
        Code&nbsp;<em>Venue</em>
      </Link>
      <nav className="cv-nav" aria-label="Primary">
        <ul className="cv-nav-list">{navLinks}</ul>
      </nav>
      <div className="cv-auth-buttons">
        <AuthAwareActions />
        {actions}
      </div>
      {/* Morphing hamburger — 21st.dev reference: the Equal icon rotates
          and fades out while the X rotates in (200ms, both icons stacked). */}
      <button
        className={"cv-menu-toggle" + (menuOpen ? " open" : "")}
        aria-label={menuOpen ? "Close menu" : "Open menu"}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((o) => !o)}
      >
        <Equal size={20} className="cv-toggle-equal" />
        <X size={20} className="cv-toggle-x" />
      </button>
      {/* Mobile dropdown menu — links first, then auth actions. */}
      <div className={"cv-mobile-menu" + (menuOpen ? " open" : "")}>
        <ul className="cv-nav-list">{navLinks}</ul>
        <div className="cv-mobile-actions">
          <AuthAwareActions />
          {actions}
        </div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Status pills
// ---------------------------------------------------------------------------

export function LivePill() {
  return (
    <span className="cv-pill cv-pill-live">
      <span className="cv-live-dot" />
      Live
    </span>
  );
}

export function ClosedPill() {
  return <span className="cv-pill cv-pill-closed">Closed</span>;
}

export const CodePill = memo(function CodePill({ code }: { code: string }) {
  return <span className="cv-pill cv-pill-code">{code}</span>;
});

// ---------------------------------------------------------------------------
// Question box — shared between examiner portal and the exam room
// ---------------------------------------------------------------------------

export const QuestionBox = memo(function QuestionBox({
  prompt,
  label = "Prompt:",
}: {
  prompt: string;
  label?: string;
}) {
  return (
    <div className="cv-question-box">
      <span className="cv-qb-label">{label}</span>
      <div className="cv-qb-body">{prompt}</div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Modal — real CSS fade + scale with cubic-bezier(0.16, 1, 0.3, 1)
// ---------------------------------------------------------------------------

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function Modal({ open, onClose, title, subtitle, children, footer }: ModalProps) {
  // Enter/exit transition state, kept as render-phase adjustments on the
  // `open` prop (React's derive-state-from-props pattern) so opening/closing
  // never schedules an extra cascade render. `shown` flips one frame after
  // mount via rAF so the CSS opacity transition runs; on close we wait out
  // the transition before unmounting the dialog node.
  const [visible, setVisible] = useState(open);
  const [shown, setShown] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setVisible(true);
      requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    } else {
      setShown(false);
      setTimeout(() => setVisible(false), 300); // match transition
    }
  }

  // Lock background scroll while the modal is open. Setting overflow:hidden
  // on <body> shifts the layout by the scrollbar width on desktop, so the
  // previous scroll position is preserved with padding-right compensation
  // and fully restored on close. Multiple stacked modals are covered because
  // every open modal runs this effect and each restores exactly what it
  // saved (stacked opens are last-one-wins for the lock, first-close
  // restores — correct since a lock by any open modal blocks all scrolling).
  useEffect(() => {
    if (!open) return;
    const body = document.body;
    const scrollY = window.scrollY;
    const prevOverflow = body.style.overflow;
    const prevPaddingRight = body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `calc(${prevPaddingRight || "0px"} + ${scrollbarWidth}px)`;
    }
    return () => {
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPaddingRight;
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  if (!visible) return null;

  return (
    <div
      className={"cv-modal-overlay" + (shown ? " show" : "")}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cv-modal" role="dialog" aria-modal="true" aria-label={title}>
        <button className="cv-modal-close" aria-label="Close" onClick={onClose}>
          <X size={18} />
        </button>
        <h3>{title}</h3>
        {subtitle && <p className="cv-modal-sub">{subtitle}</p>}
        {children}
        {footer && <div className="cv-modal-actions">{footer}</div>}
      </div>
    </div>
  );
}

// (AccordionRow removed — the room accordion was replaced by the exam
// summary cards + /examiner/exams/:roomId detail page; no consumers remain.)
