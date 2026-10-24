/** Vérifie la libération d'une analyse abandonnée, de bout en bout. */
import { readFile } from "node:fs/promises";
import { Pool } from "@neondatabase/serverless";

const env = await readFile(".env.local", "utf8");
const dbUrl = /^DATABASE_URL="?([^"\r\n]+)"?/m.exec(env)?.[1];
const secret = ((await readFile(".env.local", "utf8")).match(/^CRON_SECRET="?([^"\r\n]+)"?/m) ?? [])[1];
const pool = new Pool({ connectionString: dbUrl, max: 1 });

/* On prend l'analyse bloquée et on la vieillit de 40 minutes. */
const { rows } = await pool.query(
  `SELECT id, user_id, reserved_xof FROM analyses
   WHERE status IN ('ocr','appariement') AND reserved_xof > 0
   ORDER BY created_at DESC LIMIT 1`,
);

if (rows.length === 0) {
  console.log("aucune analyse bloquée à libérer");
  await pool.end();
  process.exit(0);
}

const target = rows[0];
await pool.query("UPDATE analyses SET created_at = now() - interval '40 minutes' WHERE id = $1", [target.id]);

const before = await pool.query(
  `SELECT coalesce(sum(amount_xof),0)::int AS solde FROM wallet_transactions WHERE user_id = $1`,
  [target.user_id],
);
console.log(`analyse ${target.id.slice(0, 8)} vieillie · réservé ${target.reserved_xof} · solde avant ${before.rows[0].solde} XOF`);

/* Le cron doit la libérer. */
const res = await fetch("https://creaad.site/api/cron/reconcile", {
  headers: { authorization: `Bearer ${secret}` },
  signal: AbortSignal.timeout(120_000),
});
const body = await res.json();
console.log(`cron : HTTP ${res.status} · abandonnées trouvées ${body.abandoned?.found ?? "—"} · libérées ${body.abandoned?.released ?? "—"}`);

const after = await pool.query(
  `SELECT coalesce(sum(amount_xof),0)::int AS solde FROM wallet_transactions WHERE user_id = $1`,
  [target.user_id],
);
const state = await pool.query("SELECT status, failure_code FROM analyses WHERE id = $1", [target.id]);
console.log(`solde après : ${after.rows[0].solde} XOF (Δ ${after.rows[0].solde - before.rows[0].solde})`);
console.log(`statut : ${state.rows[0]?.status} · ${state.rows[0]?.failure_code ?? ""}`);

await pool.end();
