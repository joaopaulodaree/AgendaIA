import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { createPool, withTransaction } from "./db.js";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

async function listMigrationFiles(): Promise<string[]> {
  return (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

async function ensureMigrationsTable(pool: Pool) {
  await withTransaction(pool, async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  });
}

async function getAppliedMigrations(pool: Pool): Promise<Set<string>> {
  const result = await pool.query<{ filename: string }>("SELECT filename FROM schema_migrations ORDER BY filename");
  return new Set(result.rows.map((row) => row.filename));
}

export async function runMigrations(pool: Pool = createPool()) {
  await ensureMigrationsTable(pool);

  const applied = await getAppliedMigrations(pool);
  const files = await listMigrationFiles();

  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }

    const sql = await readFile(join(migrationsDir, file), "utf8");

    await withTransaction(pool, async (client) => {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
    });

    applied.add(file);
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run") || process.env.MIGRATION_DRY_RUN === "1";

  if (dryRun) {
    const files = await listMigrationFiles();
    console.log(JSON.stringify({ dryRun: true, migrations: files }, null, 2));
    return;
  }

  const pool = createPool();

  try {
    await runMigrations(pool);
    console.log("migrations applied");
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
