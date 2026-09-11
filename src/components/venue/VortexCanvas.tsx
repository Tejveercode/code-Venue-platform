/**
 * VortexCanvas — Code Venue ambient background.
 *
 * Orbital particle vortex (the signature motion of the 21st.dev "Flux
 * Vortex" reference) rendered natively in Canvas2D with the venue palette.
 * Zero dependencies — unlike the reference, which loads three.js + GSAP
 * from CDNs inside an iframe at runtime.
 *
 * Perf guarantees carried over from PixelCanvas:
 *  - prefers-reduced-motion: static field, no rAF loop.
 *  - Tab hidden (Page Visibility): loop stops, timeline freezes on return.
 *  - Resize: debounced (220ms) behind a ResizeObserver.
 *  - Single requestAnimationFrame loop; no setInterval.
 */

import { useEffect, useRef } from "react";

const RESIZE_DEBOUNCE_MS = 220;

type Particle = {
  a0: number; // angle at t=0 (radians)
  r: number; // mean orbital radius (px)
  w: number; // angular velocity (rad/s)
  wb: number; // radial breathing speed
  amp: number; // radial breathing amplitude (px)
  round: boolean; // circles = dust, squares = pixel nod
  size: number;
  color: string;
  maxAlpha: number;
  tw: number; // twinkle phase
  twSpeed: number; // twinkle speed
};

type Controller = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  particles: Particle[];
  width: number;
  height: number;
  start: number | null;
  pausedAt: number | null;
  raf: number | null;
  running: boolean;
  reducedMotion: boolean;
};

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function buildParticleField(w: number, h: number): Particle[] {
  const maxR = Math.hypot(w, h) / 2;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const areaScale = Math.min(1.6, (w * h) / (1440 * 900));
  const palette = ["#c8966e", "#d8cfc0", "#e8c39e", "#b5734a"];
  const particles: Particle[] = [];
  const RING_COUNT = 3;
  const BASE = 90;

  for (let ring = 0; ring < RING_COUNT; ring++) {
    const ringFrac = (ring + 1) / RING_COUNT;
    const count = Math.max(30, Math.round(BASE * ringFrac * areaScale));
    const ringSpeed = 0.22 - ring * 0.05;
    const radiusBase = maxR * (0.28 + 0.24 * ring);

    for (let i = 0; i < count; i++) {
      particles.push({
        a0: i * 2.399963 + (Math.random() - 0.5) * 0.35,
        r: radiusBase * (0.85 + Math.random() * 0.3),
        w: ringSpeed * (0.8 + Math.random() * 0.4),
        wb: 0.25 + Math.random() * 0.35,
        amp: 6 + Math.random() * 14,
        round: Math.random() < 0.7,
        size: (Math.random() < 0.7 ? 1.2 : 2.2) * dpr,
        color: palette[(i + ring) % palette.length],
        maxAlpha: 0.12 + Math.random() * 0.5,
        tw: Math.random() * Math.PI * 2,
        twSpeed: 0.6 + Math.random() * 1.2,
      });
    }
  }
  return particles;
}

function drawParticle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  p: Particle,
  t: number,
) {
  const angle = p.a0 + p.w * t;
  const radius = p.r + Math.sin(t * p.wb + p.tw) * p.amp;
  const x = cx + Math.cos(angle) * radius;
  // Slight vertical squash reads as orbital depth.
  const y = cy + Math.sin(angle) * radius * 0.82;
  const twinkle = 0.55 + 0.45 * Math.sin(t * p.twSpeed + p.tw);
  const a = p.maxAlpha * twinkle;
  if (a <= 0.01) return;
  ctx.globalAlpha = Math.min(1, Math.max(0, a));
  ctx.fillStyle = p.color;
  if (p.round) {
    ctx.beginPath();
    ctx.arc(x, y, p.size, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillRect(x - p.size / 2, y - p.size / 2, p.size, p.size);
  }
}

function drawStatic(c: Controller) {
  const cx = c.width / 2;
  const cy = c.height / 2;
  c.ctx.clearRect(0, 0, c.width, c.height);
  for (const p of c.particles) {
    c.ctx.globalAlpha = p.maxAlpha;
    c.ctx.fillStyle = p.color;
    if (p.round) {
      c.ctx.beginPath();
      c.ctx.arc(cx + Math.cos(p.a0) * p.r, cy + Math.sin(p.a0) * p.r * 0.82, p.size, 0, Math.PI * 2);
      c.ctx.fill();
    } else {
      c.ctx.fillRect(cx + Math.cos(p.a0) * p.r - p.size / 2, cy + Math.sin(p.a0) * p.r * 0.82 - p.size / 2, p.size, p.size);
    }
  }
  c.ctx.globalAlpha = 1;
}

function tick(c: Controller) {
  if (document.hidden) {
    c.raf = null;
    c.running = false;
    return;
  }
  if (c.start === null) c.start = performance.now();
  const t = (performance.now() - c.start) / 1000;
  const cx = c.width / 2;
  const cy = c.height / 2;
  c.ctx.clearRect(0, 0, c.width, c.height);
  for (const p of c.particles) {
    drawParticle(c.ctx, cx, cy, p, t);
  }
  c.ctx.globalAlpha = 1;
  c.raf = requestAnimationFrame(() => tick(c));
}

function startAnimation(c: Controller) {
  if (c.running || c.reducedMotion || document.hidden) return;
  c.running = true;
  if (c.raf !== null) cancelAnimationFrame(c.raf);
  c.raf = requestAnimationFrame(() => tick(c));
}

function buildController(canvas: HTMLCanvasElement): Controller {
  const ctx = canvas.getContext("2d")!;
  const c: Controller = {
    canvas,
    ctx,
    particles: [],
    width: 0,
    height: 0,
    start: null,
    pausedAt: null,
    raf: null,
    running: false,
    reducedMotion: prefersReducedMotion(),
  };

  const rebuild = (animate: boolean) => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    c.width = w;
    c.height = h;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.particles = buildParticleField(w, h);

    if (animate && !c.reducedMotion && !document.hidden) {
      c.start = null;
      startAnimation(c);
    } else {
      if (c.raf !== null) cancelAnimationFrame(c.raf);
      c.raf = null;
      c.running = false;
      drawStatic(c);
    }
  };

  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  let lastW = -1;
  let lastH = -1;
  const observer =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          if (window.innerWidth === lastW && window.innerHeight === lastH) return;
          if (resizeTimer !== null) clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => {
            resizeTimer = null;
            if (window.innerWidth !== lastW || window.innerHeight !== lastH) {
              lastW = window.innerWidth;
              lastH = window.innerHeight;
              rebuild(true);
            }
          }, RESIZE_DEBOUNCE_MS);
        })
      : null;

  lastW = window.innerWidth;
  lastH = window.innerHeight;
  rebuild(true);

  if (observer) {
    observer.observe(canvas);
  } else {
    const onResize = () => {
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => rebuild(true), RESIZE_DEBOUNCE_MS);
    };
    window.addEventListener("resize", onResize);
    (c as Controller & { __onResize?: () => void }).__onResize = onResize;
  }

  const onVisibility = () => {
    if (document.hidden) {
      c.pausedAt = c.start !== null ? performance.now() : null;
      if (c.raf !== null) cancelAnimationFrame(c.raf);
      c.raf = null;
      c.running = false;
    } else {
      if (c.pausedAt !== null && c.start !== null) {
        c.start += performance.now() - c.pausedAt;
        c.pausedAt = null;
      }
      startAnimation(c);
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  const cAny = c as Controller & {
    __observer?: ResizeObserver;
    __onVisibility?: () => void;
    __onResize?: () => void;
  };
  cAny.__observer = observer ?? undefined;
  cAny.__onVisibility = onVisibility;
  return c;
}

export function VortexCanvas() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const canvas = document.createElement("canvas");
    canvas.style.position = "fixed";
    canvas.style.inset = "0";
    canvas.style.zIndex = "-1";
    canvas.style.pointerEvents = "none";
    host.appendChild(canvas);
    const c = buildController(canvas);
    const cAny = c as Controller & {
      __observer?: ResizeObserver;
      __onVisibility?: () => void;
      __onResize?: () => void;
    };
    return () => {
      cAny.__observer?.disconnect();
      document.removeEventListener("visibilitychange", cAny.__onVisibility!);
      if (cAny.__onResize) window.removeEventListener("resize", cAny.__onResize);
      if (c.raf !== null) cancelAnimationFrame(c.raf);
      canvas.remove();
    };
  }, []);
  return <div ref={hostRef} aria-hidden="true" data-pixel-canvas />;
}
