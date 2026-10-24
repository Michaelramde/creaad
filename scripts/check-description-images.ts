/** Pourquoi les images de description ne rentrent-elles pas ? */
import { readFile } from "node:fs/promises";
import { Pool } from "@neondatabase/serverless";
import { extractDescriptionImages } from "@/lib/products/normalize";

const env = await readFile(".env.local", "utf8");
const url = /^DATABASE_URL="?([^"\r\n]+)"?/m.exec(env)?.[1];
const pool = new Pool({ connectionString: url, max: 1 });

const { rows } = await pool.query(
  "SELECT description_url, jsonb_array_length(images) AS n, jsonb_array_length(reviews) AS r FROM product_records LIMIT 1",
);
console.log(`en base : ${rows[0]?.n ?? 0} images · ${rows[0]?.r ?? 0} avis`);
console.log(`descriptionUrl : ${rows[0]?.description_url?.slice(0, 80) ?? "absente"}`);

const descriptionUrl = rows[0]?.description_url;
if (descriptionUrl) {
  try {
    const res = await fetch(descriptionUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(20_000),
    });
    const html = await res.text();
    console.log(`fetch : HTTP ${res.status} · ${html.length} octets`);
    const images = extractDescriptionImages(html);
    console.log(`images extraites : ${images.length}`);
    for (const image of images.slice(0, 3)) console.log(`  ${image.url.slice(0, 80)}`);
  } catch (error) {
    console.log(`fetch échoué : ${(error as Error).message}`);
  }
}

await pool.end();
