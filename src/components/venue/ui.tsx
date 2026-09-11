import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { ChevronDown, Equal, X } from "lucide-react";
import { VortexCanvas } from "./VortexCanvas";
import { useAuth } from "@/hooks/use-auth";

// ---------------------------------------------------------------------------
// Page shell: warm cream bg + pixel canvas ambient animation
// ---------------------------------------------------------------------------

export function CodeVenuePage({ children }: { children: ReactNode }) {
  return (
    <div data-code-venue-page className="min-h-screen flex flex-col">
      <VortexCanvas />
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header — fully transparent so the pixel canvas shows through
// ---------------------------------------------------------------------------

/** Auth-aware header actions: examiner sign-in CTA when signed out,
 *  portal link when signed in. Students never need an account. */
function AuthAwareActions() {
  const { isLoading, isAuthenticated } = useAuth();
  if (isLoading) return <span style={{ width: 76 }} />;
  return isAuthenticated ? (
    <Link className="cv-btn cv-btn-secondary cv-btn-sm" to="/examiner-portal">
      Examiner Portal
    </Link>
  ) : (
    <Link className="cv-btn cv-btn-primary cv-btn-sm" to="/auth?returnTo=%2Fexaminer-portal">
      Examiner Sign In
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
    const onScroll = () => {
      setScrolled((prev) => {
        const next = window.scrollY > 50;
        return prev === next ? prev : next;
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close the mobile menu whenever the route changes.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // EXACT original header structure — exactly three direct flex children
  // spread by justify-content: space-between:
  //   1. .cv-logo (far left)
  //   2. nav > ul.cv-nav-list (gap: 32px — naturally center/left-center)
  //   3. .cv-auth-buttons (far right)
  // The hamburger toggle + mobile menu are display:none on desktop, so
  // desktop always renders exactly the three-child space-between layout.
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
          Examiner
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
  const [visible, setVisible] = useState(open);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (open) {
      setVisible(true);
      // Double rAF so the mount paints before the transition kicks in.
      const raf = requestAnimationFrame(() =>
        requestAnimationFrame(() => setShown(true)),
      );
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    const t = setTimeout(() => setVisible(false), 300); // match transition
    return () => clearTimeout(t);
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

// ---------------------------------------------------------------------------
// Accordion row — animates max-height to the measured scrollHeight via JS
// ---------------------------------------------------------------------------

export function AccordionRow({
  open,
  onToggle,
  header,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  header: ReactNode;
  children: ReactNode;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (open) {
      // Measure the real content height so the animation is smooth
      // regardless of content length, then let it grow naturally.
      el.style.maxHeight = `${el.scrollHeight}px`;
    } else {
      el.style.maxHeight = "0px";
    }
  }, [open, children]);

  return (
    <div className={"cv-acc-item" + (open ? " open" : "")}>
      <button
        type="button"
        className="cv-acc-trigger"
        aria-expanded={open}
        onClick={onToggle}
      >
        {header}
        <ChevronDown size={18} className="cv-acc-chev" />
      </button>
      <div className="cv-acc-body" ref={bodyRef}>
        <div className="cv-acc-content">{children}</div>
      </div>
    </div>
  );
}
