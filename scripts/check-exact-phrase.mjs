/** Requête exacte (marque) : qualité et volume. */
import { readFile } from "node:fs/promises";

const token = (await readFile(".secrets/apify_token.txt", "utf8")).trim();
const ACTOR = "jmlp~meta-ad-library-scraper";

const ESSAIS = [
  { label: "exact phrase · JEEP BULUO · ALL", input: { keyword: "JEEP BULUO", searchType: "keyword_exact_phrase", country: "ALL", activeStatus: "active", maxAds: 10 } },
  { label: "exact phrase · sacoche homme · CI", input: { keyword: "sacoche homme", searchType: "keyword_exact_phrase", country: "CI", activeStatus: "active", maxAds: 10 } },
];

for (const essai of ESSAIS) {
  const started = Date.now();
  const res = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(essai.input),
      signal: AbortSignal.timeout(300_000),
    },
  );
  const text = await res.text();
  const seconds = ((Date.now() - started) / 1000).toFixed(0);

  if (!res.ok) {
    console.log(`${essai.label} → HTTP ${res.status}`);
    continue;
  }

  const items = JSON.parse(text);
  const countries = new Set(items.map((i) => JSON.stringify(i.targeted_or_reached_countries ?? null)));

  console.log(`\n${essai.label} → ${items.length} annonces · ${seconds}s`);
  console.log(`   pays renseignés : ${[...countries].slice(0, 3).join(" | ")}`);
  for (const item of items.slice(0, 4)) {
    console.log(
      `   · ${String(item.page_name).slice(0, 22).padEnd(23)} | ${String(item.snapshot?.body?.text ?? "").replace(/\s+/g, " ").slice(0, 58)}`,
    );
  }
}

const runs = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/runs?limit=2&desc=1&token=${token}`);
for (const run of (await runs.json()).data?.items ?? []) {
  console.log(`coût : ${(run.usageTotalUsd ?? 0).toFixed(4)} $`);
}
