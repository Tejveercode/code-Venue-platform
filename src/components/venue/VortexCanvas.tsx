/**
 * VortexCanvas — Code Venue ambient background.
 *
 * Native Canvas2D port of the 21st.dev "Flux Vortex" (mengto) signature
 * motion: a swirling funnel of glowing points with spiral arms, spiral guide
 * curves, ambient drift, and a soft bloom feel — tinted in the venue palette
 * instead of the reference's monochrome dark theme. Zero dependencies (the
 * reference loads three.js + GSAP from CDNs inside an iframe; this does not).
 *
 * Perf guarantees carried over from PixelCanvas:
 *  - prefers-reduced-motion: one static render, no rAF loop.
 *  - Tab hidden (Page Visibility): loop stops, timeline freezes on return.
 *  - Resize: debounced (220ms) behind a ResizeObserver.
 *  - Single requestAnimationFrame loop; no setInterval.
 */

import { useEffect, useRef } from "react";

const RESIZE_DEBOUNCE_MS = 220;

// Venue palette (cream base + caramel glow family) — no new design colors.
const BG_RGB = "247, 243, 236"; // #f7f3ec
const PALETTE = ["#b5734a", "#c8966e", "#e8c39e", "#d8cfc0"];

// Funnel geometry (fractions of viewport).
const RIM_Y = 0.16; // wide mouth (top)
const APEX_Y = 0.72; // narrow throat (bottom)
const MIN_R = 0.045; // throat radius (× min(vw, vh))
const MAX_R = 0.62; // rim radius (× min(vw, vh))
const ARMS = 4; // spiral arms
const TWIST = 1.6; // arm turns from apex to rim

type Particle = {
  z: number; // 0 = apex (bottom, narrow) … 1 = rim (top, wide)
  theta: number; // angle around the funnel axis
  w: number; // angular velocity (differential rotation, scaled per z)
  drift: number; // downward drift speed (z per second)
  size: number;
  sprite: number; // index into sprite cache
  alpha: number;
  tw: number; // twinkle phase
  twSpeed: number;
};

type Controller = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  particles: Particle[];
  sprites: HTMLCanvasElement[];
  width: number;
  height: number;
  last: number | null; // previous frame timestamp (ms)
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

/** Soft round glow sprite tinted `color` (used for the bloom look). */
function makeGlowSprite(color: string): HTMLCanvasElement {
  const s = document.createElement("canvas");
  s.width = 64;
  s.height = 64;
  const g = s.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, color);
  grad.addColorStop(0.35, color);
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.globalAlpha = 1;
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return s;
}

function buildVortex(w: number, h: number): Particle[] {
  const areaScale = Math.min(1.5, Math.max(0.5, (w * h) / (1440 * 900)));
  const count = Math.round(620 * areaScale);
  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const arm = i % ARMS;
    const z = Math.random();
    // Points hug their arm's spiral with jitter; pure-random angles fill gaps.
    const spiralAngle =
      (arm / ARMS) * Math.PI * 2 + Math.pow(z, 1.15) * TWIST * Math.PI * 2;
    const theta = Math.random() < 0.8 ? spiralAngle + (Math.random() - 0.5) * 0.5 : Math.random() * Math.PI * 2;
    // Differential rotation: the narrow throat visibly spins faster.
    const wSpeed = (0.9 - z * 0.55) * (0.75 + Math.random() * 0.5);
    particles.push({
      z,
      theta,
      w: wSpeed,
      drift: 0.008 + Math.random() * 0.022, // ambient downward drift
      size: 5 + Math.random() * 12,
      sprite: (i + arm) % PALETTE.length,
      alpha: 0.16 + Math.random() * 0.4,
      tw: Math.random() * Math.PI * 2,
      twSpeed: 0.5 + Math.random() * 1.1,
    });
  }
  return particles;
}

/** Project a funnel point to screen space. */
function project(
  c: Controller,
  z: number,
  theta: number,
  t: number,
): { x: number; y: number; scale: number } {
  const minDim = Math.min(c.width, c.height);
  const r =
    MIN_R * minDim + (MAX_R - MIN_R) * minDim * Math.pow(z, 1.15);
  const rimY = c.height * RIM_Y;
  const apexY = c.height * APEX_Y;
  return {
    x: c.width / 2 + Math.cos(theta) * r,
    y: rimY + (1 - z) * (apexY - rimY),
    scale: 0.45 + 0.55 * z, // smaller near the throat (depth cue)
  };
}

/** Faint spiral guide curves — the reference's "spiral guides". */
function drawGuides(c: Controller, t: number) {
  const ctx = c.ctx;
  const minDim = Math.min(c.width, c.height);
  const rimY = c.height * RIM_Y;
  const apexY = c.height * APEX_Y;
  ctx.save();
  ctx.lineWidth = 1;
  for (let arm = 0; arm < ARMS; arm++) {
    ctx.beginPath();
    const phase = (arm / ARMS) * Math.PI * 2 + t * 0.05;
    for (let step = 0; step <= 28; step++) {
      const z = step / 28;
      const theta = phase + Math.pow(z, 1.15) * TWIST * Math.PI * 2;
      const r = MIN_R * minDim + (MAX_R - MIN_R) * minDim * Math.pow(z, 1.15);
      const x = c.width / 2 + Math.cos(theta) * r;
      const y = rimY + (1 - z) * (apexY - rimY);
      if (step === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "rgba(181, 115, 74, 0.07)";
    ctx.stroke();
  }
  ctx.restore();
}

function drawStatic(c: Controller) {
  const ctx = c.ctx;
  ctx.fillStyle = `rgb(${BG_RGB})`;
  ctx.fillRect(0, 0, c.width, c.height);
  drawGuides(c, 0);
  for (const p of c.particles) {
    const pos = project(c, p.z, p.theta, 0);
    const size = p.size * pos.scale;
    ctx.globalAlpha = p.alpha;
    ctx.drawImage(c.sprites[p.sprite]!, pos.x - size / 2, pos.y - size / 2, size, size);
  }
  ctx.globalAlpha = 1;
}

function tick(c: Controller) {
  if (document.hidden) {
    c.raf = null;
    c.running = false;
    return;
  }
  const now = performance.now();
  if (c.last === null) c.last = now;
  const dt = Math.min(0.05, (now - c.last) / 1000); // clamp tab-switch jumps
  c.last = now;
  const t = now / 1000;

  const ctx = c.ctx;
  // Fade toward the page cream instead of clearing — cheap bloom trails.
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = `rgba(${BG_RGB}, 0.22)`;
  ctx.fillRect(0, 0, c.width, c.height);
  drawGuides(c, t);

  for (const p of c.particles) {
    p.theta += p.w * dt * 0.5;
    p.z -= p.drift * dt;
    if (p.z < 0) p.z = 1; // respawn at the rim — continuous funnel
    const pos = project(c, p.z, p.theta, t);
    const size = p.size * pos.scale;
    const twinkle = 0.6 + 0.4 * Math.sin(t * p.twSpeed + p.tw);
    const a = p.alpha * twinkle;
    if (a <= 0.015) continue;
    ctx.globalAlpha = Math.min(1, a);
    ctx.drawImage(c.sprites[p.sprite]!, pos.x - size / 2, pos.y - size / 2, size, size);
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
    sprites: PALETTE.map(makeGlowSprite),
    width: 0,
    height: 0,
    last: null,
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
    c.particles = buildVortex(w, h);

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
      c.pausedAt = c.last;
      if (c.raf !== null) cancelAnimationFrame(c.raf);
      c.raf = null;
      c.running = false;
    } else {
      if (c.pausedAt !== null) {
        // Freeze the timeline while hidden so motion resumes seamlessly.
        c.last = null;
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
