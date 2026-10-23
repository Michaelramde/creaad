import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";

import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * Pool Neon partagé au niveau du process. En serverless, on réutilise
 * l'instance entre invocations pour éviter d'ouvrir une connexion par requête.
 */
const globalForDb = globalThis as unknown as { __creaadPool?: Pool };

const pool =
  globalForDb.__creaadPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__creaadPool = pool;
}

export const db = drizzle(pool, { schema });
export { schema };

export type Db = typeof db;
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
