const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ quiet: true });

const SCHEMA_LOCK = 741205;
const DECK_LOCK = 741206;

function createDatabase(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error('Falta DATABASE_URL. Configura PostgreSQL en .env (consulta .env.example).');
  }
  const pool = new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
  });
  pool.on('error', (error) => {
    console.error('Error de conexión PostgreSQL:', error.code || 'CONNECTION_ERROR');
  });

  async function transaction(callback) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function initialize({ seed = true } = {}) {
    await transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock($1)', [SCHEMA_LOCK]);
      await client.query('CREATE SCHEMA IF NOT EXISTS flashcards');
      await client.query(`CREATE TABLE IF NOT EXISTS flashcards.schema_migrations (
        name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      const directory = path.join(__dirname, 'migrations');
      const files = fs.readdirSync(directory).filter((file) => /^\d+.*\.sql$/.test(file)).sort();
      for (const name of files) {
        const applied = await client.query('SELECT 1 FROM flashcards.schema_migrations WHERE name = $1', [name]);
        if (applied.rowCount) continue;
        await client.query(fs.readFileSync(path.join(directory, name), 'utf8'));
        await client.query('INSERT INTO flashcards.schema_migrations (name) VALUES ($1)', [name]);
      }
      if (seed) {
        await client.query('SELECT pg_advisory_xact_lock($1)', [DECK_LOCK]);
        await client.query(`INSERT INTO flashcards.decks (name)
          SELECT 'General' WHERE NOT EXISTS (SELECT 1 FROM flashcards.decks)`);
      }
    });
  }

  return {
    query: (text, values) => pool.query(text, values),
    transaction,
    initialize,
    end: () => pool.end(),
  };
}

module.exports = { createDatabase, DECK_LOCK };
