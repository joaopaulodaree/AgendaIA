import { createPool } from "./db.js";
import { runMigrations } from "./migrate.js";
import { AgendaStore } from "./store.js";

async function main() {
  const pool = createPool();
  const store = new AgendaStore(pool);

  try {
    await runMigrations(pool);
    const seeded = await store.seedDemoData();
    console.log(
      JSON.stringify(
        {
          adminId: seeded.admin.id,
          professionalId: seeded.professional.id,
          resourceId: seeded.resource.id,
          eventId: seeded.event.id,
        },
        null,
        2,
      ),
    );
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
