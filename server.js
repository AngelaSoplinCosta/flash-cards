const path = require('path');
const express = require('express');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

app.get('/api/cards', (req, res) => {
  const { deck_id, q } = req.query;
  let sql = 'SELECT * FROM cards WHERE 1=1';
  const params = [];
  if (deck_id) {
    sql += ' AND deck_id = ?';
    params.push(deck_id);
  }
  if (q) {
    sql += ' AND (question LIKE ? OR answer LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like);
  }
  sql += ' ORDER BY created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/cards', (req, res) => {
  const question = (req.body.question || '').trim();
  const answer = (req.body.answer || '').trim();
  let deckId = req.body.deck_id;

  if (!question || !answer) {
    return res.status(400).json({ error: 'La pregunta y la respuesta son obligatorias.' });
  }
  if (!deckId) {
    deckId = db.prepare('SELECT id FROM decks ORDER BY id LIMIT 1').get().id;
  }
  const deck = db.prepare('SELECT id FROM decks WHERE id = ?').get(deckId);
  if (!deck) return res.status(400).json({ error: 'El mazo indicado no existe.' });

  const info = db.prepare('INSERT INTO cards (deck_id, question, answer) VALUES (?, ?, ?)').run(deckId, question, answer);
  res.status(201).json(db.prepare('SELECT * FROM cards WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/cards/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Tarjeta no encontrada.' });

  const question = (req.body.question ?? existing.question).trim();
  const answer = (req.body.answer ?? existing.answer).trim();
  const deckId = req.body.deck_id ?? existing.deck_id;

  if (!question || !answer) {
    return res.status(400).json({ error: 'La pregunta y la respuesta son obligatorias.' });
  }
  const deck = db.prepare('SELECT id FROM decks WHERE id = ?').get(deckId);
  if (!deck) return res.status(400).json({ error: 'El mazo indicado no existe.' });

  db.prepare(`
    UPDATE cards SET question = ?, answer = ?, deck_id = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(question, answer, deckId, req.params.id);

  res.json(db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id));
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
