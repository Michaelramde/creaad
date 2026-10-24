/**
 * Alimente l'index visuel à partir des recherches AliExpress.
 *
 *   node --env-file=.env.local .tmp/index-products.mjs [--per=4] [--only=sac]
 *
 * Idempotent : (provider, external_id) unique, on met à jour l'image et le
 * vecteur si le produit est déjà connu.
 */
import { readFile } from "node:fs/promises";
import { Pool } from "@neondatabase/serverless";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const env = await readFile(".env.local", "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
const key = /^GEMINI_API_KEY="?([^"\n]+)"?/m.exec(env)?.[1];
const per = Number(process.argv.find((a) => a.startsWith("--per="))?.split("=")[1] ?? 4);
const only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];

const seeds = JSON.parse(await readFile("scripts/collector/seeds.json", "utf8")).targets;
const targets = only ? seeds.filter((s) => s.archetypeSlug.includes(only)) : seeds;

function extractArray(source, startIndex) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = startIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) return source.slice(startIndex, i + 1);
    }
  }
  return null;
}

async function searchItems(query) {
  const html = await (
    await fetch(
      `https://fr.aliexpress.com/w/wholesale-${encodeURIComponent(query.replace(/\s+/g, "-"))}.html`,
      {
        headers: { "User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9" },
        signal: AbortSignal.timeout(30_000),
      },
    )
  ).text();
  const marker = '"itemList":{"content":[';
  const at = html.indexOf(marker);
  const raw = at >= 0 ? extractArray(html, at + marker.length - 1) : null;
  return raw ? JSON.parse(raw) : [];
}

async function embed(imageUrl) {
  const res = await fetch(imageUrl, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`image HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "models/gemini-embedding-2",
        content: {
          parts: [
            {
              inline_data: {
                mime_type: res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg",
                data: buf.toString("base64"),
              },
            },
          ],
        },
      }),
      signal: AbortSignal.timeout(45_000),
    },
  );
  if (!r.ok) throw new Error(`embedding HTTP ${r.status}`);
  return (await r.json()).embedding.values;
}

const pool = new Pool({ connectionString: dbUrl, max: 2 });
pool.on("error", (e) => console.error("db:", e.message));

let indexed = 0;
let failed = 0;

for (const seed of targets) {
  const category = seed.archetypeSlug.split("-")[0];
  process.stdout.write(`→ ${seed.archetypeSlug} … `);

  let items;
  try {
    items = (await searchItems(seed.query)).slice(0, per);
  } catch (error) {
    console.log(`recherche échouée (${error.message})`);
    failed += 1;
    continue;
  }

  let count = 0;
  for (const item of items) {
    const img = item.image?.imgUrl ?? "";
    const title = item.title?.displayTitle ?? "";
    if (!img || !title) continue;
    const imageUrl = img.startsWith("//") ? `https:${img}` : img;

    try {
      const vector = await embed(imageUrl);
      await pool.query(
        `INSERT INTO product_index
           (archetype_slug, category, provider, external_id, title, url, image_url, embedding)
         VALUES ($1,$2,'aliexpress',$3,$4,$5,$6,$7)
         ON CONFLICT (provider, external_id)
         DO UPDATE SET image_url = EXCLUDED.image_url, embedding = EXCLUDED.embedding`,
        [
          seed.archetypeSlug,
          category,
          String(item.productId),
          title.slice(0, 300),
          `https://fr.aliexpress.com/item/${item.productId}.html`,
          imageUrl,
          JSON.stringify(vector),
        ],
      );
      count += 1;
      indexed += 1;
    } catch (error) {
      failed += 1;
      if (failed <= 3) console.log(`\n   échec ${item.productId}: ${error.message}`);
    }
  }
  console.log(`${count} produit(s) indexé(s)`);
}

const total = await pool.query("SELECT category, count(*) FROM product_index GROUP BY category ORDER BY 2 DESC");
console.log(`\n${indexed} indexé(s) · ${failed} échec(s)`);
for (const row of total.rows) console.log(`  ${row.category}: ${row.count}`);
await pool.end();
