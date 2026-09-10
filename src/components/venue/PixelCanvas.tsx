/**
 * Pixel canvas ambient background.
 *
 * A literal per-pixel Canvas2D animation: small squares that fade in and
 * gently shimmer, radiating outward from the viewport center with a
 * distance-based delay. Respects prefers-reduced-motion by rendering the
 * pixels instantly at full size (no animation).
 *
 * Auto-initializes on any element with a [data-pixel-canvas] attribute.
 */

import { useEffect, useRef } from "react";

const COLORS = ["#d8cfc0", "#c8966e"] as const;
const GAP = 5;
const SPEED = 30; // wave front travel speed, px per second

type Pixel = {
  x: number;
  y: number;
  delay: number; // seconds until this pixel starts animating
  color: string;
  maxAlpha: number;
};

type PixelCanvasController = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  pixels: Pixel[];
  width: number;
  height: number;
  cell: number;
  start: number | null;
  raf: number | null;
  resizeHandler: () => void;
};

const controllers = new Set<PixelCanvasController>();

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
function drawStatic(c: PixelCanvasController) {
  const { ctx, pixels, cell } = c;
  ctx.clearRect(0, 0, c.width, c.height);
  for (const p of pixels) {
    ctx.globalAlpha = p.maxAlpha;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, cell, cell);
  }
  ctx.globalAlpha = 1;
}

function tick(c: PixelCanvasController) {
  const { ctx, pixels, cell } = c;
  if (c.start === null) c.start = performance.now();
  const t = (performance.now() - c.start) / 1000;

  const maxDelay = pixels.reduce((m, p) => Math.max(m, p.delay), 0);
  const wave = t * SPEED;
  let allDone = t > (maxDelay / SPEED) * 2.2; // generous settle window

  ctx.clearRect(0, 0, c.width, c.height);
  for (const p of pixels) {
    const local = t - p.delay;
    if (local <= 0) {
      allDone = false;
      continue;
    }
    const dist = local * SPEED;
    let alpha: number;
    if (dist < 60) {
      // ease in as the wave front passes
      alpha = p.maxAlpha * Math.min(1, dist / 60);
    } else if (dist < 200) {
      alpha = p.maxAlpha;
    } else {
      // gentle shimmer afterwards
      const phase = (dist - 200) / 220;
      alpha = p.maxAlpha * (0.55 + 0.45 * Math.cos(phase * Math.PI * 2 + p.x * 0.02));
    }
    if (alpha <= 0.004) continue;
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, cell, cell);
  }
  ctx.globalAlpha = 1;

  if (!allDone) {
    c.raf = requestAnimationFrame(() => tick(c));
  } else {
    drawStatic(c);
    c.raf = null;
  }
}

function buildController(canvas: HTMLCanvasElement): PixelCanvasController {
  const ctx = canvas.getContext("2d")!;
  const c: PixelCanvasController = {
    canvas,
    ctx,
    pixels: [],
    width: 0,
    height: 0,
    cell: GAP,
    start: null,
    raf: null,
    resizeHandler: () => {},
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

    const cx = w / 2;
    const cy = h / 2;
    const maxDist = Math.hypot(w, h) / 2;
    const pixels: Pixel[] = [];
    const cell = GAP;
    for (let y = 0; y < h; y += cell) {
      for (let x = 0; x < w; x += cell) {
        const d = Math.hypot(x + cell / 2 - cx, y + cell / 2 - cy);
        pixels.push({
          x,
          y,
          delay: (d / maxDist) * (maxDist / SPEED) * 0.55,
          color: COLORS[(x + y) % 2 === 0 ? 0 : 1],
          maxAlpha: 0.16 + 0.5 * Math.random(),
        });
      }
    }
    c.pixels = pixels;
    c.cell = cell;

    if (animate && !prefersReducedMotion()) {
      c.start = null;
      if (c.raf !== null) cancelAnimationFrame(c.raf);
      c.raf = requestAnimationFrame(() => tick(c));
    } else {
      if (c.raf !== null) cancelAnimationFrame(c.raf);
      c.raf = null;
      drawStatic(c);
    }
  };

  c.resizeHandler = () => rebuild(true);
  rebuild(true);

  window.addEventListener("resize", c.resizeHandler);
  controllers.add(c);
  return c;
}

export function PixelCanvas() {
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
    return () => {
      window.removeEventListener("resize", c.resizeHandler);
      if (c.raf !== null) cancelAnimationFrame(c.raf);
      canvas.remove();
      controllers.delete(c);
    };
  }, []);
  return <div ref={hostRef} aria-hidden="true" data-pixel-canvas />;
}
