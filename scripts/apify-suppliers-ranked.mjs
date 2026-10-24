/**
 * Comparatif des acteurs « fournisseurs » (Alibaba / 1688) sur les métriques
 * réelles du store, puis mesure du coût effectif sur un même produit.
 */
import { readFile, writeFile } from "node:fs/promises";

const token = (await readFile(".secrets/apify_token.txt", "utf8")).trim();
const QUERY = "leather messenger bag men chest sling";

const TERMS = ["1688", "alibaba", "wholesale supplier", "sourcing"];

const seen = new Map();
for (const term of TERMS) {
  const res = await fetch(
    `https://api.apify.com/v2/store?search=${encodeURIComponent(term)}&limit=25&token=${token}`,
  );
  if (!res.ok) continue;
  const { data } = await res.json();
  for (const item of data?.items ?? []) {
    seen.set(`${item.username}/${item.name}`, item);
  }
}

const rows = [];
for (const [key, item] of seen) {
  const stats = item.stats ?? {};
  const runs = stats.publicActorRunStats30Days ?? {};
  const total = runs.TOTAL ?? 0;
  rows.push({
    key,
    runs: stats.totalRuns ?? 0,
    users7d: stats.totalUsers7Days ?? 0,
    success: total > 0 ? ((runs.SUCCEEDED ?? 0) / total) * 100 : null,
    rating: item.actorReviewRating ?? 0,
    reviews: item.actorReviewCount ?? 0,
  });
}

const score = (r) =>
  (r.success ?? 0) * 0.5 +
  Math.log10(1 + r.runs) * 6 +
  Math.log10(1 + r.users7d) * 5 +
  r.rating * 3 +
  Math.log10(1 + r.reviews) * 2;

rows.sort((a, b) => score(b) - score(a));

console.log("acteur".padEnd(46) + "runs".padStart(8) + "u/7j".padStart(6) + "succ30".padStart(8) + "note".padStart(10));
console.log("─".repeat(78));
for (const r of rows.slice(0, 10)) {
  console.log(
    r.key.slice(0, 45).padEnd(46) +
      String(Math.round(r.runs / 1000) + "k").padStart(8) +
      String(r.users7d).padStart(6) +
      (r.success === null ? "—" : `${r.success.toFixed(1)}%`).padStart(8) +
      `${r.rating ? r.rating.toFixed(1) : "—"} (${r.reviews})`.padStart(10),
  );
}

/* ── coût réel des deux meilleurs candidats ─────────────────────────────── */
const CANDIDATS = ["zen-studio~1688-wholesale-scraper", "parsebird~1688-wholesale-scraper"];

for (const actor of CANDIDATS) {
  for (const input of [{ query: QUERY, maxItems: 10 }, { keyword: QUERY, maxResults: 10 }]) {
    const started = Date.now();
    const res = await fetch(
      `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(240_000),
      },
    );
    const text = await res.text();
    const seconds = ((Date.now() - started) / 1000).toFixed(0);
    const label = `${actor.split("~")[1]} ${Object.keys(input)[0]}`;

    if (!res.ok) {
      console.log(`${label.padEnd(44)} → HTTP ${res.status} en ${seconds}s ${text.slice(0, 90)}`);
      continue;
    }

    const items = JSON.parse(text);
    const runsRes = await fetch(`https://api.apify.com/v2/acts/${actor}/runs?limit=1&desc=1&token=${token}`);
    const run = (await runsRes.json()).data?.items?.[0];
    const cost = run?.usageTotalUsd ?? 0;

    console.log(
      `${label.padEnd(44)} → ${items.length} résultat(s) · ${cost.toFixed(4)} $ · ${seconds}s`,
    );
    if (items.length > 0) {
      console.log(`   champs : ${Object.keys(items[0]).slice(0, 12).join(", ")}`);
      console.log(`   titre  : ${String(items[0].title ?? items[0].name ?? "").slice(0, 70)}`);
      await writeFile(`.tmp/supplier-${actor.split("~")[1]}.json`, JSON.stringify(items, null, 2));
    }
    break;
  }
}
