import { chromium } from "playwright-core";

const EXE = `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe`;
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox", "--disable-gpu"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "fr-FR" });
const page = await context.newPage();

await page.goto("https://creaad.site/demo/maquette", { waitUntil: "networkidle", timeout: 90_000 });
await page.screenshot({ path: ".tmp/maquette-v2.png", fullPage: true });

const expand = page.locator("button", { hasText: /Voir les \d+ photos/ });
await expand.first().click();
await page.waitForTimeout(1200);
await page.screenshot({ path: ".tmp/maquette-galerie.png" });
console.log(`galerie : ${await page.evaluate(() => document.querySelectorAll("img").length)} images dans le DOM`);

await browser.close();
