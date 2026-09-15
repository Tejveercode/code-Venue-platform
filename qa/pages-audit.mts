// QA-only: cross-page geometry audit for the final polish pass.
//   bun qa/pages-audit.mts
// Evidence gathered: measured geometry (A) + screenshot files (B). NOT a
// substitute for human aesthetic judgment (C).
import { chromium } from "playwright";
import { createServer } from "http";
import { readFileSync, existsSync, mkdirSync } from "fs";
import { extname, join } from "path";

const DIST = "qa/dist";
const PORT = 5197;
const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

const server = createServer((req, res) => {
  const url = (req.url ?? "/").split("?")[0];
  let file = join(DIST, url === "/" ? "qa.html" : url);
  if (!existsSync(file) || url === "/") {
    // qa/dist/qa.html is the UNPROCESSED source; the built entry is
    // qa/dist/qa/qa.html (rollup preserves the qa/ input dir + name).
    file = join(DIST, "qa", "qa.html");
  }
  try {
    const body = readFileSync(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("nf");
  }
});
await new Promise<void>((r) => server.listen(PORT, r));

const WIDTHS = [320, 360, 375, 390, 414, 480, 768, 820, 860, 1024, 1280, 1440, 1920];
const ZOOMS = [0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 2.0];
const SCENARIOS = ["mixed", "empty", "landing", "about"] as const;

const browser = await chromium.launch();
const problems: string[] = [];
const ok = (msg: string) => console.log("  ✓", msg);
let shots = 0;
mkdirSync("qa/screenshots", { recursive: true });

for (const scenario of SCENARIOS) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${PORT}/?scenario=${scenario}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(250);

  console.log(`\n== ${scenario} ==`);

  // --- full width + zoom sweep -------------------------------------------
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(60);
    const m = await page.evaluate(() => {
      const d = document.documentElement;
      const header = document.querySelector(".cv-header");
      const nav = document.querySelector(".cv-nav");
      const collapsed = nav ? getComputedStyle(nav).display === "none" : true;
      let navOffset: number | null = null;
      if (header && nav && !collapsed) {
        const h = header.getBoundingClientRect();
        const n = nav.getBoundingClientRect();
        navOffset = Math.abs(n.left + n.width / 2 - (h.left + h.width / 2));
      }
      const btns = [...document.querySelectorAll<HTMLElement>(".cv-exam-card-actions .cv-btn")];
      const heights = [...new Set(btns.map((b) => Math.round(b.getBoundingClientRect().height)))];
      return {
        overflow: d.scrollWidth - d.clientWidth,
        navOffset,
        collapsed,
        btnHeights: heights,
      };
    });
    if (m.overflow > 1) problems.push(`${scenario}@${w}: overflow ${m.overflow}px`);
    if (!m.collapsed && (m.navOffset ?? 0) > 1)
      problems.push(`${scenario}@${w}: nav off-center ${m.navOffset}px`);
    if (m.btnHeights.length > 1) problems.push(`${scenario}@${w}: button heights ${m.btnHeights}`);
  }
  ok(`width sweep (13 widths): ${problems.filter((p) => p.startsWith(scenario)).length === 0 ? "clean" : "see problems"}`);

  // --- zoom sweep ----------------------------------------------------------
  for (const z of ZOOMS) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate((zoom) => {
      document.body.style.zoom = String(zoom);
    }, z);
    await page.waitForTimeout(60);
    const m = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    if (m.overflow > 1) problems.push(`${scenario}@zoom${z}: overflow ${m.overflow}px`);
  }
  await page.evaluate(() => (document.body.style.zoom = ""));
  ok(`zoom sweep (7 levels): clean`);

  // --- scenario-specific checks -------------------------------------------
  if (scenario === "landing") {
    // Card sizing: role cards + feature cards + proof cards measured per row.
    const cards = await page.evaluate(() => {
      const probe = (sel: string) =>
        [...document.querySelectorAll<HTMLElement>(sel)].map((c) => {
          const r = c.getBoundingClientRect();
          const fs = parseFloat(getComputedStyle(c).fontSize) || 16;
          const lh = parseFloat(getComputedStyle(c).lineHeight) || fs * 1.5;
          const contentH = [...c.children].reduce((s, ch) => {
            const cr = ch.getBoundingClientRect();
            const cs = getComputedStyle(ch);
            return s + cr.height + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
          }, 0);
          return {
            w: Math.round(r.width),
            h: Math.round(r.height),
            padTop: getComputedStyle(c).paddingTop,
            padBottom: getComputedStyle(c).paddingBottom,
            slack: Math.round(r.height - (contentH + parseFloat(getComputedStyle(c).paddingTop) + parseFloat(getComputedStyle(c).paddingBottom))),
            rows: Math.round(contentH / lh),
          };
        });
      return {
        roles: probe(".cv-role-card"),
        feats: probe(".cv-feature-card"),
        proof: probe(".cv-stat-card"),
      };
    });
    const samePad = (a: typeof cards.roles) => new Set(a.map((c) => `${c.padTop}/${c.padBottom}`)).size === 1;
    console.log("  role cards:", cards.roles.map((c) => `${c.w}x${c.h}`).join(", "));
    console.log("  feature cards:", cards.feats.map((c) => `${c.w}x${c.h}`).join(", "));
    console.log("  proof cards:", cards.proof.map((c) => `${c.w}x${c.h}`).join(", "));
    if (!samePad(cards.roles) || !samePad(cards.feats)) problems.push("landing: card padding mismatch");
    const featSlack = cards.feats.map((c) => c.slack);
    console.log(`  feature-card free space per card: ${featSlack.join(", ")}px`);
    await page.setViewportSize({ width: 1440, height: 2400 });
    await page.screenshot({ path: "qa/screenshots/p7-landing-1440.png", fullPage: true });
    shots++;
  }

  if (scenario === "about") {
    const link = await page.evaluate(() => {
      const a = [...document.querySelectorAll<HTMLAnchorElement>(".ab-person-link")];
      const hrefs = [...document.querySelectorAll<HTMLAnchorElement>(".ab-person.ab-linked")].map((x) => x.href);
      return { linkCount: a.length, hrefs };
    });
    const hasTarget = link.hrefs.some((h) => h.replace(/\/$/, "") === "https://github.com/Craftedcode623");
    console.log(`  linked persons: ${link.hrefs.length}, GitHub link present: ${hasTarget}`);
    if (!hasTarget) problems.push("about: github.com/Craftedcode623 link missing");
    // Card equality: all 4 team cards same size (grid + link present).
    await page.setViewportSize({ width: 1024, height: 1200 });
    const sizes = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".ab-person")].map((c) => `${Math.round(c.getBoundingClientRect().width)}x${Math.round(c.getBoundingClientRect().height)}`),
    );
    const uniform = new Set(sizes.map((s) => s.split("x")[1])).size === 1;
    console.log(`  team card sizes @1024: ${sizes.join(", ")} — heights uniform: ${uniform}`);
    if (!uniform) problems.push("about: team card heights uneven");
    await page.screenshot({ path: "qa/screenshots/p7-about-1024.png", fullPage: true });
    shots++;
  }

  if (scenario === "mixed") {
    // Search icon math centering at three widths.
    for (const w of [390, 820, 1440]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(60);
      const s = await page.evaluate(() => {
        const wrap = document.querySelector<HTMLElement>(".cv-search-wrap");
        const icon = document.querySelector<HTMLElement>(".cv-search-icon");
        const input = document.querySelector<HTMLElement>(".cv-search-wrap .cv-search");
        if (!wrap || !icon || !input) return null;
        const wr = wrap.getBoundingClientRect();
        const ir = icon.getBoundingClientRect();
        const inr = input.getBoundingClientRect();
        return {
          iconCenterDelta: Math.abs(ir.top + ir.height / 2 - (inr.top + inr.height / 2)),
          inputTopDelta: Math.abs(inr.top - wr.top),
          sameHeight: Math.abs(inr.height - wr.height) < 1,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      if (!s) problems.push(`mixed@${w}: search wrap/icon/input not found`);
      else {
        const pass = s.iconCenterDelta <= 1 && s.inputTopDelta <= 1 && s.sameHeight && s.overflow <= 1;
        console.log(`  search @${w}: icon-center Δ ${s.iconCenterDelta.toFixed(2)}px, input fills wrapper: ${s.sameHeight} → ${pass ? "PASS" : "FAIL"}`);
        if (!pass) problems.push(`mixed@${w}: search icon misaligned`);
      }
    }
    await page.setViewportSize({ width: 1440, height: 2000 });
    await page.screenshot({ path: "qa/screenshots/p7-dashboard-1440.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 1400 });
    await page.screenshot({ path: "qa/screenshots/p7-dashboard-390.png", fullPage: true });
    shots += 2;
  }

  if (scenario === "empty") {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.screenshot({ path: "qa/screenshots/p7-empty-390.png", fullPage: true });
    shots++;
  }

  if (errors.length > 0) problems.push(`${scenario}: console/page errors: ${errors.slice(0, 3).join(" | ")}`);
  await ctx.close();
}

await browser.close();
server.close();

console.log(`\n${shots} screenshots saved to qa/screenshots/`);
if (problems.length === 0) {
  console.log("RESULT: ALL CHECKS PASS");
} else {
  console.log(`RESULT: ${problems.length} PROBLEM(S):`);
  for (const p of problems) console.log("  ✗", p);
  process.exitCode = 1;
}
