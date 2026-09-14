// QA-only visual measurement harness.
// Boots a Vite dev server (qa/vite.config.qa.ts), drives the REAL
// ExaminerDashboard + VenueHeader in headless Chromium, and measures actual
// layout geometry at every mandated width and zoom level.
//
//   bun qa/visual-qa.mts
//
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(here, "dist");

// Tiny static server for the prebuilt QA bundle (qa/dist). Building is a
// separate one-shot step (see README note at bottom) — Rolldown's
// programmatic dev server crashes under Bun, so we serve static files.
const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

async function serveStatic(port: number): Promise<() => Promise<void>> {
  const server = createServer((req, res) => {
    const url = (req.url ?? "/").split("?")[0]!;
    // qa.html lives at /qa/qa.html inside dist; map root to it.
    const candidates = [
      path.join(distDir, url),
      path.join(distDir, url, "index.html"),
      path.join(distDir, "qa", "qa.html"),
    ];
    const file = candidates.find((c) => existsSync(c) && !c.endsWith("/"));
    if (!file) {
      res.writeHead(404).end("not found");
      return;
    }
    const body = readFileSync(file);
    res.writeHead(200, {
      "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
    });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return () => new Promise<void>((resolve) => server.close(() => resolve()));
}

const WIDTHS = [320, 360, 375, 390, 414, 480, 768, 820, 1024, 1280, 1440, 1920];
const ZOOMS = [0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 2.0];
// Zoom simulation: browser zoom shrinks the effective CSS viewport, so each
// zoom level is measured at (1280 / zoom) CSS px with deviceScaleFactor=zoom —
// exactly how Chromium zoom behaves.
const ZOOM_BASE_W = 1280;

const SCENARIOS = ["mixed", "empty", "single", "longname", "nostudents", "many"];

type Issue = { where: string; kind: string; detail: string };
const issues: Issue[] = [];
const note = (where: string, kind: string, detail: string) =>
  issues.push({ where, kind, detail });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));  // Background probe reads the veil by its structure (the canvas's sibling
  // fixed div), not a class name — the veil is created in JS with inline styles.

  // --- Probe script: runs in the page, returns pure geometry ------------------
const PROBE = () => {
  const r = (el: Element | null) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  };
  const doc = document.documentElement;
  const header = document.querySelector<HTMLElement>(".cv-header");
  const logo = document.querySelector<HTMLElement>(".cv-logo");
  const nav = document.querySelector<HTMLElement>(".cv-nav");
  const navList = document.querySelector<HTMLElement>(".cv-header .cv-nav-list");
  const auth = document.querySelector<HTMLElement>(".cv-header .cv-auth-buttons");
  const toggle = document.querySelector<HTMLElement>(".cv-menu-toggle");
  const pageWrap = document.querySelector<HTMLElement>(".cv-page-wrap");
  const head = document.querySelector<HTMLElement>(".cv-page-head");
  const actions = document.querySelector<HTMLElement>(".cv-page-actions");
  const cards = [...document.querySelectorAll<HTMLElement>(".cv-exam-card")];
  const statRow = document.querySelector<HTMLElement>(".cv-stat-row");
  const statCards = [...document.querySelectorAll<HTMLElement>(".cv-stat-card")];
  const attention = [...document.querySelectorAll<HTMLElement>(".cv-attention-item")];
  const headings = [...document.querySelectorAll<HTMLElement>(".cv-page-head h1")];
  const buttons = [...document.querySelectorAll<HTMLElement>("button, a")];

  // Horizontal overflow: document scroll width vs viewport width.
  const overflowX = doc.scrollWidth - doc.clientWidth;

  // Navbar centering: nav's visual center vs header's visual center.
  const hr = header?.getBoundingClientRect();
  const navCenter =
    nav && hr ? (nav.getBoundingClientRect().x + nav.getBoundingClientRect().width / 2) : null;
  const headerCenter = hr ? hr.x + hr.width / 2 : null;

  // Any element leaking past the viewport right edge?
  let leakRight: string | null = null;
  for (const el of document.querySelectorAll<HTMLElement>("[data-code-venue-page] *")) {
    const b = el.getBoundingClientRect();
    if (b.width > 0 && b.right > doc.clientWidth + 1) {
      const cls = (el.className && typeof el.className === "string") ? el.className.split(" ")[0] : el.tagName;
      leakRight = `${el.tagName.toLowerCase()}.${cls} right=${Math.round(b.right)}`;
      break;
    }
  }

  // Header row wrapping: do logo/nav/auth share one line? (desktop only)
  const sameRow =
    logo && nav && auth
      ? Math.abs(logo.getBoundingClientRect().y - auth.getBoundingClientRect().y) < 4
      : null;

  // Header height (for unexpected change detection).
  const headerH = hr?.height ?? null;

  // Button vertical alignment inside an exam card's action column.
  const firstCard = cards[0];
  const cardBtns = firstCard ? [...firstCard.querySelectorAll<HTMLElement>(".cv-btn")] : [];
  const btnHeights = cardBtns.map((b) => Math.round(b.getBoundingClientRect().height));

  // Touch targets (mobile): primary action + secondary inside first card.
  const touchTargets = cardBtns.map((b) => ({
    label: (b.textContent ?? "").trim().slice(0, 18),
    h: Math.round(b.getBoundingClientRect().height),
    w: Math.round(b.getBoundingClientRect().width),
  }));

  // Stat card overflow: label text clipped? (scrollWidth vs clientWidth on
  // the value/label nodes)
  const statClip = statCards
    .map((c) => {
      const label = c.querySelector<HTMLElement>(".cv-stat-label");
      const value = c.querySelector<HTMLElement>(".cv-stat-value");
      const lClip = label ? label.scrollWidth - label.clientWidth : 0;
      const vClip = value ? value.scrollWidth - value.clientWidth : 0;
      return { label: lClip, value: vClip };
    })
    .filter((s) => s.label > 2 || s.value > 2).length;

  // Focus visibility: tab to the first focusable and read its outline.
  const firstFocusable = buttons.find(
    (b) => (b as HTMLElement).tabIndex >= 0 && b.offsetParent !== null,
  );
  let focusOutline = "n/a";
  if (firstFocusable) {
    (firstFocusable as HTMLElement).focus();
    const cs = getComputedStyle(firstFocusable);
    focusOutline = `${cs.outlineStyle}/${cs.outlineWidth}`;
    (firstFocusable as HTMLElement).blur();
  }

  // Background canvas present + actually sized?
  const canvas = document.querySelector<HTMLCanvasElement>("canvas");
  const canvasInfo = canvas
    ? { w: canvas.width, h: canvas.height, cssOpacity: getComputedStyle(canvas).opacity }
    : null;

  // Page-head heading wraps into multiple lines? (long-name scenario)
  const h1 = headings[0];
  const h1Lines = h1
    ? Math.round(h1.getBoundingClientRect().height / parseFloat(getComputedStyle(h1).lineHeight || "24"))
    : null;

  // Attention strip geometry.
  const attentionRows = attention.map((a) => Math.round(a.getBoundingClientRect().height));

  // Is the mobile hamburger the active header (nav/auth display:none)? When
  // collapsed, nav geometry checks don't apply.
  const navHidden = nav === null || nav.getBoundingClientRect().width === 0;
  const toggleVisible = toggle !== null && toggle.getBoundingClientRect().width > 0;

  return {
    overflowX,
    leakRight,
    navCenter,
    headerCenter,
    navOffset: navCenter !== null && headerCenter !== null ? Math.abs(navCenter - headerCenter) : null,
    sameRow,
    headerH,
    cardCount: cards.length,
    statCount: statCards.length,
    statClipCount: statClip,
    btnHeights,
    touchTargets,
    focusOutline,
    canvasInfo,
    h1Lines,
    attentionRows,
    navHidden,
    toggleVisible,
    pageWrapW: pageWrap ? Math.round(pageWrap.getBoundingClientRect().width) : null,
    headH: head ? Math.round(head.getBoundingClientRect().height) : null,
    actionsH: actions ? Math.round(actions.getBoundingClientRect().height) : null,
    scrolled: window.scrollY,
    docH: doc.scrollHeight,
  };
};

// --- Main -------------------------------------------------------------------
async function main() {
  const stopServer = await serveStatic(5199);
  const base = "http://127.0.0.1:5199/qa/qa.html";

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

  for (const scenario of SCENARIOS) {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}?scenario=${scenario}`, { waitUntil: "networkidle" });
      await sleep(120); // settle layout/animations
      const m = await page.evaluate(PROBE);

      const where = `${scenario}@${width}`;
      if (m.overflowX > 1) note(where, "overflow-x", `${m.overflowX}px document overflow${m.leakRight ? ` — ${m.leakRight}` : ""}`);
      if (m.leakRight && m.overflowX <= 1) note(where, "element-leak", m.leakRight);
      // Nav centering matters only while the desktop header is actually
      // rendered: below 861px the app collapses to the hamburger (nav/auth
      // display:none → zero rects) — that's the designed behavior, not a bug.
      if (m.navHidden) {
        if (width > 860 && !m.toggleVisible)
          note(where, "navbar-collapse", "nav hidden but hamburger not visible");
      } else {
        if (width > 900 && m.navOffset !== null && m.navOffset > 2) {
          note(where, "navbar-center", `nav off-center by ${m.navOffset.toFixed(1)}px`);
        }
        if (width > 900 && m.sameRow === false)
          note(where, "navbar-wrap", "logo/nav/auth not on one row");
      }
      if (m.btnHeights.length >= 2) {
        const hs = new Set(m.btnHeights);
        if (hs.size > 1) note(where, "button-height", `card buttons differ: ${m.btnHeights.join("/")}`);
      }
      if (m.statClipCount > 0) note(where, "stat-clip", `${m.statClipCount} stat card(s) clip text`);
      if (width <= 480) {
        for (const t of m.touchTargets) {
          if (t.h < 40) note(where, "touch-target", `"${t.label}" height ${t.h}px < 40px`);
        }
      }
      if (m.focusOutline.startsWith("none")) note(where, "focus-visible", `outline ${m.focusOutline}`);
      if (m.canvasInfo && (m.canvasInfo.w === 0 || m.canvasInfo.h === 0)) {
        note(where, "canvas", "canvas has zero size");
      }
      // Long-name heading: >2 lines on desktop suggests wrap mismanagement.
      if (scenario === "longname" && width >= 1024 && (m.h1Lines ?? 0) > 2) {
        note(where, "heading-wrap", `h1 wraps to ${m.h1Lines} lines on desktop`);
      }
    }

    // --- Zoom simulation at 1280 base ---
    for (const zoom of ZOOMS) {
      const cssW = Math.round(ZOOM_BASE_W / zoom);
      await page.setViewportSize({ width: cssW, height: Math.round(900 / zoom) });
      await page.goto(`${base}?scenario=${scenario}`, { waitUntil: "networkidle" });
      await sleep(100);
      const m = await page.evaluate(PROBE);
      const where = `${scenario}@zoom${Math.round(zoom * 100)}%`;
      if (m.overflowX > 1) note(where, "overflow-x", `${m.overflowX}px${m.leakRight ? ` — ${m.leakRight}` : ""}`);
      // Only check nav geometry when the desktop header is actually rendered.
      if (!m.navHidden) {
        if (m.navOffset !== null && m.navOffset > 2) note(where, "navbar-center", `off by ${m.navOffset.toFixed(1)}px`);
        if (m.sameRow === false) note(where, "navbar-wrap", "header row wrapped");
      } else if (!m.toggleVisible) {
        note(where, "navbar-collapse", "collapsed header shows no hamburger");
      }
    }
  }

  // --- Interaction probes (mixed scenario, 1280) ---
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${base}?scenario=mixed`, { waitUntil: "networkidle" });
  await sleep(120);

  // Keyboard: Tab focus order includes header links + card buttons.
  const order: string[] = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    const active = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return "none";
      return `${el.tagName.toLowerCase()}:${(el.textContent ?? "").trim().slice(0, 16) || el.getAttribute("aria-label") || ""}`;
    });
    order.push(active);
  }
  const focusables = order.filter((o) => o !== "none");
  if (focusables.length < 5) note("interaction@1280", "focus-order", `only ${focusables.length} focusables in 12 tabs`);

  // Buttons fire their callbacks.
  await page.getByRole("button", { name: /Create New Exam/i }).click();
  await sleep(50);
  const toastCreate = await page.evaluate(() => (window as any).__qaToast);
  if (toastCreate !== "create") note("interaction@1280", "callback", "Create New Exam did not fire onCreate");
  await page.getByRole("button", { name: /^Profile$/i }).click();
  await sleep(50);
  const toastProfile = await page.evaluate(() => (window as any).__qaToast);
  if (toastProfile !== "profile") note("interaction@1280", "callback", "Profile did not fire onProfile");
  // End button on the first LIVE card.
  const endBtn = page.getByRole("button", { name: /^End$/i }).first();
  if (await endBtn.isVisible().catch(() => false)) {
    await endBtn.click();
    await sleep(50);
    const toastEnd = await page.evaluate(() => (window as any).__qaToast);
    if (toastEnd !== "end") note("interaction@1280", "callback", "End did not fire onEnd");
  } else {
    note("interaction@1280", "callback", "No End button visible on a live card");
  }

  // Mobile menu open/close at 390px.
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${base}?scenario=mixed`, { waitUntil: "networkidle" });
  await sleep(100);
  const toggleVisible = await page.isVisible(".cv-menu-toggle");
  if (!toggleVisible) note("mobile-menu@390", "nav", "hamburger not visible at 390px");
  else {
    await page.click(".cv-menu-toggle");
    await sleep(450); // max-height transition
    const menuOpen = await page.evaluate(() => {
      const m = document.querySelector<HTMLElement>(".cv-mobile-menu");
      return m ? m.classList.contains("open") && m.getBoundingClientRect().height > 40 : false;
    });
    if (!menuOpen) note("mobile-menu@390", "nav", "menu did not open");
    else {
      // Menu links reachable + no overflow while open.
      const m = await page.evaluate(PROBE);
      if (m.overflowX > 1) note("mobile-menu@390", "overflow-x", `menu open causes ${m.overflowX}px overflow`);
      await page.click(".cv-menu-toggle");
      await sleep(450);
      const closed = await page.evaluate(
        () => !document.querySelector<HTMLElement>(".cv-mobile-menu")?.classList.contains("open"),
      );
      if (!closed) note("mobile-menu@390", "nav", "menu did not close");
    }
  }

  // Background comparison: canvas visibility in empty vs dense regions is a
  // design property (veil over text bands); here we verify the canvas paints
  // and the veil exists with expected gradient.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}?scenario=mixed`, { waitUntil: "networkidle" });
  await sleep(150);
  const veil = await page.evaluate(() => {
    // The veil is a fixed, aria-hidden div created by the canvas component —
    // find it structurally: fixed + aria-hidden + radial-gradient background.
    for (const el of document.querySelectorAll<HTMLElement>("div[aria-hidden='true']")) {
      const cs = getComputedStyle(el);
      if (cs.position === "fixed" && cs.backgroundImage.includes("radial-gradient")) {
        return "radial-gradient-present";
      }
    }
    return "no-veil-element";
  });
  if (veil !== "radial-gradient-present")
    note("background@1440", "canvas", `readability veil: ${veil}`);

  await browser.close();
  await stopServer();

  // --- Report ---
  console.log("\n================ QA RESULTS ================");
  if (consoleErrors.length) {
    console.log(`CONSOLE ERRORS (${consoleErrors.length}):`);
    for (const e of [...new Set(consoleErrors)].slice(0, 10)) console.log(`  - ${e.slice(0, 200)}`);
  } else {
    console.log("CONSOLE ERRORS: none");
  }
  if (issues.length === 0) {
    console.log("ISSUES: none — all measured checks passed");
  } else {
    const byKind: Record<string, Issue[]> = {};
    for (const i of issues) (byKind[i.kind] ??= []).push(i);
    console.log(`ISSUES: ${issues.length}`);
    for (const [kind, list] of Object.entries(byKind)) {
      console.log(`\n[${kind}] × ${list.length}`);
      for (const i of list.slice(0, 8)) console.log(`  ${i.where}: ${i.detail}`);
      if (list.length > 8) console.log(`  … +${list.length - 8} more`);
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("HARNESS FAILED:", err);
  process.exit(1);
});
