const { DECK_LOCK } = require('./db');

const foldTag = (value) => value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
const tagExpression = "translate(name, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')";

function createRepository(db, userId) {
  // Explicit NULL is reserved for local maintenance/tests of the legacy collection.
  // HTTP routes always pass the authenticated user ID.
  if (userId !== null && (!Number.isSafeInteger(userId) || userId < 1)) {
    throw new Error('El repositorio requiere un usuario autenticado.');
  }
  async function withTags(cards, client = db) {
    if (!cards.length) return cards;
    const { rows } = await client.query(`
      SELECT ct.card_id, t.id, t.name FROM flashcards.card_tags ct
      JOIN flashcards.tags t ON t.id = ct.tag_id
      WHERE ct.card_id = ANY($1::integer[]) AND t.user_id IS NOT DISTINCT FROM $2 ORDER BY lower(t.name), t.id
    `, [cards.map((card) => card.id), userId]);
    const tagsByCard = new Map();
    for (const { card_id, id, name } of rows) {
      if (!tagsByCard.has(card_id)) tagsByCard.set(card_id, []);
      tagsByCard.get(card_id).push({ id, name });
    }
    return cards.map((card) => ({ ...card, tags: tagsByCard.get(card.id) || [] }));
  }

  async function replaceCardTags(client, cardId, names) {
    await client.query('DELETE FROM flashcards.card_tags WHERE card_id = $1', [cardId]);
    // Stable order avoids lock inversions when concurrent cards share tags.
    for (const name of [...names].sort((a, b) => foldTag(a).localeCompare(foldTag(b)))) {
      const { rows } = await client.query(`INSERT INTO flashcards.tags AS existing (name, user_id) VALUES ($1, $2)
        ON CONFLICT (${userId === null ? tagExpression : `user_id, ${tagExpression}`}) WHERE user_id IS ${userId === null ? '' : 'NOT '}NULL DO UPDATE SET name = existing.name RETURNING id`, [name, userId]);
      await client.query('INSERT INTO flashcards.card_tags (card_id, tag_id) VALUES ($1, $2)', [cardId, rows[0].id]);
    }
  }

  return {
    async listDecks() {
      return (await db.query(`SELECT d.id, d.name, d.created_at, COUNT(c.id)::integer AS card_count
        FROM flashcards.decks d LEFT JOIN flashcards.cards c ON c.deck_id = d.id
        WHERE d.user_id IS NOT DISTINCT FROM $1 GROUP BY d.id ORDER BY lower(d.name), d.id`, [userId])).rows;
    },
    async createDeck(name) {
      return db.transaction(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock($1)', [DECK_LOCK]);
        return (await client.query(`INSERT INTO flashcards.decks (name, user_id) VALUES ($1, $2)
          RETURNING id, name, created_at, 0::integer AS card_count`, [name, userId])).rows[0];
      });
    },
    async updateDeck(id, name) {
      return (await db.query(`UPDATE flashcards.decks SET name = $1 WHERE id = $2 AND user_id IS NOT DISTINCT FROM $3
        RETURNING id, name, created_at`, [name, id, userId])).rows[0];
    },
    async deleteDeck(id) {
      return db.transaction(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock($1)', [DECK_LOCK]);
        const existing = await client.query('SELECT id FROM flashcards.decks WHERE id = $1 AND user_id IS NOT DISTINCT FROM $2', [id, userId]);
        if (!existing.rowCount) return 'missing';
        const count = await client.query('SELECT COUNT(*)::integer AS n FROM flashcards.decks WHERE user_id IS NOT DISTINCT FROM $1', [userId]);
        if (count.rows[0].n <= 1) return 'last';
        await client.query('DELETE FROM flashcards.decks WHERE id = $1 AND user_id IS NOT DISTINCT FROM $2', [id, userId]);
        return 'deleted';
      });
    },
    async listTags() {
      return (await db.query(`SELECT t.id, t.name, COUNT(ct.card_id)::integer AS card_count
        FROM flashcards.tags t LEFT JOIN flashcards.card_tags ct ON ct.tag_id = t.id
        WHERE t.user_id IS NOT DISTINCT FROM $1 GROUP BY t.id ORDER BY lower(t.name), t.id`, [userId])).rows;
    },
    async createTag(name) {
      return (await db.query(`INSERT INTO flashcards.tags (name, user_id) VALUES ($1, $2)
        RETURNING id, name, 0::integer AS card_count`, [name, userId])).rows[0];
    },
    async listCards({ deck_id, tag_id, q }) {
      let sql = 'SELECT c.* FROM flashcards.cards c JOIN flashcards.decks d ON d.id = c.deck_id WHERE d.user_id IS NOT DISTINCT FROM $1';
      const params = [userId];
      if (deck_id) {
        params.push(deck_id);
        sql += ` AND c.deck_id = $${params.length}`;
      }
      if (tag_id) {
        params.push(tag_id);
        sql += ` AND EXISTS (SELECT 1 FROM flashcards.card_tags ct WHERE ct.card_id = c.id AND ct.tag_id = $${params.length})`;
      }
      if (q) {
        params.push(`%${q}%`);
        const placeholder = `$${params.length}`;
        sql += ` AND (c.question ILIKE ${placeholder} OR c.answer ILIKE ${placeholder} OR EXISTS (
          SELECT 1 FROM flashcards.card_tags ct JOIN flashcards.tags t ON t.id = ct.tag_id
          WHERE ct.card_id = c.id AND t.name ILIKE ${placeholder}))`;
      }
      sql += ' ORDER BY c.created_at DESC, c.id DESC';
      return withTags((await db.query(sql, params)).rows);
    },
    async createCard({ deck_id, question, answer, tags }) {
      return db.transaction(async (client) => {
        let deckId = deck_id;
        if (!deckId) {
          deckId = (await client.query('SELECT id FROM flashcards.decks WHERE user_id IS NOT DISTINCT FROM $1 ORDER BY id LIMIT 1', [userId])).rows[0]?.id;
        }
        const deck = await client.query('SELECT id FROM flashcards.decks WHERE id = $1 AND user_id IS NOT DISTINCT FROM $2 FOR KEY SHARE', [deckId, userId]);
        if (!deck.rowCount) return null;
        const { rows } = await client.query(`INSERT INTO flashcards.cards (deck_id, question, answer)
          VALUES ($1, $2, $3) RETURNING *`, [deckId, question, answer]);
        await replaceCardTags(client, rows[0].id, tags);
        return (await withTags(rows, client))[0];
      });
    },
    async updateCard(id, patch) {
      return db.transaction(async (client) => {
        const existing = (await client.query('SELECT c.* FROM flashcards.cards c JOIN flashcards.decks d ON d.id = c.deck_id WHERE c.id = $1 AND d.user_id IS NOT DISTINCT FROM $2 FOR UPDATE OF c', [id, userId])).rows[0];
        if (!existing) return { status: 'missing' };
        const deckId = patch.deck_id ?? existing.deck_id;
        const deck = await client.query('SELECT id FROM flashcards.decks WHERE id = $1 AND user_id IS NOT DISTINCT FROM $2 FOR KEY SHARE', [deckId, userId]);
        if (!deck.rowCount) return { status: 'invalid-deck' };
        const { rows } = await client.query(`UPDATE flashcards.cards
          SET question = $1, answer = $2, deck_id = $3, updated_at = CURRENT_TIMESTAMP
          WHERE id = $4 RETURNING *`, [patch.question ?? existing.question, patch.answer ?? existing.answer, deckId, id]);
        if (patch.tags !== undefined) await replaceCardTags(client, id, patch.tags);
        return { status: 'updated', card: (await withTags(rows, client))[0] };
      });
    },
    async deleteCard(id) {
      return (await db.query('DELETE FROM flashcards.cards c USING flashcards.decks d WHERE c.deck_id = d.id AND c.id = $1 AND d.user_id IS NOT DISTINCT FROM $2', [id, userId])).rowCount > 0;
    },
  };
}

module.exports = { createRepository, foldTag };
