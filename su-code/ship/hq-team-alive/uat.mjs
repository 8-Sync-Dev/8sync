// UAT for hq-team-alive (C6): a real headless Chromium (playwright-core from PW_DIR + the cached
// chrome-headless-shell, or Edge when PW_EXE is unset and msedge exists) against the seeded dev server.
// Usage: node uat.mjs <base-url> <out-dir> <auto-state-file>
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [base, out, autoState, standupFile] = process.argv.slice(2);
const require = createRequire(path.join(process.env.PW_DIR ?? path.join(os.homedir(), "tmp", "hq-uat"), "x.js"));
const { chromium } = require("playwright-core");
fs.mkdirSync(out, { recursive: true });

const fails = [];
const check = (ok, what) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) fails.push(what);
};
const launch = process.env.PW_EXE ? { executablePath: process.env.PW_EXE, headless: true } : { channel: "msedge", headless: true };
const browser = await chromium.launch(launch);
const open = async (opts = {}) => {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark", ...opts });
  p.on("pageerror", (e) => fails.push(`pageerror: ${e.message}`));
  await p.addInitScript((k) => localStorage.setItem(k, "1"), "hq.guide.seen");
  await p.goto(base, { waitUntil: "domcontentloaded" });
  await p.getByRole("tab", { name: "Văn phòng" }).click();
  await p.waitForSelector("article", { timeout: 30_000 });
  return p;
};

// Room B "speaks" right now (HH:MM of this minute): its lead is in the walk-out phase for a minute.
const hhmm = () => new Date().toISOString().slice(11, 16);
const sayB = () => fs.appendFileSync(standupFile, `| ${hhmm()} | bbbbbbbb | Test giỏ hàng | Review PR #12 | chờ CI |\n`);
sayB();
let page = await open();
await page.waitForTimeout(1500);
let panel = page.getByRole("tabpanel");
if (!/Lead đi họp sprint/.test(await panel.innerText())) {
  // The minute turned over between the seed and the first paint: say it again and reload once.
  sayB();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "Văn phòng" }).click();
  await page.waitForSelector("article", { timeout: 30_000 });
  await page.waitForTimeout(2500);
  panel = page.getByRole("tabpanel");
}

// Only the seeded project: the owner's real tmux sessions (not isolated by HOME) may add other rooms.
const shop = panel.locator("section", { has: page.locator("h2", { hasText: /^shop$/ }) });
check((await shop.count()) === 1, "the seeded project shop is shown");

// 1. The meeting room: both rooms of the project sit at one table.
const meeting = shop.locator('[aria-label^="Phòng họp sprint"]');
// The meeting comes with the next office poll; give it one poll, and keep the section for a post-mortem.
await meeting.first().waitFor({ timeout: 15_000 }).catch(() => undefined);
if ((await meeting.count()) !== 1) fs.writeFileSync(path.join(out, "debug-shop.html"), await shop.first().innerHTML());
check((await meeting.count()) === 1, "one meeting room for the project");
const label = (await meeting.first().getAttribute("aria-label")) ?? "";
check(/2 phòng/.test(label), `meeting room lists 2 rooms (${label})`);
const atTable = await meeting.first().locator("canvas").count();
check(atTable >= 2, `two characters at the table (${atTable} canvases)`);
const mtext = await meeting.first().innerText();
check(/Review PR #12/.test(mtext), "an attendee's doing line is shown at the table");

// 2. Lead seats are empty while their lead is in the meeting.
const rooms = shop.locator("article");
const nRooms = await rooms.count();
check(nRooms === 2, `two rooms (${nRooms})`);
const roomsText = await rooms.allInnerTexts();
check(roomsText.every((t) => /đi họp/.test(t)), "every attending room says its lead went to the meeting");
check(roomsText.some((t) => /Lead đi họp sprint/.test(t)), "the lead of the room that just spoke walks out of the room (phase out)");

// 3. Clones: the Fullstack seat of room A has two running `task` agents -> two sprites.
// (any room: the office sorts the rooms, so room A is not necessarily first)
const seatCanvases = await rooms.locator("ul > li").evaluateAll((lis) => lis.map((li) => li.querySelectorAll("canvas").length));
check(seatCanvases.some((n) => n >= 2), `a seat with 2 running agents draws 2 sprites (${seatCanvases.join(",")})`);
check(roomsText.some((t) => /×2/.test(t)), "the cloned seat is labelled ×2");

// 4. Pause / Run: the page turned auto on by itself; clicking pauses through /api/auto.
await page.waitForTimeout(1500);
const state0 = fs.existsSync(autoState) ? fs.readFileSync(autoState, "utf8").trim() : "(none)";
check(state0 === "on", `HQ turned auto on by itself (fake 8sync state: ${state0})`);
const pauseBtn = page.getByRole("button", { name: /Tạm dừng/ });
check((await pauseBtn.count()) === 1, "a 'Tạm dừng' button is shown while running");
await pauseBtn.first().click();
await page.waitForTimeout(1200);
const state1 = fs.readFileSync(autoState, "utf8").trim();
check(state1 === "pause", `click pauses (fake 8sync state: ${state1})`);
check((await page.getByRole("button", { name: /Chạy liên tục/ }).count()) === 1, "button now offers 'Chạy liên tục'");
await page.waitForTimeout(2500);
check(fs.readFileSync(autoState, "utf8").trim() === "pause", "HQ does not turn auto back on after the owner paused");

// 5. Alive: meeting-room canvases change over 1.5 s; reduced motion stays still.
const snap = (p) => p.evaluate(() => [...document.querySelectorAll('[aria-label^="Phòng họp sprint"] canvas, article canvas')].map((c) => c.toDataURL()).join("|"));
const a0 = await snap(page);
await page.waitForTimeout(1500);
const a1 = await snap(page);
check(a0.length > 0 && a0 !== a1, "canvases animate (pixels change over 1.5 s)");
await page.screenshot({ path: path.join(out, "1-office-meeting.png"), fullPage: true });

const still = await open({ reducedMotion: "reduce" });
await still.waitForTimeout(800);
const r0 = await snap(still);
await still.waitForTimeout(1500);
const r1 = await snap(still);
check(r0.length > 0 && r0 === r1, "reduced motion: canvases stay still");
await still.screenshot({ path: path.join(out, "2-office-reduced-motion.png"), fullPage: true });
await still.close();

// 6. Phone width: no horizontal overflow.
const phone = await open({ viewport: { width: 390, height: 844 } });
await phone.waitForTimeout(800);
const over = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check(over <= 0, `no horizontal overflow at 390 px (${over})`);
await phone.screenshot({ path: path.join(out, "3-office-390.png"), fullPage: true });
await phone.close();

await browser.close();
console.log(fails.length ? `UAT FAIL (${fails.length}): ${fails.join(" · ")}` : "UAT PASS");
process.exit(fails.length ? 1 : 0);
