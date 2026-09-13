const { createDatabase } = require('../db');

async function main() {
  const db = createDatabase();
  try {
    await db.initialize();
    console.log('Migraciones PostgreSQL aplicadas.');
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('No se pudieron aplicar migraciones:', error.code || error.message);
    process.exitCode = 1;
  });
}
