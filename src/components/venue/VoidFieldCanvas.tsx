/**
 * VoidFieldCanvas — Code Venue ambient background.
 *
 * Exact port of the ThreeUI "Void Field" (PredictiveArcCanvas variant
 * "void-field") raw-WebGL dot-matrix terminal renderer, from the verified
 * source bundle (canonical source sha256 affd21553ba951c0…). The authored
 * shader is preserved: fullscreen quad, barrel distortion, pointer parallax
 * drift, a 100-column dot grid with a radial breathing pulse, digital
 * scanlines, randomized row flicker, and vignette edge masking.
 *
 * Documented host adaptations only (everything else is the authored code):
 *  - tint: the source's vec3(0.7, 0.3, 1.0) purple becomes the venue caramel
 *    family (design-language rule: no new colors).
 *  - surface: renders with alpha over the cream page instead of opaque black;
 *    out-of-bounds pixels are transparent instead of black.
 *  - adaptive pixel ratio: the source sized the canvas in CSS pixels; this
 *    caps backing resolution at devicePixelRatio ≤ 2 for high-DPI screens.
 *  - lifecycle: prefers-reduced-motion renders one static frame; the rAF
 *    loop pauses when the tab is hidden; resize is debounced behind a
 *    ResizeObserver; WebGL context loss is recovered, not fatal.
 */

import { useEffect, useRef } from "react";

const RESIZE_DEBOUNCE_MS = 220;

/** Venue caramel tint replacing the source's vec3(0.7, 0.3, 1.0). */
const TINT = [0.78, 0.5, 0.32];

const VERTEX_SRC = `
attribute vec2 position;
void main() {
    gl_Position = vec4(position, 0.0, 1.0);
}
`;

// The authored fragment shader. Only the tint constant line is substituted.
const FRAGMENT_SRC = `
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform vec2 uMouse;

vec2 barrel(vec2 uv, float amt) {
    vec2 cc = uv - 0.5;
    float r = dot(cc, cc);
    return uv + cc * r * amt;
}

float rand(vec2 co) {
    return fract(sin(dot(co, vec2(12.9898,78.233))) * 43758.5453);
}

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;

    // Parallax drift based on uMouse
    vec2 mouseOffset = (uMouse - 0.5) * 0.05;
    uv += mouseOffset;

    // Barrel distortion curvature
    uv = barrel(uv, 0.2);

    // Clamp edges
    if(uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
        return;
    }

    // Dot matrix resolution
    vec2 gridCount = vec2(100.0, 100.0 * (iResolution.y / iResolution.x));
    vec2 gridUv = fract(uv * gridCount);
    vec2 id = floor(uv * gridCount);

    // Radial symmetry distance
    vec2 cc = id / gridCount - 0.5;
    float dist = length(cc);

    // Slow breathing pulse
    float pulse = sin(iTime * 1.5 - dist * 10.0) * 0.5 + 0.5;

    // Dot formulation
    float dotSize = 0.35 * pulse;
    float d = length(gridUv - 0.5);
    float circle = smoothstep(dotSize, dotSize - 0.05, d);

    // Digital scanlines
    float scanline = sin(uv.y * 800.0) * 0.03;

    // Randomized flicker
    float flicker = rand(vec2(iTime, id.y)) > 0.98 ? 0.4 : 1.0;

    // Base color compilation (Tinted Monotone — venue caramel)
    vec3 col = vec3(circle * pulse * flicker);
    col -= scanline;
    col *= vec3(${TINT[0]}, ${TINT[1]}, ${TINT[2]});

    // Vignette edge masking
    col *= smoothstep(0.8, 0.2, dist);

    // Alpha compositing over the page cream (authored output is monotone
    // luminance before tinting, so luminance doubles as coverage). RGB is
    // premultiplied by alpha because WebGL canvases composite premultiplied
    // by default — without this, dots get bright fringes over the page.
    float lum = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0);
    float a = lum * 0.55;
    gl_FragColor = vec4(col * a, a);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`shader compile failed: ${log}`);
  }
  return sh;
}

type Controller = {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  program: WebGLProgram | null;
  iRes: WebGLUniformLocation | null;
  iTime: WebGLUniformLocation | null;
  uMouse: WebGLUniformLocation | null;
  width: number;
  height: number;
  dpr: number;
  mouseX: number;
  mouseY: number;
  last: number | null; // seconds timestamp of the previous frame
  clock: number; // authored iTime, frozen while the tab is hidden
  raf: number | null;
  running: boolean;
  reducedMotion: boolean;
};

/**
 * Create (or re-create, after context loss) every GL resource: program,
 * quad buffer, and uniform locations. Context loss invalidates all of them,
 * so the restore handler simply calls this again.
 */
function initResources(c: Controller): boolean {
  const gl = c.gl;
  try {
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SRC);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? "link failed");
    }
    gl.useProgram(program);
    c.program = program;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1.0, -1.0, 1.0, -1.0, -1.0, 1.0,
        -1.0, 1.0, 1.0, -1.0, 1.0, 1.0,
      ]),
      gl.STATIC_DRAW,
    );
    const posLoc = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    c.iRes = gl.getUniformLocation(program, "iResolution");
    c.iTime = gl.getUniformLocation(program, "iTime");
    c.uMouse = gl.getUniformLocation(program, "uMouse");
    return true;
  } catch (err) {
    console.error("[VoidField] GL resource init failed:", err);
    return false;
  }
}

function drawStatic(c: Controller) {
  // One frame at a fixed clock — the reduced-motion render.
  if (!c.program) return;
  c.gl.uniform2f(c.iRes, c.width, c.height);
  c.gl.uniform1f(c.iTime, 1.2);
  c.gl.uniform2f(c.uMouse, 0.5, 0.5);
  c.gl.drawArrays(c.gl.TRIANGLES, 0, 6);
}

function frame(c: Controller, nowMs: number) {
  if (document.hidden || !c.program) {
    c.raf = null;
    c.running = false;
    return;
  }
  const now = nowMs / 1000;
  if (c.last === null) c.last = now;
  // Advance the authored clock by real elapsed time, clamped so a tab-switch
  // or long stall doesn't jump the animation.
  c.clock += Math.min(0.05, now - c.last);
  c.last = now;

  c.gl.uniform2f(c.iRes, c.width, c.height);
  c.gl.uniform1f(c.iTime, c.clock);
  c.gl.uniform2f(c.uMouse, c.mouseX, c.mouseY);
  c.gl.drawArrays(c.gl.TRIANGLES, 0, 6);

  c.raf = requestAnimationFrame((t) => frame(c, t));
}

function start(c: Controller) {
  if (c.running || c.reducedMotion || document.hidden) return;
  c.running = true;
  c.last = null;
  c.raf = requestAnimationFrame((t) => frame(c, t));
}

function buildController(canvas: HTMLCanvasElement): Controller | null {
  const gl = canvas.getContext("webgl", { alpha: true, antialias: false });
  if (!gl) return null;

  const c: Controller = {
    canvas,
    gl,
    program: null,
    iRes: null,
    iTime: null,
    uMouse: null,
    width: 0,
    height: 0,
    dpr: 1,
    mouseX: 0.5,
    mouseY: 0.5,
    last: null,
    clock: 0,
    raf: null,
    running: false,
    reducedMotion:
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };

  if (!initResources(c)) return null;

  // Author-identical pointer drift tracking (normalized, Y flipped).
  const onPointer = (e: PointerEvent) => {
    c.mouseX = e.clientX / window.innerWidth;
    c.mouseY = 1.0 - e.clientY / window.innerHeight;
  };
  document.addEventListener("pointermove", onPointer, { passive: true });

  // Adaptive backing resolution: CSS size × devicePixelRatio (≤ 2), so the
  // dot grid stays crisp on desktop and performant on mobile.
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(window.innerWidth * dpr));
    const h = Math.max(1, Math.round(window.innerHeight * dpr));
    if (w === c.width && h === c.height && dpr === c.dpr) return;
    c.width = w;
    c.height = h;
    c.dpr = dpr;
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = "100vw";
    canvas.style.height = "100vh";
    gl.viewport(0, 0, w, h);
  };

  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  const queueResize = () => {
    if (resizeTimer !== null) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      resize();
      if (c.reducedMotion) drawStatic(c);
    }, RESIZE_DEBOUNCE_MS);
  };
  let observer: ResizeObserver | null = null;
  if (typeof ResizeObserver === "function") observer = new ResizeObserver(queueResize);
  else window.addEventListener("resize", queueResize);

  const onVisibility = () => {
    if (document.hidden) {
      if (c.raf !== null) cancelAnimationFrame(c.raf);
      c.raf = null;
      c.running = false;
    } else {
      c.last = null; // freeze the clock while hidden; resume seamlessly
      start(c);
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  // Context loss is recoverable: re-create every GL resource on restore.
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    c.program = null;
    if (c.raf !== null) cancelAnimationFrame(c.raf);
    c.raf = null;
    c.running = false;
  });
  canvas.addEventListener("webglcontextrestored", () => {
    if (!initResources(c)) return;
    if (c.reducedMotion) drawStatic(c);
    else start(c);
  });

  // Initial sizing + first render.
  resize();
  if (c.reducedMotion) drawStatic(c);
  else start(c);

  if (observer) observer.observe(canvas);

  const cAny = c as Controller & {
    __observer?: ResizeObserver | null;
    __onVisibility?: () => void;
    __onPointer?: (e: PointerEvent) => void;
    __resizeTimer?: ReturnType<typeof setTimeout> | null;
  };
  cAny.__observer = observer;
  cAny.__onVisibility = onVisibility;
  cAny.__onPointer = onPointer;
  cAny.__resizeTimer = resizeTimer;
  return c;
}

export function VoidFieldCanvas({ quiet = false }: { quiet?: boolean }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const canvas = document.createElement("canvas");
    canvas.style.position = "fixed";
    canvas.style.inset = "0";
    canvas.style.width = "100vw";
    canvas.style.height = "100vh";
    canvas.style.zIndex = "-1";
    canvas.style.pointerEvents = "none";
    // Own compositor layer for the animating surface — without it, some
    // mobile GPUs (Adreno/Mali) mis-blend the tiles of the sticky header
    // stacked above this canvas, flickering the navbar on every page. This
    // is the standard fix (same pattern as fixed-background/pannellum-style
    // layer promotion); no visual change on desktop.
    canvas.style.transform = "translateZ(0)";
    canvas.style.willChange = "transform";
    canvas.style.backfaceVisibility = "hidden";
    // Readability: keep the field as ambience, not competition. 0.7 puts peak
    // dot contrast clearly visible in margins/gutters while staying well under
    // body-text contrast (see the veil below for the text-zone balance).
    // QUIET mode (data-heavy examiner workspaces): drop the field to a
    // whisper so rows, counts, and borders dominate — same brand texture,
    // content-first hierarchy. The veil is lifted too, so the quieter field
    // never reads as a dirty haze behind the cards.
    canvas.style.opacity = quiet ? "0.22" : "0.7";
    host.appendChild(canvas);

    // Readability veil — a soft cream wash ONLY over the content band where
    // headlines and paragraphs actually sit (60% × 48% ellipse at the text
    // block's position), fading to nothing before the viewport edges so the
    // field stays clearly visible in the margins and between sections. Peak
    // alpha 0.5 (halved from 0.92), with a 0.4 mid stop so even muted text
    // at the band's edge stays ≥ 4.6:1 against the brightest possible dot:
    // text behind the busiest point reads at AA while the animation is no
    // longer erased where it's most visible. Sits above the canvas, below
    // all page content, ignores pointers.
    const veil = document.createElement("div");
    veil.setAttribute("aria-hidden", "true");
    veil.style.position = "fixed";
    veil.style.inset = "0";
    veil.style.zIndex = "-1";
    veil.style.pointerEvents = "none";
    veil.style.background = quiet
      ? "radial-gradient(ellipse 75% 70% at 50% 40%, rgba(247, 243, 236, 0.85) 0%, rgba(247, 243, 236, 0.6) 60%, rgba(247, 243, 236, 0) 100%)"
      : "radial-gradient(ellipse 60% 48% at 50% 32%, rgba(247, 243, 236, 0.5) 0%, rgba(247, 243, 236, 0.4) 55%, rgba(247, 243, 236, 0) 100%)";
    host.appendChild(veil);

    const c = buildController(canvas);
    if (!c) return; // no WebGL — the cream page simply stays plain

    const cAny = c as Controller & {
      __observer?: ResizeObserver | null;
      __onVisibility?: () => void;
      __onPointer?: (e: PointerEvent) => void;
      __resizeTimer?: ReturnType<typeof setTimeout> | null;
    };
    return () => {
      if (cAny.__resizeTimer) clearTimeout(cAny.__resizeTimer);
      cAny.__observer?.disconnect();
      document.removeEventListener("visibilitychange", cAny.__onVisibility!);
      document.removeEventListener("pointermove", cAny.__onPointer!);
      if (c.raf !== null) cancelAnimationFrame(c.raf);
      c.gl.getExtension("WEBGL_lose_context")?.loseContext();
      veil.remove();
      canvas.remove();
    };
    // `quiet` is fixed per page mount (each page declares its own mode), so
    // the mount-only effect reading it once is correct — declared to satisfy
    // the lint rule without re-initializing WebGL on an unchanged prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div ref={hostRef} aria-hidden="true" data-pixel-canvas />;
}
