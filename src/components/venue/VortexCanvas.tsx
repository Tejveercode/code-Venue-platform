/**
 * VortexCanvas — Code Venue ambient background.
 *
 * Native Canvas2D port of the 21st.dev "Flux Vortex" (mengto) reference:
 * a tall, vertical particle tornado. A thin spiral guide line winds down
 * the full height, loops growing wider toward the bottom; fine dust hugs
 * the narrow axis up top and swirls in widening orbits below. Rendered in
 * the venue palette instead of the reference's monochrome-on-black.
 * Zero dependencies (the reference loads three.js + GSAP from CDNs).
 *
 * Perf guarantees carried over from PixelCanvas:
 *  - prefers-reduced-motion: one static render, no rAF loop.
 *  - Tab hidden (Page Visibility): loop stops; motion freezes and resumes.
 *  - Resize: debounced (220ms) behind a ResizeObserver.
 *  - Single requestAnimationFrame loop; no setInterval.
 */

import { useEffect, useRef } from "react";

const RESIZE_DEBOUNCE_MS = 220;

const BG_RGB = "247, 243, 236"; // #f7f3ec — page cream
const PALETTE = ["#b5734a", "#c8966e", "#e8c39e", "#d8cfc0"];

// Tornado geometry (fractions of viewport height / width).
const TOP_Y = 0.06; // axis entry near the top edge
const BOTTOM_Y = 0.98; // widest loops at the bottom edge
const R_TOP = 0.012; // throat radius at the top (× min(vw,vh))
const R_BOTTOM = 0.42; // loop radius at the bottom (× min(vw,vh))
const R_CURVE = 1.8; // radius curve exponent (>1 = stays narrow longer)
const TWIST = 4.5; // spiral turns from top to bottom
const ARMS = 3; // dust arms along the helix
const DUST_COUNT = 1100;

type Particle = {
  u: number; // height along the funnel: 0 = top … 1 = bottom
  theta: number; // angle around the axis
  w: number; // angular velocity (rad/s, scales with 1/r — core spins fast)
  fall: number; // downward drift speed (u per second)
  wob: number; // per-particle radius jitter factor
  size: number;
  color: string;
  alpha: number;
  tw: number; // twinkle phase
  twSpeed: number;
};

type Controller = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  particles: Particle[];
  width: number;
  height: number;
  last: number | null;
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

/** Radius of the funnel at height u (0 top → 1 bottom). */
function radiusAt(u: number, minDim: number): number {
  return (
    (R_TOP + (R_BOTTOM - R_TOP) * Math.pow(u, R_CURVE)) * minDim
  );
}

/** Height on screen at u. */
function yAt(u: number, h: number): number {
  return TOP_Y * h + (BOTTOM_Y - TOP_Y) * h * u;
}

function buildTornado(w: number, h: number): Particle[] {
  const areaScale = Math.min(1.4, Math.max(0.55, (w * h) / (1440 * 900)));
  const count = Math.round(DUST_COUNT * areaScale);
  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    // Bias toward the top: dense fine dust at the narrow core, sparser at
    // the wide base — matches the reference's silhouette.
    const u = Math.pow(Math.random(), 1.6);
    const arm = i % ARMS;
    const base = (arm / ARMS) * Math.PI * 2 + u * TWIST * Math.PI * 2;
    // Dust hugs its arm's helix with jitter; a minority fills the volume.
    const theta =
      Math.random() < 0.82
        ? base + (Math.random() - 0.5) * 0.55
        : Math.random() * Math.PI * 2;
    particles.push({
      u,
      theta,
      // Near the axis the linear speed is tiny, so spin must be fast to read;
      // scale angular velocity inversely with the local radius (v ~ const).
      w: (0.35 + Math.random() * 0.3) / (0.12 + radiusAt(u, 1)),
      fall: 0.01 + Math.random() * 0.03,
      wob: 0.75 + Math.random() * 0.5, // radius jitter factor
      size: 0.8 + Math.random() * 1.8,
      color: PALETTE[(i + arm) % PALETTE.length]!,
      alpha: 0.2 + Math.random() * 0.55,
      tw: Math.random() * Math.PI * 2,
      twSpeed: 0.5 + Math.random() * 1.2,
    });
  }
  return particles;
}

function drawStatic(c: Controller) {
  const ctx = c.ctx;
  const minDim = Math.min(c.width, c.height);
  ctx.fillStyle = `rgb(${BG_RGB})`;
  ctx.fillRect(0, 0, c.width, c.height);
  drawGuide(c, 0, minDim);
  for (const p of c.particles) {
    const r = radiusAt(p.u, minDim) * p.wob;
    const x = c.width / 2 + Math.cos(p.theta) * r;
    const y = yAt(p.u, c.height);
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = p.color;
    ctx.fillRect(x - p.size / 2, y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

/** The thin spiral guide line winding down the funnel. */
function drawGuide(c: Controller, t: number, minDim: number) {
  const ctx = c.ctx;
  ctx.save();
  ctx.beginPath();
  const steps = 220;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const theta = u * TWIST * Math.PI * 2 + t * 0.12;
    const r = radiusAt(u, minDim);
    const x = c.width / 2 + Math.cos(theta) * r;
    const y = yAt(u, c.height);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "rgba(181, 115, 74, 0.3)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();
}

function tick(c: Controller) {
  if (document.hidden) {
    c.raf = null;
    c.running = false;
    return;
  }
  const now = performance.now();
  if (c.last === null) c.last = now;
  const dt = Math.min(0.05, (now - c.last) / 1000);
  c.last = now;
  const t = now / 1000;

  const ctx = c.ctx;
  const minDim = Math.min(c.width, c.height);
  // Cream wash instead of a hard clear — soft motion trails (bloom feel).
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = `rgba(${BG_RGB}, 0.28)`;
  ctx.fillRect(0, 0, c.width, c.height);
  drawGuide(c, t, minDim);

  for (const p of c.particles) {
    p.theta += p.w * dt;
    p.u += p.fall * dt;
    if (p.u > 1) {
      p.u = 0; // respawn at the top throat
      p.theta = Math.random() * Math.PI * 2;
    }
    const r = radiusAt(p.u, minDim) * p.wob;
    const x = c.width / 2 + Math.cos(p.theta) * r;
    const y = yAt(p.u, c.height);
    const twinkle = 0.65 + 0.35 * Math.sin(t * p.twSpeed + p.tw);
    const a = p.alpha * twinkle;
    if (a <= 0.02) continue;
    ctx.globalAlpha = Math.min(1, a);
    ctx.fillStyle = p.color;
    ctx.fillRect(x - p.size / 2, y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;

  c.raf = requestAnimationFrame(() => tick(c));
}

function startAnimation(c: Controller) {
  if (c.running || c.reducedMotion || document.hidden) return;
  c.running = true;
  c.last = null;
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
    last: null,
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
    c.particles = buildTornado(w, h);

    if (animate && !c.reducedMotion && !document.hidden) {
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

  if (observer) observer.observe(canvas);
  else {
    const onResize = () => {
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => rebuild(true), RESIZE_DEBOUNCE_MS);
    };
    window.addEventListener("resize", onResize);
    (c as Controller & { __onResize?: () => void }).__onResize = onResize;
  }

  const onVisibility = () => {
    if (document.hidden) {
      if (c.raf !== null) cancelAnimationFrame(c.raf);
      c.raf = null;
      c.running = false;
    } else {
      c.last = null; // freeze the timeline while hidden; resume seamlessly
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
