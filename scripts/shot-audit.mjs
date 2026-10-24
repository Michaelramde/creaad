import { chromium } from "playwright-core";

const EXE = `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe`;
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox", "--disable-gpu"] });
const context = await browser.newContext({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 2 });
const page = await context.newPage();

await page.goto("https://creaad.site/demo/classement", { waitUntil: "networkidle", timeout: 90_000 });

const height = await page.evaluate(() => document.body.scrollHeight);
const slices = Math.ceil(height / 1100);
for (let i = 0; i < slices; i += 1) {
  await page.evaluate((offset) => window.scrollTo(0, offset), i * 1100);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `.tmp/audit-${i + 1}.png` });
}
console.log(`audit : ${slices} captures · hauteur ${height}px`);
await browser.close();
