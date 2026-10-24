import { chromium } from "playwright-core";

const EXE = `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe`;
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox", "--disable-gpu"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "fr-FR" });
const page = await context.newPage();

await page.goto("https://creaad.site/demo/maquette", { waitUntil: "networkidle", timeout: 60_000 });
await page.screenshot({ path: ".tmp/maquette-1.png", fullPage: true });

// État « sections dépliées »
for (const details of await page.$$("details")) await details.evaluate((node) => (node.open = true));
await page.waitForTimeout(400);
await page.screenshot({ path: ".tmp/maquette-2.png", fullPage: true });

const counts = await page.evaluate(() => ({
  images: document.querySelectorAll("img").length,
  chips: [...document.querySelectorAll("button")].map((b) => b.textContent?.trim()).filter((t) => t && t.length < 24).slice(0, 6),
  text: document.body.innerText.slice(0, 400),
}));

console.log(`images : ${counts.images}`);
console.log(`pastilles : ${counts.chips.join(" | ")}`);
console.log("\n--- texte ---\n" + counts.text);

await browser.close();
