/**
 * Applique les migrations SQL de `drizzle/` sur Neon.
 * Volontairement sans ORM ni CLI : un simple script Node, exécutable partout.
 *
 *   node --env-file=.env.local scripts/migrate.mjs
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { Pool } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL manquante.");
  process.exit(1);
}

const dir = "drizzle";
const pool = new Pool({ connectionString: url, max: 1 });
const client = await pool.connect();

try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set(
    (await client.query("SELECT name FROM _migrations")).rows.map((r) => r.name),
  );

  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  let count = 0;

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`· ${file} — déjà appliquée`);
      continue;
    }
    const sql = await readFile(join(dir, file), "utf8");
    process.stdout.write(`→ ${file} … `);
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO _migrations(name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      count += 1;
      console.log("OK");
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("ÉCHEC");
      throw error;
    }
  }

  const tables = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' ORDER BY table_name`,
  );
  console.log(`\n${count} migration(s) appliquée(s).`);
  console.log(`Tables (${tables.rowCount}) : ${tables.rows.map((r) => r.table_name).join(", ")}`);
} finally {
  client.release();
  await pool.end();
}
