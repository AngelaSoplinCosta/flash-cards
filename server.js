const path = require('path');
const express = require('express');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const insertTag = db.prepare('INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING');
const findTag = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE');
const linkTag = db.prepare('INSERT INTO card_tags (card_id, tag_id) VALUES (?, ?)');

function normalizeTags(value) {
  if (value === undefined) return undefined;
  const values = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? value.split(',') : null);

  if (!values) throw new Error('Las etiquetas deben enviarse como una lista o separadas por comas.');

  const unique = new Map();
  for (const rawValue of values) {
    if (rawValue === null || rawValue === undefined) continue;
    const name = String(rawValue).trim();
    if (!name) continue;
    if (name.length > 40) throw new Error('Cada etiqueta puede tener hasta 40 caracteres.');
    const key = name.toLocaleLowerCase('es');
    if (!unique.has(key)) unique.set(key, name);
  }

  return [...unique.values()];
}

function replaceCardTags(cardId, tagNames) {
  db.prepare('DELETE FROM card_tags WHERE card_id = ?').run(cardId);
  for (const name of tagNames) {
    insertTag.run(name);
    linkTag.run(cardId, findTag.get(name).id);
  }
}

function withTags(cards) {
  if (cards.length === 0) return cards;

  const placeholders = cards.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT ct.card_id, t.id, t.name
    FROM card_tags ct
    JOIN tags t ON t.id = ct.tag_id
    WHERE ct.card_id IN (${placeholders})
    ORDER BY t.name COLLATE NOCASE
  `).all(...cards.map((card) => card.id));

  const tagsByCard = new Map();
  for (const row of rows) {
    if (!tagsByCard.has(row.card_id)) tagsByCard.set(row.card_id, []);
    tagsByCard.get(row.card_id).push({ id: row.id, name: row.name });
  }

  return cards.map((card) => ({ ...card, tags: tagsByCard.get(card.id) || [] }));
}

// ---------- Decks ----------

app.get('/api/decks', (req, res) => {
  const decks = db.prepare(`
    SELECT d.id, d.name, d.created_at, COUNT(c.id) AS card_count
    FROM decks d
    LEFT JOIN cards c ON c.deck_id = d.id
    GROUP BY d.id
    ORDER BY d.name COLLATE NOCASE
  `).all();
  res.json(decks);
});

app.post('/api/decks', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'El nombre del mazo es obligatorio.' });
  try {
    const info = db.prepare('INSERT INTO decks (name) VALUES (?)').run(name);
    const deck = db.prepare('SELECT id, name, created_at, 0 AS card_count FROM decks WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(deck);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Ya existe un mazo con ese nombre.' });
    }
    res.status(500).json({ error: 'No se pudo crear el mazo.' });
  }
});

app.put('/api/decks/:id', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'El nombre del mazo es obligatorio.' });
  const existing = db.prepare('SELECT id FROM decks WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Mazo no encontrado.' });
  try {
    db.prepare('UPDATE decks SET name = ? WHERE id = ?').run(name, req.params.id);
    res.json(db.prepare('SELECT id, name, created_at FROM decks WHERE id = ?').get(req.params.id));
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Ya existe un mazo con ese nombre.' });
    }
    res.status(500).json({ error: 'No se pudo renombrar el mazo.' });
  }
});

app.delete('/api/decks/:id', (req, res) => {
  const id = Number(req.params.id);
  const deckCount = db.prepare('SELECT COUNT(*) AS n FROM decks').get().n;
  if (deckCount <= 1) {
    return res.status(400).json({ error: 'Debe existir al menos un mazo.' });
  }
  const existing = db.prepare('SELECT id FROM decks WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Mazo no encontrado.' });
  db.prepare('DELETE FROM decks WHERE id = ?').run(id);
  res.status(204).end();
});

// ---------- Cards ----------

app.get('/api/tags', (req, res) => {
  const tags = db.prepare(`
    SELECT t.id, t.name, COUNT(ct.card_id) AS card_count
    FROM tags t
    LEFT JOIN card_tags ct ON ct.tag_id = t.id
    GROUP BY t.id
    ORDER BY t.name COLLATE NOCASE
  `).all();
  res.json(tags);
});

app.post('/api/tags', (req, res) => {
  let tags;
  try {
    tags = normalizeTags([req.body.name]);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (tags.length !== 1) {
    return res.status(400).json({ error: 'El nombre de la etiqueta es obligatorio.' });
  }

  try {
    const info = db.prepare('INSERT INTO tags (name) VALUES (?)').run(tags[0]);
    res.status(201).json({ id: info.lastInsertRowid, name: tags[0], card_count: 0 });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Ya existe una etiqueta con ese nombre.' });
    }
    res.status(500).json({ error: 'No se pudo crear la etiqueta.' });
  }
});

app.get('/api/cards', (req, res) => {
  const { deck_id, tag_id, q } = req.query;
  let sql = 'SELECT c.* FROM cards c WHERE 1=1';
  const params = [];
  if (deck_id) {
    sql += ' AND c.deck_id = ?';
    params.push(deck_id);
  }
  if (tag_id) {
    sql += ' AND EXISTS (SELECT 1 FROM card_tags ct WHERE ct.card_id = c.id AND ct.tag_id = ?)';
    params.push(tag_id);
  }
  if (q) {
    sql += ` AND (
      c.question LIKE ? OR c.answer LIKE ? OR
      EXISTS (
        SELECT 1 FROM card_tags ct
        JOIN tags t ON t.id = ct.tag_id
        WHERE ct.card_id = c.id AND t.name LIKE ?
      )
    )`;
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  sql += ' ORDER BY c.created_at DESC';
  res.json(withTags(db.prepare(sql).all(...params)));
});

app.post('/api/cards', (req, res) => {
  const question = (req.body.question || '').trim();
  const answer = (req.body.answer || '').trim();
  let deckId = req.body.deck_id;
  let tags;

  try {
    tags = normalizeTags(req.body.tags) || [];
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (!question || !answer) {
    return res.status(400).json({ error: 'La pregunta y la respuesta son obligatorias.' });
  }
  if (!deckId) {
    deckId = db.prepare('SELECT id FROM decks ORDER BY id LIMIT 1').get().id;
  }
  const deck = db.prepare('SELECT id FROM decks WHERE id = ?').get(deckId);
  if (!deck) return res.status(400).json({ error: 'El mazo indicado no existe.' });

  const createCard = db.transaction(() => {
    const info = db.prepare('INSERT INTO cards (deck_id, question, answer) VALUES (?, ?, ?)').run(deckId, question, answer);
    replaceCardTags(info.lastInsertRowid, tags);
    return info.lastInsertRowid;
  });
  const cardId = createCard();
  res.status(201).json(withTags([db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId)])[0]);
});

app.put('/api/cards/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Tarjeta no encontrada.' });

  const question = (req.body.question ?? existing.question).trim();
  const answer = (req.body.answer ?? existing.answer).trim();
  const deckId = req.body.deck_id ?? existing.deck_id;
  let tags;

  try {
    tags = normalizeTags(req.body.tags);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (!question || !answer) {
    return res.status(400).json({ error: 'La pregunta y la respuesta son obligatorias.' });
  }
  const deck = db.prepare('SELECT id FROM decks WHERE id = ?').get(deckId);
  if (!deck) return res.status(400).json({ error: 'El mazo indicado no existe.' });

  const updateCard = db.transaction(() => {
    db.prepare(`
      UPDATE cards SET question = ?, answer = ?, deck_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(question, answer, deckId, req.params.id);
    if (tags !== undefined) replaceCardTags(existing.id, tags);
  });
  updateCard();

  res.json(withTags([db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id)])[0]);
});

app.delete('/api/cards/:id', (req, res) => {
  const existing = db.prepare('SELECT id FROM cards WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Tarjeta no encontrada.' });
  db.prepare('DELETE FROM cards WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

app.listen(PORT, () => {
  console.log(`Flash Cards corriendo en http://localhost:${PORT}`);
});
