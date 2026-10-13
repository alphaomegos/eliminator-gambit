// End-to-end smoke test against a running server.
// Usage: BASE_URL=http://localhost:8787 node e2e/smoke.mjs   (screenshots go to e2e/out/)
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:8787";
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "out");
mkdirSync(out, { recursive: true });
const fixture = (i) => join(here, `fixture${i}.png`);
const NAME = `E2E${Date.now().toString(36).slice(-5).toUpperCase()}`;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));

const step = (s) => console.log(`• ${s}`);
const shot = (name, p = page) => p.screenshot({ path: join(out, `${name}.png`), fullPage: true });

// --- login / create game set
step(`create game set ${NAME}`);
await page.goto(BASE);
await page.fill("#loginName", NAME.toLowerCase());
await page.waitForSelector("#loginPinRow:not(.hidden)");
if ((await page.textContent("#loginPinLabel")) !== "Choose a PIN") throw new Error("expected new game set");
await page.fill("#loginPin", "4321");
await shot("01-login");
await page.click("#loginSubmit");
await page.waitForSelector("#screenMenu:not(.hidden)");

// --- editor: manual round with images
step("editor: manual round");
await page.click("#menuEditor");
await page.waitForSelector("#screenEditor:not(.hidden)");
await page.selectOption("#tplKind", "manual");
await page.fill("#tplName", "Odd one out");
await page.fill("#tplPrompt", "Which one is not a fruit?");
const rows = page.locator(".tplItemRow");
const manual = [
  ["Apple", "Fruit"],
  ["Banana", "Fruit"],
  ["Potato", "Vegetable!"],
  ["Cherry", "Fruit"],
];
for (const [i, [title, secret]] of manual.entries()) {
  const r = rows.nth(i);
  await r.locator("input.input").nth(0).fill(title);
  await r.locator("input.input").nth(1).fill(secret);
  if (title === "Potato") await r.locator('input[type="radio"]').check();
  await r.locator('input[type="file"]').setInputFiles(fixture(i));
  await r.locator(".thumb img").waitFor();
}
await page.locator("#tplImagePicker input[type=file]").setInputFiles(fixture(3));
await page.locator("#tplImagePicker .thumb img").waitFor();
await page.click("#editorSave");
await page.waitForFunction(() => document.querySelector("#editorStatus").textContent.includes("Saved"));
await shot("02-editor-manual");

step("editor: carousel round (validation then save)");
await page.click("#editorAdd");
await page.selectOption("#tplKind", "carousel");
await page.fill("#tplName", "Pick a colour");
await page.fill("#tplPrompt", "Avoid the blue one");
for (const [i, title] of ["Red", "Green", "Blue"].entries()) {
  const r = rows.nth(i);
  await r.locator("input.input").nth(0).fill(title);
  await r.locator("input.input").nth(1).fill(`It is ${title.toLowerCase()}`);
  if (title === "Blue") await r.locator('input[type="radio"]').check();
}
await page.click("#editorSave");
await page.waitForFunction(() => document.querySelector("#editorStatus").textContent.includes("image is required"));
for (let i = 0; i < 3; i++) {
  await rows.nth(i).locator('input[type="file"]').setInputFiles(fixture(i));
  await rows.nth(i).locator(".thumb img").waitFor();
}
await page.click("#editorSave");
await page.waitForFunction(() => document.querySelector("#editorStatus").textContent.includes("Saved"));
if ((await page.locator(".tplRow").count()) !== 2) throw new Error("expected 2 rounds in list");

step("editor: delete needs confirmation");
await page.click("#editorDuplicate");
await page.click("#editorSave");
await page.waitForFunction(() => document.querySelectorAll(".tplRow").length === 3);
await page.click("#editorDelete");
await page.click("#modalActions button:has-text('Cancel')");
await page.click("#editorDelete");
await page.click("#modalActions button:has-text('Delete')");
await page.waitForFunction(() => document.querySelectorAll(".tplRow").length === 2);
await page.click("#editorBack");

// --- setup
step("setup match");
await page.click("#menuNewGame");
await page.waitForSelector(".roundPickRow");
await page.click("#setupClear");
await page.fill("#team1Input", "Owls");
await page.fill("#team2Input", "Foxes");
await page.click(".roundPickRow:has-text('Odd one out')");
await page.click(".roundPickRow:has-text('Pick a colour')");
await page.click(".roundPickRow:has-text('Built-in')");
await shot("03-setup");
await page.click("#setupStart");
await page.waitForSelector("#screenGame:not(.hidden)");

// --- round 1 (manual list)
step("round 1: safe pick, reveal, reload & resume, hit target");
await page.click(".item:has-text('Apple')");
await page.waitForSelector("#modal:not(.hidden)");
await shot("04-reveal");
await page.click("#modalActions button");
if ((await page.textContent("#team1Score")) !== "1") throw new Error("score1 should be 1");
step("undo the safe pick, then redo it");
await page.click("#gameUndo");
await page.click("#modalActions button:has-text('Undo')");
await page.waitForFunction(() => document.querySelector("#team1Score").textContent === "0");
if (!(await page.isVisible("#team1Box.active"))) throw new Error("turn should return to team 1");
await page.click(".item:has-text('Apple')");
await page.click("#modalActions button");
if ((await page.textContent("#team1Score")) !== "1") throw new Error("score1 should be 1 again");
await page.reload();
await page.waitForSelector("#screenMenu:not(.hidden)");
await page.waitForSelector("#menuResume:not(.hidden)");
await page.click("#menuResume");
await page.waitForSelector("#screenGame:not(.hidden)");
await page.click(".item:has-text('Potato')");
await page.click("#modalActions button");
await page.waitForSelector("#roundStatus:not(.hidden)");
const status = await page.textContent("#roundStatus");
if (!status.includes("Owls wins")) throw new Error(`unexpected status: ${status}`);
if ((await page.textContent("#team2Score")) !== "-4") throw new Error("score2 should be -4");
await shot("05-round1-done");

// --- round 2 (carousel)
step("round 2: carousel");
await page.click("#gameNext");
await page.waitForSelector("#roundMedia:not(.hidden) .carouselItem");
await page.click("#showAllBtn");
await shot("06-show-all");
await page.keyboard.press("Escape");
await page.click(".carouselItem:has-text('Red')");
await page.click(".carouselItem:has-text('Green')");
await page.waitForSelector("#roundStatus.tie:not(.hidden)");
await shot("07-carousel-done");

// --- round 3 (built-in) on mobile viewport
step("round 3: built-in on a phone viewport");
await page.click("#gameNext");
await page.waitForSelector(".item");
await page.setViewportSize({ width: 390, height: 844 });
await shot("08-mobile-game");
const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
if (scrollW > 390) throw new Error(`horizontal overflow on mobile: ${scrollW}px`);
// Pick the lowest-rated movie to finish the match quickly
await page.click(".item:has-text('Battlefield Earth')");
await page.waitForSelector("#modalTitle:has-text('match')");
await shot("09-final");
await page.click("#modalActions button:has-text('Back to menu')");
await page.waitForSelector("#screenMenu:not(.hidden)");
if (await page.isVisible("#menuResume")) throw new Error("finished match should not be resumable");

step("mobile editor layout");
await page.click("#menuEditor");
await page.click(".tplRow:has-text('Odd one out')");
await page.waitForFunction(() => document.querySelector("#tplName").value === "Odd one out");
await shot("10-mobile-editor");

step("export + import round-trip");
const [download] = await Promise.all([page.waitForEvent("download"), page.click("#editorExport")]);
const exportPath = join(out, "export.json");
await download.saveAs(exportPath);
await page.locator("#editorImportFile").setInputFiles(exportPath);
await page.click("#modalActions button:has-text('Import')");
await page.waitForFunction(() => document.querySelectorAll(".tplRow").length === 4);
await page.click(".tplRow:has-text('Pick a colour') >> nth=0");
await page.waitForFunction(() => document.querySelectorAll("#tplItems .thumb img").length === 3);

step("switch to Russian");
await page.click("#langSwitch");
await page.waitForFunction(() => document.querySelector("#screenEditor .itemsHeader .editorTitle").textContent === "Варианты");
if ((await page.textContent("#editorSave")) !== "Сохранить") throw new Error("editor not translated");
await shot("11-mobile-editor-ru");
await page.click("#editorBack");
await page.click("#menuNewGame");
await page.waitForSelector(".roundPickRow:has-text('Встроенный')");
await page.click("#setupBack");

step("wrong PIN is rejected (in Russian)");
await page.click("#menuLogout");
await page.waitForSelector("#loginPinRow:not(.hidden)");
await page.fill("#loginPin", "0000");
await page.click("#loginSubmit");
await page.waitForFunction(() => document.querySelector("#loginError").textContent.includes("Неверный PIN"));
await shot("12-login-ru");

await browser.close();
const unexpected = errors.filter((e) => !/status of (400|401)|Wrong PIN/.test(e));
if (unexpected.length) {
  console.error("Browser errors:\n" + unexpected.join("\n"));
  process.exit(1);
}
console.log("✓ e2e smoke passed");
