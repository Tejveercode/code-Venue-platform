import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ChevronDown, X } from "lucide-react";
import { PixelCanvas } from "./PixelCanvas";
import { useAuth } from "@/hooks/use-auth";

// ---------------------------------------------------------------------------
// Page shell: warm cream bg + pixel canvas ambient animation
// ---------------------------------------------------------------------------

export function CodeVenuePage({ children }: { children: ReactNode }) {
  return (
    <div data-code-venue-page className="min-h-screen flex flex-col">
      <PixelCanvas />
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
  return (
    <header className="cv-header">
      <div className="cv-header-inner">
        <Link to="/" className="cv-logo" aria-label="Code Venue home">
          Code&nbsp;<em>Venue</em>
        </Link>
        <nav className="cv-nav">
          <Link className="cv-nav-link" to="/about">
            About
          </Link>
          <Link className="cv-nav-link" to="/examiner-portal">
            Examiner
          </Link>
          <Link className="cv-nav-link" to="/student-portal">
            Student
          </Link>
          <AuthAwareActions />
          {actions}
        </nav>
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

export function CodePill({ code }: { code: string }) {
  return <span className="cv-pill cv-pill-code">{code}</span>;
}

// ---------------------------------------------------------------------------
// Question box — shared between examiner portal and the exam room
// ---------------------------------------------------------------------------

export function QuestionBox({
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
}

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
