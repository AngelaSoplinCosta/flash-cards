const path = require('path');
const { createDatabase, DECK_LOCK } = require('../db');

const columns = {
  decks: ['id', 'name', 'created_at'],
  cards: ['id', 'deck_id', 'question', 'answer', 'created_at', 'updated_at'],
  tags: ['id', 'name', 'created_at'],
  card_tags: ['card_id', 'tag_id'],
};

function timestamp(value) {
  if (typeof value !== 'string') throw new Error('La base SQLite contiene una fecha inválida.');
  // SQLite datetime('now') is UTC, although its text has no timezone suffix.
  const text = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value)
    ? `${value.replace(' ', 'T')}Z` : value;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new Error('La base SQLite contiene una fecha inválida.');
  return date.toISOString();
}

function readSnapshot(filename) {
  // SQLite is a migration-only development dependency; the server never loads it.
  const SQLite = require('better-sqlite3');
  const source = new SQLite(path.resolve(filename), { readonly: true, fileMustExist: true });
  try {
    return source.transaction(() => {
      const integrity = source.pragma('quick_check');
      if (integrity.some((row) => row.quick_check !== 'ok') || source.pragma('foreign_key_check').length) {
        throw new Error('La base SQLite no supera las comprobaciones de integridad.');
      }
      const snapshot = {};
      for (const [table, fields] of Object.entries(columns)) {
        const order = table === 'card_tags' ? 'card_id, tag_id' : 'id';
        snapshot[table] = source.prepare(`SELECT ${fields.join(', ')} FROM ${table} ORDER BY ${order}`).all().map((row) => {
          for (const field of fields) {
            if (field === 'id' || field.endsWith('_id')) {
              if (!Number.isInteger(row[field]) || row[field] < 1 || row[field] >= 2147483647) {
                throw new Error('La base SQLite contiene identificadores incompatibles con PostgreSQL INTEGER.');
              }
            } else if (field.endsWith('_at')) {
              row[field] = timestamp(row[field]);
            } else if (typeof row[field] !== 'string' || row[field].includes('\0')) {
              throw new Error('La base SQLite contiene texto incompatible con PostgreSQL.');
            }
          }
          return row;
        });
      }
      if (!snapshot.decks.length) throw new Error('La base SQLite debe contener al menos un mazo.');
      return snapshot;
    })();
  } finally {
    source.close();
  }
}

async function importSnapshot(db, snapshot) {
  await db.initialize({ seed: false });
  return db.transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [DECK_LOCK]);
    await client.query(`LOCK TABLE flashcards.decks, flashcards.cards,
      flashcards.tags, flashcards.card_tags IN ACCESS EXCLUSIVE MODE`);
    if ((await client.query('SELECT 1 FROM flashcards.users LIMIT 1')).rowCount) {
      throw new Error('El destino contiene cuentas. Importa antes de registrar usuarios; no se modificará la colección existente.');
    }
    const counts = (await client.query(`SELECT
      (SELECT COUNT(*)::integer FROM flashcards.decks) AS decks,
      (SELECT COUNT(*)::integer FROM flashcards.cards) AS cards,
      (SELECT COUNT(*)::integer FROM flashcards.tags) AS tags,
      (SELECT COUNT(*)::integer FROM flashcards.card_tags) AS card_tags`)).rows[0];
    const defaultDeck = counts.decks === 1 && !counts.cards && !counts.tags && !counts.card_tags
      && (await client.query('SELECT name FROM flashcards.decks')).rows[0].name === 'General';
    if (Object.values(counts).some(Boolean) && !defaultDeck) {
      throw new Error('El destino contiene datos. Usa una base vacía; no se sobrescribirá ni repetirá la importación.');
    }
    if (defaultDeck) await client.query('DELETE FROM flashcards.decks');

    for (const [table, fields] of Object.entries(columns)) {
      const placeholders = fields.map((_, index) => `$${index + 1}`).join(', ');
      for (const row of snapshot[table]) {
        await client.query(`INSERT INTO flashcards.${table} (${fields.join(', ')}) VALUES (${placeholders})`, fields.map((field) => row[field]));
      }
      const order = table === 'card_tags' ? 'card_id, tag_id' : 'id';
      const actual = (await client.query(`SELECT ${fields.join(', ')} FROM flashcards.${table} ORDER BY ${order}`)).rows;
      for (const row of actual) {
        for (const field of fields) {
          if (field.endsWith('_at')) row[field] = row[field].toISOString();
        }
      }
      if (JSON.stringify(actual) !== JSON.stringify(snapshot[table])) {
        throw new Error(`La verificación del contenido de ${table} no coincide. Se revierte la importación.`);
      }
      if (table !== 'card_tags') {
        const nextId = snapshot[table].reduce((max, row) => Math.max(max, row.id), 0) + 1;
        // RESTART is transactional, unlike setval(); failed imports keep sequences intact.
        await client.query(`ALTER TABLE flashcards.${table} ALTER COLUMN id RESTART WITH ${nextId}`);
      }
    }
    return Object.fromEntries(Object.keys(columns).map((table) => [table, snapshot[table].length]));
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.filter((arg) => arg !== '--dry-run').length > 1 || args.some((arg) => arg.startsWith('--') && arg !== '--dry-run')) {
    throw new Error('Uso: pnpm db:import-sqlite [ruta/flashcards.db] [--dry-run]');
  }
  const filename = args.find((arg) => arg !== '--dry-run') || path.join(__dirname, '..', 'data', 'flashcards.db');
  const snapshot = readSnapshot(filename);
  if (args.includes('--dry-run')) {
    console.log('Origen SQLite validado; PostgreSQL no se ha modificado.');
    console.log(JSON.stringify(Object.fromEntries(Object.entries(snapshot).map(([table, rows]) => [table, rows.length]))));
    return;
  }
  const db = createDatabase();
  try {
    console.log('Importación completada y contenido verificado:', JSON.stringify(await importSnapshot(db, snapshot)));
    console.log('La base SQLite original se conserva sin modificaciones.');
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('No se pudo importar SQLite:', error.code || error.message);
    process.exitCode = 1;
  });
}

module.exports = { readSnapshot, importSnapshot };
