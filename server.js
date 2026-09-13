const path = require('path');
const express = require('express');
const { createDatabase } = require('./db');
const { createRepository, foldTag } = require('./repository');
const { createAuth } = require('./auth');

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function readId(value, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return undefined;
  if (!['number', 'string'].includes(typeof value) || !/^[1-9]\d*$/.test(String(value))) {
    throw badRequest('El identificador debe ser un entero positivo.');
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id > 2147483647) throw badRequest('El identificador está fuera de rango.');
  return id;
}

function readText(value, message) {
  if (typeof value !== 'string' || !value.trim()) throw badRequest(message);
  return value.trim();
}

function normalizeTags(value) {
  if (value === undefined) return undefined;
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : null;
  if (!values) throw badRequest('Las etiquetas deben enviarse como una lista o separadas por comas.');
  const unique = new Map();
  for (const raw of values) {
    if (raw === null || raw === undefined) continue;
    if (typeof raw !== 'string') throw badRequest('Cada etiqueta debe ser texto.');
    const name = raw.trim();
    if (!name) continue;
    if (name.length > 40) throw badRequest('Cada etiqueta puede tener hasta 40 caracteres.');
    const key = foldTag(name);
    if (!unique.has(key)) unique.set(key, name);
  }
  return [...unique.values()];
}

const asyncRoute = (handler) => (req, res, next) => Promise.resolve().then(() => handler(req, res)).catch(next);

function createApp(db, config = {}) {
  const app = express();
  const auth = createAuth(db, config);
  app.disable('x-powered-by');
  // Enable only for a known, single reverse proxy (e.g. Render).
  if ((config.trustProxy ?? process.env.TRUST_PROXY) === '1') app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    });
    if ((config.nodeEnv ?? process.env.NODE_ENV) === 'production') res.set('Strict-Transport-Security', 'max-age=31536000');
    next();
  });
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }, auth.sameOrigin);
  app.use(express.json({ limit: '100kb' }));
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/api', (req, res, next) => {
    if (['POST', 'PUT'].includes(req.method) && (!req.body || Array.isArray(req.body) || typeof req.body !== 'object')) {
      return res.status(400).json({ error: 'El cuerpo debe ser un objeto JSON.' });
    }
    next();
  });
  app.use('/api/auth', auth.router);
  app.use('/api', auth.authenticate, auth.csrf, (req, res, next) => {
    req.repo = createRepository(db, req.user.id);
    next();
  });

  app.get('/api/decks', asyncRoute(async (req, res) => res.json(await req.repo.listDecks())));
  app.post('/api/decks', asyncRoute(async (req, res) => {
    const name = readText(req.body.name, 'El nombre del mazo es obligatorio.');
    try {
      res.status(201).json(await req.repo.createDeck(name));
    } catch (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Ya existe un mazo con ese nombre.' });
      throw error;
    }
  }));
  app.put('/api/decks/:id', asyncRoute(async (req, res) => {
    const id = readId(req.params.id);
    const name = readText(req.body.name, 'El nombre del mazo es obligatorio.');
    try {
      const deck = await req.repo.updateDeck(id, name);
      if (!deck) return res.status(404).json({ error: 'Mazo no encontrado.' });
      res.json(deck);
    } catch (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Ya existe un mazo con ese nombre.' });
      throw error;
    }
  }));
  app.delete('/api/decks/:id', asyncRoute(async (req, res) => {
    const result = await req.repo.deleteDeck(readId(req.params.id));
    if (result === 'missing') return res.status(404).json({ error: 'Mazo no encontrado.' });
    if (result === 'last') return res.status(400).json({ error: 'Debe existir al menos un mazo.' });
    res.status(204).end();
  }));

  app.get('/api/tags', asyncRoute(async (req, res) => res.json(await req.repo.listTags())));
  app.post('/api/tags', asyncRoute(async (req, res) => {
    const names = normalizeTags([readText(req.body.name, 'El nombre de la etiqueta es obligatorio.')]);
    try {
      res.status(201).json(await req.repo.createTag(names[0]));
    } catch (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Ya existe una etiqueta con ese nombre.' });
      throw error;
    }
  }));

  app.get('/api/cards', asyncRoute(async (req, res) => {
    const deck_id = readId(req.query.deck_id, true);
    const tag_id = readId(req.query.tag_id, true);
    const q = req.query.q;
    if (q !== undefined && typeof q !== 'string') throw badRequest('La búsqueda debe ser texto.');
    res.json(await req.repo.listCards({ deck_id, tag_id, q }));
  }));
  app.post('/api/cards', asyncRoute(async (req, res) => {
    const card = await req.repo.createCard({
      deck_id: readId(req.body.deck_id, true),
      question: readText(req.body.question, 'La pregunta y la respuesta son obligatorias.'),
      answer: readText(req.body.answer, 'La pregunta y la respuesta son obligatorias.'),
      tags: normalizeTags(req.body.tags) || [],
    });
    if (!card) return res.status(400).json({ error: 'El mazo indicado no existe.' });
    res.status(201).json(card);
  }));
  app.put('/api/cards/:id', asyncRoute(async (req, res) => {
    const patch = { tags: normalizeTags(req.body.tags) };
    if (req.body.deck_id !== undefined && req.body.deck_id !== null) patch.deck_id = readId(req.body.deck_id);
    for (const field of ['question', 'answer']) {
      if (req.body[field] !== undefined && req.body[field] !== null) {
        patch[field] = readText(req.body[field], 'La pregunta y la respuesta son obligatorias.');
      }
    }
    const result = await req.repo.updateCard(readId(req.params.id), patch);
    if (result.status === 'missing') return res.status(404).json({ error: 'Tarjeta no encontrada.' });
    if (result.status === 'invalid-deck') return res.status(400).json({ error: 'El mazo indicado no existe.' });
    res.json(result.card);
  }));
  app.delete('/api/cards/:id', asyncRoute(async (req, res) => {
    if (!await req.repo.deleteCard(readId(req.params.id))) return res.status(404).json({ error: 'Tarjeta no encontrada.' });
    res.status(204).end();
  }));

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'El contenido excede el límite permitido.' });
    if ([400, 401, 403, 409, 429, 503].includes(error.status)) {
      if (error.status === 429) res.set('Retry-After', '900');
      if (error.status === 503) res.set('Retry-After', '5');
      return res.status(error.status).json({ error: error.message });
    }
    if (error.code === '23503') return res.status(400).json({ error: 'El mazo o la etiqueta indicada ya no existe.' });
    console.error('Error de API:', error.code || 'INTERNAL_ERROR');
    res.status(500).json({ error: 'No se pudo completar la operación.' });
  });
  app.locals.auth = auth;
  return app;
}

async function start() {
  const db = createDatabase();
  let cleanupTimer;
  try {
    const app = createApp(db);
    await db.initialize();
    const port = Number(process.env.PORT || 3000);
    const host = process.env.HOST || '127.0.0.1';
    await app.locals.auth.cleanup();
    cleanupTimer = setInterval(() => app.locals.auth.cleanup().catch((error) => console.error('Error limpiando sesiones:', error.code || 'INTERNAL_ERROR')), 15 * 60 * 1000);
    cleanupTimer.unref();
    const server = await new Promise((resolve, reject) => {
      const listener = app.listen(port, host, () => resolve(listener));
      listener.once('error', reject);
    });
    console.log(`Flash Cards corriendo en http://${host}:${port}`);
    let closing = false;
    const shutdown = () => {
      if (closing) return;
      closing = true;
      clearInterval(cleanupTimer);
      const timeout = setTimeout(() => process.exit(1), 10000);
      timeout.unref();
      server.close(async () => {
        await db.end();
        clearTimeout(timeout);
      });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    return { server, db };
  } catch (error) {
    clearInterval(cleanupTimer);
    await db.end();
    throw error;
  }
}

if (require.main === module) {
  start().catch((error) => {
    if (error.code === 'EADDRINUSE') {
      const port = process.env.PORT || 3000;
      console.error(`El puerto ${port} ya está en uso. Detén la instancia anterior de la aplicación o configura otro PORT en .env.`);
    } else {
      console.error(error.code ? `No se pudo iniciar la aplicación (${error.code}). Comprueba PostgreSQL y la configuración del servidor.` : error.message);
    }
    process.exitCode = 1;
  });
}

module.exports = { createApp, start };
