import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgresql://127.0.0.1:5432/kasdistro_unconfigured",
});
export const db = drizzle(pool, { schema });

export * from "./schema";
