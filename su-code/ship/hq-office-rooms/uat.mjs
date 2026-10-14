// UAT for hq-office-rooms (C8). Drives a real browser (installed Edge via playwright-core) against
// an HQ UI dev server and checks what the owner asked for:
//   - every session is a room with the same 8-seat template, grouped by project folder + branch;
//   - every seat draws a sprite; canvases animate, and stay still under prefers-reduced-motion;
//   - clicking a running session opens its room chat with a composer, never "Start a session";
//   - Chat nhóm shows messages between rooms; Chat phòng only one room;
//   - Báo cáo shows cost / $ per task from the status-line snapshot.
// Usage: node uat.mjs <base-url> <out-dir> [--seeded <SID_A> <SID_B>]
// PW_DIR points at a folder with playwright-core installed (kept out of the repo).
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [base, out, mode, sidA, sidB] = process.argv.slice(2);
const require = createRequire(path.join(process.env.PW_DIR ?? path.join(os.homedir(), "tmp", "hq-uat"), "x.js"));
const { chromium } = require("playwright-core");
fs.mkdirSync(out, { recursive: true });

const fails = [];
const check = (ok, what) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) fails.push(what);
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
page.on("pageerror", (e) => fails.push(`pageerror: ${e.message}`));
// A returning owner: the first-run guide was already dismissed.
await page.addInitScript((k) => localStorage.setItem(k, "1"), "hq.guide.seen");
await page.goto(base, { waitUntil: "domcontentloaded" });

const office = page.getByRole("tabpanel");
await page.getByRole("tab", { name: "Văn phòng" }).click();
await page.waitForSelector("article", { timeout: 20_000 });
const rooms = await page.locator("article").count();
check(rooms > 0, `office shows rooms (${rooms})`);
const seats = await page.locator("article").first().locator("ul > li").count();
check(seats === 8, `first room has the 8-seat template (${seats})`);
const canvases = await page.locator("article").first().locator("ul > li canvas").count();
check(canvases === 8, `every seat draws a sprite, empty ones too (${canvases})`);

// C5: the office is alive: canvas pixels change over ~1.5 s; with reduced motion they do not.
const snap = (p) =>
  p.evaluate(() =>
    [...document.querySelectorAll("article ul > li canvas")].map((c) => c.toDataURL()).join("|"),
  );
const a0 = await snap(page);
await page.waitForTimeout(1500);
const a1 = await snap(page);
check(a0.length > 0 && a0 !== a1, "office canvases animate (pixels change over 1.5 s)");
const still = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark", reducedMotion: "reduce" });
still.on("pageerror", (e) => fails.push(`pageerror (reduced motion): ${e.message}`));
await still.addInitScript((k) => localStorage.setItem(k, "1"), "hq.guide.seen");
await still.goto(base, { waitUntil: "domcontentloaded" });
await still.getByRole("tab", { name: "Văn phòng" }).click();
await still.waitForSelector("article ul > li canvas", { timeout: 20_000 });
await still.waitForTimeout(800);
const r0 = await snap(still);
await still.waitForTimeout(1500);
const r1 = await snap(still);
check(r0.length > 0 && r0 === r1, "reduced motion: office canvases stay still");
await still.screenshot({ path: path.join(out, "1b-office-reduced-motion.png"), fullPage: true });
await still.close();
await page.screenshot({ path: path.join(out, "1-office.png"), fullPage: true });

if (mode === "--seeded") {
  const text = await office.innerText();
  check(text.includes("shop") && text.includes("feat/cart"), "rooms grouped under project shop with branch feat/cart");
  check(text.includes("shop-api") && text.includes("main"), "second project shop-api on main");
  check(text.includes("Từ"), "a specialist walked into another room (visit shown)");
  check(/Reviewer|R&D/.test(text), "seat labels present");
}

// Click the first room: its chat opens with a composer, not the start CTA.
await page.locator("article h3 button").first().click();
await page.waitForTimeout(800);
const roomText = await page.getByRole("tabpanel").innerText();
check(!roomText.includes("Start a session"), "running room does not show 'Start a session'");
check((await page.locator("#composer").count()) === 1, "room chat has a composer");
const running = await page.locator("dl dt", { hasText: "Running" }).locator("xpath=following-sibling::dd").innerText();
check(Number(running) >= 1, `header counts the session as running (${running})`);
await page.screenshot({ path: path.join(out, "2-chat-phong.png"), fullPage: true });

await page.getByRole("tab", { name: "Chat nhóm" }).click();
await page.waitForTimeout(500);
if (mode === "--seeded") {
  const group = await page.getByRole("tabpanel").innerText();
  check(group.includes("cần API giỏ hàng"), "Chat nhóm shows the message between rooms");
}
await page.screenshot({ path: path.join(out, "3-chat-nhom.png"), fullPage: true });

await page.getByRole("tab", { name: "Báo cáo" }).click();
await page.waitForSelector("table", { timeout: 10_000 });
const report = await page.getByRole("tabpanel").innerText();
check(report.includes("Chi phí") && report.includes("$/task"), "report has cost and $/task");
if (mode === "--seeded") check(report.includes("$1.20") && report.includes("$0.60"), "seeded cost $1.20 and $/task $0.60 shown");
await page.screenshot({ path: path.join(out, "4-bao-cao.png"), fullPage: true });

await page.getByRole("tab", { name: "Board" }).click();
await page.waitForTimeout(500);
if (mode === "--seeded") {
  const board = await page.getByRole("tabpanel").innerText();
  check(board.includes("Giỏ hàng API"), "Board shows the seeded task");
  check(!board.includes("Start a session to hand it tasks"), "Board can hand tasks to a running session (inbox)");
}
await page.screenshot({ path: path.join(out, "5-board.png"), fullPage: true });

// Mobile width: rooms stack, nothing overflows horizontally.
await page.setViewportSize({ width: 390, height: 900 });
await page.getByRole("tab", { name: "Văn phòng" }).click();
await page.waitForTimeout(500);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check(overflow <= 1, `no horizontal overflow at 390 px (${overflow})`);
await page.screenshot({ path: path.join(out, "6-office-mobile.png"), fullPage: true });

await browser.close();
void sidA;
void sidB;
console.log(fails.length ? `UAT FAIL (${fails.length}): ${fails.join("; ")}` : "UAT PASS");
process.exit(fails.length ? 1 : 0);
