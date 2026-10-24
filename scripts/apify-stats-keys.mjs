/** Quelles métriques le store expose-t-il ? */
import { readFile } from "node:fs/promises";

const token = (await readFile(".secrets/apify_token.txt", "utf8")).trim();
const res = await fetch(`https://api.apify.com/v2/acts/zen-studio~aliexpress-scraper?token=${token}`);
const { data } = await res.json();
console.log("stats :", JSON.stringify(data.stats, null, 2));
console.log("\nnote :", data.actorReviewRating, "· avis :", data.actorReviewCount);
