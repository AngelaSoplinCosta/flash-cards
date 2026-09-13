const { createDatabase, DECK_LOCK } = require('../db');

async function claimLegacy(db, username) {
  if (typeof username !== 'string' || !/^[a-z0-9_]{3,32}$/.test(username)) throw new Error('Indica el nombre de una cuenta ya registrada.');
  return db.transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [DECK_LOCK]);
    await client.query('LOCK TABLE flashcards.decks, flashcards.tags, flashcards.cards, flashcards.card_tags IN ACCESS EXCLUSIVE MODE');
    const user = (await client.query('SELECT id FROM flashcards.users WHERE username = $1 FOR UPDATE', [username])).rows[0];
    if (!user) throw new Error('La cuenta no existe. Regístrala primero en la aplicación.');
    const legacy = await client.query('SELECT id FROM flashcards.decks WHERE user_id IS NULL');
    if (!legacy.rowCount) return 0;
    // Only remove the empty initial deck when its name conflicts with legacy General.
    await client.query(`DELETE FROM flashcards.decks d WHERE d.user_id = $1 AND d.name = 'General'
      AND NOT EXISTS (SELECT 1 FROM flashcards.cards c WHERE c.deck_id = d.id)
      AND EXISTS (SELECT 1 FROM flashcards.decks old WHERE old.user_id IS NULL AND old.name = 'General')`, [user.id]);
    await client.query('UPDATE flashcards.decks SET user_id = $1 WHERE user_id IS NULL', [user.id]);
    await client.query('UPDATE flashcards.tags SET user_id = $1 WHERE user_id IS NULL', [user.id]);
    return legacy.rowCount;
  });
}

async function main() {
  if (process.argv.length !== 3) throw new Error('Uso: pnpm auth:claim-legacy nombre_usuario');
  const db = createDatabase();
  try {
    await db.initialize({ seed: false });
    const count = await claimLegacy(db, process.argv[2].trim().toLowerCase());
    console.log(`Colección anterior asignada: ${count} mazos. Recarga la aplicación.`);
  } finally { await db.end(); }
}
if (require.main === module) main().catch((error) => {
  console.error(error.code === '23505' ? 'Hay nombres de mazos o etiquetas en conflicto. Renombra los de la nueva cuenta y repite; no se ha transferido ningún dato.' : error.code || error.message);
  process.exitCode = 1;
});
module.exports = { claimLegacy };
