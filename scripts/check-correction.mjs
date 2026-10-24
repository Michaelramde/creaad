/** La correction manuelle change-t-elle vraiment le camp d'une image ? */
import { readFile } from "node:fs/promises";
import { Pool } from "@neondatabase/serverless";

const BASE = "https://creaad.site";
const PHOTO = "https://ae-pic-a1.aliexpress-media.com/kf/S2d87e1462eb74ca8b832bca36cad86eeW.jpg";

const env = await readFile(".env.local", "utf8");
const dbUrl = /^DATABASE_URL="?([^"\r\n]+)"?/m.exec(env)?.[1];
const email = `corr-${Date.now()}@example.test`;

const signUp = await fetch(`${BASE}/api/auth/sign-up/email`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE },
  body: JSON.stringify({ email, password: "motdepasse-2026", name: "Corr" }),
});
const cookie = (signUp.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");

const pool = new Pool({ connectionString: dbUrl, max: 1 });
const userId = (await pool.query('SELECT id FROM "user" WHERE email = $1', [email])).rows[0]?.id;
await pool.query(
  `INSERT INTO wallet_transactions (user_id, type, amount_xof, balance_after, idempotency_key)
   VALUES ($1, 'ajustement', 5000, 5000, $2)`,
  [userId, `corr-${userId}`],
);

const created = await (
  await fetch(`${BASE}/api/analyses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie, Origin: BASE },
    body: JSON.stringify({ country: "CI", images: [{ url: PHOTO, width: 1200, height: 1200 }] }),
  })
).json();

let analysisId = created.analysisId;
if (created.variants) {
  const axis = created.variants[0];
  const chosen = axis.values.filter((v) => v.available).slice(0, 2);
  const step1 = await (
    await fetch(`${BASE}/api/analyses/${analysisId}/variante`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie, Origin: BASE },
      body: JSON.stringify({ selection: { [axis.axis]: chosen.map((v) => v.valueId) } }),
    })
  ).json();
  console.log(`étape 1 : ${step1.status}`);
} else {
  console.log(`analyse directe : ${created.status}`);
}

const productRef = (await pool.query("SELECT product_ref FROM analyses WHERE id = $1", [analysisId])).rows[0]?.product_ref;
const { rows } = await pool.query("SELECT images, variant_axes FROM product_records WHERE product_id = $1", [productRef]);
const images = rows[0].images;
const colours = rows[0].variant_axes[0].values;

const target = images.find((image) => image.variantValueId);
const other = colours.find((colour) => colour.valueId !== target?.variantValueId);
console.log(`image ${target?.url.slice(-24)} · coloris actuel ${target?.variantValueId} → ${other?.valueId} (${other?.name})`);

const res = await fetch(`${BASE}/api/analyses/${analysisId}/image-color`, {
  method: "POST",
  headers: { "Content-Type": "application/json", cookie, Origin: BASE },
  body: JSON.stringify({ url: target.url, valueId: other.valueId }),
});
console.log(`correction : HTTP ${res.status}`);

const stored = await pool.query("SELECT image_corrections FROM analyses WHERE id = $1", [analysisId]);
console.log(`en base : ${JSON.stringify(stored.rows[0]?.image_corrections)?.slice(0, 140)}`);

/* L'export doit refléter la correction : on sélectionne le coloris d'origine,
   l'image corrigée doit avoir quitté le lot. */
await fetch(`${BASE}/api/analyses/${analysisId}/coloris`, {
  method: "POST",
  headers: { "Content-Type": "application/json", cookie, Origin: BASE },
  body: JSON.stringify({ selected: [target.variantValueId] }),
});
const zip = await fetch(`${BASE}/api/analyses/${analysisId}/export`, { headers: { cookie } });
const buffer = Buffer.from(await zip.arrayBuffer());
console.log(`export (coloris ${target.variantValueId}) : ${(buffer.length / 1024 / 1024).toFixed(1)} Mo`);

await pool.end();
