const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const { Pool } = require('pg');
const { createDatabase } = require('../db');
const { createApp } = require('../server');
const { createRepository } = require('../repository');
const { claimLegacy } = require('../scripts/claim-legacy');

test('DATABASE_URL es obligatoria', () => {
  assert.throws(() => createDatabase(''), /Falta DATABASE_URL/);
});

const testUrl = process.env.TEST_DATABASE_URL;
test('Integración con PostgreSQL real', { skip: !testUrl && 'Configura TEST_DATABASE_URL para ejecutar integración.' }, async (t) => {
  const url = new URL(testUrl);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Las pruebas solo crean bases en PostgreSQL local.');
  const name = `flashcards_test_${randomBytes(8).toString('hex')}`;
  const admin = new Pool({ connectionString: testUrl });
  let db;
  let server;
  let created = false;
  t.after(async () => {
    try {
      if (server) {
        await new Promise((resolve) => {
          server.close(resolve);
          server.closeAllConnections();
        });
      }
      if (db) await db.end();
      // Only this generated, temporary database is removed.
      assert.match(name, /^flashcards_test_[a-f0-9]{16}$/);
      if (created) await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  });
  await admin.query(`CREATE DATABASE ${name}`);
  created = true;
  url.pathname = `/${name}`;
  db = createDatabase(url.toString());
  await db.initialize();
  let userId = null;
  let repo = createRepository(db, null);
  let cookie = '';
  let csrfToken = '';
  server = createApp(db, { nodeEnv: 'test', origin: '', registrationEnabled: 'true', trustProxy: '0' }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(route, method = 'GET', body) {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: { 'Content-Type': 'application/json', Origin: base, 'X-Requested-With': 'flashcards', Cookie: cookie, 'X-CSRF-Token': csrfToken },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  }
  async function reset() {
    await db.query('TRUNCATE flashcards.card_tags, flashcards.cards, flashcards.tags, flashcards.decks RESTART IDENTITY');
    await db.initialize({ seed: false });
    await db.query("INSERT INTO flashcards.decks (name, user_id) VALUES ('General', $1)", [userId]);
  }

  await t.test('migraciones y semilla son idempotentes incluso en paralelo', async () => {
    await Promise.all(Array.from({ length: 4 }, () => db.initialize()));
    const decks = await repo.listDecks();
    assert.equal(decks.length, 1);
    assert.equal(decks[0].name, 'General');
    assert.equal(typeof decks[0].id, 'number');
    assert.equal(typeof decks[0].card_count, 'number');
    assert.equal((await db.query('SELECT * FROM flashcards.schema_migrations')).rowCount, 2);
  });

  const signup = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, 'X-Requested-With': 'flashcards' },
    body: JSON.stringify({ username: 'tester', password: 'Una frase segura para estudiar 2026!' }),
  });
  assert.equal(signup.status, 201);
  cookie = signup.headers.get('set-cookie').split(';')[0];
  const session = await signup.json();
  csrfToken = session.csrfToken;
  userId = session.user.id;
  repo = createRepository(db, userId);

  await t.test('CRUD, etiquetas sin duplicados, filtros y contrato del frontend', async () => {
    await reset();
    const deck = await request('/api/decks', 'POST', { name: 'AWS' });
    assert.equal(deck.status, 201);
    assert.equal((await request('/api/decks', 'POST', { name: 'AWS' })).status, 409);
    assert.equal((await request(`/api/decks/${deck.body.id}`, 'PUT', { name: 'Nube' })).status, 200);
    const tag = await request('/api/tags', 'POST', { name: 'Cloud' });
    assert.equal(tag.status, 201);
    assert.equal((await request('/api/tags', 'POST', { name: 'CLOUD' })).status, 409);
    const card = await request('/api/cards', 'POST', {
      deck_id: deck.body.id, question: '**Pregunta:** ¿Qué es EC2?', answer: 'Una máquina virtual.',
      tags: ['cloud', 'CLOUD', 'Compute'],
    });
    assert.equal(card.status, 201);
    assert.equal(typeof card.body.id, 'number');
    assert.equal(card.body.tags.length, 2);
    assert.equal(card.body.tags.find((item) => item.id === tag.body.id).name, 'Cloud');
    assert.ok(!Number.isNaN(Date.parse(card.body.created_at)));
    const filtered = await request(`/api/cards?deck_id=${deck.body.id}&tag_id=${tag.body.id}&q=ec2`);
    assert.equal(filtered.body.length, 1);
    assert.equal((await request('/api/cards?q=CLOUD')).body.length, 1);
    assert.equal((await request('/api/cards?q=ausente')).body.length, 0);
    const updated = await request(`/api/cards/${card.body.id}`, 'PUT', { answer: '# Nueva respuesta' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.question, card.body.question);
    assert.equal(updated.body.tags.length, 2);
    assert.equal((await request(`/api/cards/${card.body.id}`, 'PUT', { tags: [] })).body.tags.length, 0);
    assert.equal((await request('/api/tags')).body.find((item) => item.id === tag.body.id).card_count, 0);
    assert.equal((await request(`/api/cards/${card.body.id}`, 'DELETE')).status, 204);
    assert.equal((await request(`/api/cards/${card.body.id}`, 'DELETE')).status, 404);
    assert.equal((await request('/api/cards', 'POST', { question: 'Sin mazo explícito', answer: 'General' })).status, 201);
  });

  await t.test('entradas inválidas y recursos inexistentes tienen errores controlados', async () => {
    assert.equal((await request('/api/decks', 'POST', { name: 42 })).status, 400);
    assert.equal((await request('/api/cards', 'POST', { question: {}, answer: 'ok' })).status, 400);
    assert.equal((await request('/api/cards', 'POST', { question: 'ok', answer: 'ok', deck_id: 999999 })).status, 400);
    assert.equal((await request('/api/cards?deck_id=abc')).status, 400);
    assert.equal((await request('/api/cards?tag_id=0')).status, 400);
    assert.equal((await request('/api/cards?q=a&q=b')).status, 400);
    assert.equal((await request('/api/cards/2147483648', 'DELETE')).status, 400);
    assert.equal((await request('/api/cards/999999', 'PUT', { answer: 'ok' })).status, 404);
    assert.equal((await request('/api/decks/999999', 'DELETE')).status, 404);
    assert.equal((await request('/api/tags', 'POST', { name: 'x'.repeat(41) })).status, 400);
    assert.equal((await request('/api/cards', 'POST', { question: 'ok', answer: 'ok', tags: [42] })).status, 400);
    const invalid = await fetch(`${base}/api/decks`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, 'X-Requested-With': 'flashcards', Cookie: cookie, 'X-CSRF-Token': csrfToken }, body: '{' });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { error: 'JSON inválido.' });
  });

  await t.test('un fallo en etiquetas revierte la tarjeta y sus asociaciones', async () => {
    await reset();
    const card = await repo.createCard({ question: 'Original', answer: 'Original', tags: ['original'] });
    await assert.rejects(repo.updateCard(card.id, { question: 'Modificada', tags: ['a-valid', 'z\0invalid'] }));
    const cards = await repo.listCards({});
    assert.equal(cards[0].question, 'Original');
    assert.equal(cards[0].tags[0].name, 'original');
    assert.equal((await repo.listTags()).length, 1);
    await assert.rejects(repo.createCard({ question: 'Fallo', answer: 'Fallo', tags: ['z\0invalid'] }));
    assert.equal((await repo.listCards({})).length, 1);
  });

  await t.test('creaciones concurrentes reutilizan etiquetas y no pierden tarjetas', async () => {
    await reset();
    const responses = await Promise.all(Array.from({ length: 6 }, (_, i) => request('/api/cards', 'POST', {
      question: `Pregunta ${i}`, answer: 'Respuesta', tags: i % 2 ? ['SHARED', 'Second'] : ['Second', 'shared'],
    })));
    assert.ok(responses.every((response) => response.status === 201));
    assert.equal((await repo.listCards({})).length, 6);
    const tags = await repo.listTags();
    assert.equal(tags.length, 2);
    assert.ok(tags.every((tag) => tag.card_count === 6));
  });

  await t.test('borrado en cascada y protección del último mazo bajo concurrencia', async () => {
    await reset();
    const deck = await repo.createDeck('Temporal');
    await repo.createCard({ deck_id: deck.id, question: 'Temporal', answer: 'Temporal', tags: ['Temporal'] });
    const original = (await repo.listDecks()).find((item) => item.name === 'General');
    const results = await Promise.all([repo.deleteDeck(deck.id), repo.deleteDeck(original.id)]);
    assert.deepEqual([...results].sort(), ['deleted', 'last']);
    assert.equal((await repo.listDecks()).length, 1);
    // Ensure the deck containing a card is deleted while another deck remains.
    await repo.createDeck('Otra');
    if ((await repo.listDecks()).some((item) => item.id === deck.id)) await repo.deleteDeck(deck.id);
    assert.equal((await repo.listCards({})).length, 0);
    assert.equal((await db.query('SELECT * FROM flashcards.card_tags')).rowCount, 0);
  });

  async function securityRequest(route, method = 'GET', body, headers = {}) {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: { 'Content-Type': 'application/json', Origin: base, 'X-Requested-With': 'flashcards', Cookie: cookie, 'X-CSRF-Token': csrfToken, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: response.status === 204 ? null : await response.json(), cookie: response.headers.get('set-cookie') };
  }
  await t.test('sesiones falsas, falta de sesión, CSRF y origen extranjero son rechazados', async () => {
    for (const route of ['/api/decks', '/api/tags', '/api/cards', '/api/auth/me']) {
      assert.equal((await securityRequest(route, 'GET', undefined, { Cookie: '' })).status, 401);
      assert.equal((await securityRequest(route, 'GET', undefined, { Cookie: `flashcards_session=${'a'.repeat(64)}` })).status, 401);
    }
    assert.equal((await securityRequest('/api/decks', 'POST', { name: 'Ataque' }, { 'X-CSRF-Token': '' })).status, 403);
    assert.equal((await securityRequest('/api/decks', 'POST', { name: 'Ataque' }, { 'X-CSRF-Token': 'é'.repeat(64) })).status, 403);
    assert.equal((await securityRequest('/api/decks', 'POST', { name: 'Ataque' }, { Origin: 'https://attacker.example' })).status, 403);
    assert.equal((await securityRequest('/api/auth/login', 'POST', { username: 'tester', password: 'Una frase segura para estudiar 2026!' }, { Origin: 'https://attacker.example' })).status, 403);
    assert.equal((await securityRequest('/api/auth/register', 'POST', { username: 'intruder', password: 'Una frase segura para estudiar 2026!' }, { 'X-Requested-With': '' })).status, 403);
    assert.equal((await securityRequest('/api/auth/logout', 'POST', {}, { 'X-CSRF-Token': '' })).status, 403);
    const raw = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } });
    assert.equal(raw.headers.get('cache-control'), 'no-store');
    assert.equal(raw.headers.get('x-frame-options'), 'DENY');
    assert.match(raw.headers.get('content-security-policy'), /script-src 'self'/);
  });
  await t.test('registro, contraseña protegida, aislamiento de cuentas y colección anterior', async () => {
    await reset();
    const card = await repo.createCard({ question: 'Privada', answer: 'Respuesta', tags: ['privada'] });
    const deck = (await repo.listDecks())[0];
    const second = await securityRequest('/api/auth/register', 'POST', { username: 'second_user', password: 'Otra frase segura de más de 15 caracteres' }, { Cookie: '' });
    assert.equal(second.status, 201);
    assert.match(second.cookie, /HttpOnly/i);
    assert.match(second.cookie, /SameSite=Strict/i);
    const secondHeaders = { Cookie: second.cookie.split(';')[0], 'X-CSRF-Token': second.body.csrfToken };
    assert.deepEqual((await securityRequest('/api/cards', 'GET', undefined, secondHeaders)).body, []);
    assert.deepEqual((await securityRequest('/api/tags', 'GET', undefined, secondHeaders)).body, []);
    assert.deepEqual((await securityRequest(`/api/cards?deck_id=${deck.id}`, 'GET', undefined, secondHeaders)).body, []);
    assert.equal((await securityRequest(`/api/cards/${card.id}`, 'PUT', { answer: 'Robada' }, secondHeaders)).status, 404);
    assert.equal((await securityRequest(`/api/cards/${card.id}`, 'DELETE', undefined, secondHeaders)).status, 404);
    assert.equal((await securityRequest(`/api/decks/${deck.id}`, 'PUT', { name: 'Robado' }, secondHeaders)).status, 404);
    assert.equal((await securityRequest(`/api/decks/${deck.id}`, 'DELETE', undefined, secondHeaders)).status, 404);
    assert.equal((await securityRequest('/api/cards', 'POST', { question: 'Robada', answer: 'Robada', deck_id: deck.id }, secondHeaders)).status, 400);
    const secondCard = await securityRequest('/api/cards', 'POST', { question: 'Propia', answer: 'Propia', tags: ['privada'] }, secondHeaders);
    assert.equal(secondCard.status, 201);
    assert.notEqual(secondCard.body.tags[0].id, card.tags[0].id);
    assert.equal((await securityRequest(`/api/cards/${secondCard.body.id}`, 'PUT', { deck_id: deck.id }, secondHeaders)).status, 400);
    const stored = (await db.query('SELECT password_hash FROM flashcards.users WHERE id = $1', [second.body.user.id])).rows[0].password_hash;
    assert.match(stored, /^scrypt\$131072\$8\$1\$/);
    assert.ok(!stored.includes('Otra frase'));
    assert.ok(!('password_hash' in second.body.user));
    const token = secondHeaders.Cookie.split('=')[1];
    assert.equal((await db.query('SELECT 1 FROM flashcards.sessions WHERE token_hash = $1', [token])).rowCount, 0);
    await db.query("INSERT INTO flashcards.decks (name) VALUES ('Anterior')");
    await db.query("INSERT INTO flashcards.cards (deck_id, question, answer) SELECT id, 'Anterior', 'Anterior' FROM flashcards.decks WHERE user_id IS NULL");
    assert.equal((await repo.listCards({})).length, 1);
    await assert.rejects(claimLegacy(db, 'missing_user'), /no existe/);
    assert.equal(await claimLegacy(db, 'tester'), 1);
    assert.equal(await claimLegacy(db, 'tester'), 0);
    assert.equal((await repo.listCards({})).length, 2);
    assert.equal((await securityRequest('/api/cards', 'GET', undefined, secondHeaders)).body.length, 1);
  });
  await t.test('login rota la sesión; logout y expiración revocan acceso', async () => {
    const originalCookie = cookie;
    const login = await securityRequest('/api/auth/login', 'POST', { username: 'TESTER', password: 'Una frase segura para estudiar 2026!' });
    assert.equal(login.status, 200);
    cookie = login.cookie.split(';')[0];
    csrfToken = login.body.csrfToken;
    assert.notEqual(cookie, originalCookie);
    assert.equal((await securityRequest('/api/auth/me', 'GET', undefined, { Cookie: originalCookie })).status, 401);
    assert.equal((await securityRequest('/api/auth/me')).status, 200);
    assert.equal((await securityRequest('/api/auth/logout', 'POST', {})).status, 204);
    assert.equal((await securityRequest('/api/cards')).status, 401);
    const again = await securityRequest('/api/auth/login', 'POST', { username: 'tester', password: 'Una frase segura para estudiar 2026!' });
    cookie = again.cookie.split(';')[0];
    csrfToken = again.body.csrfToken;
    await db.query('UPDATE flashcards.sessions SET expires_at = CURRENT_TIMESTAMP - INTERVAL \'1 second\' WHERE user_id = $1', [userId]);
    assert.equal((await securityRequest('/api/auth/me')).status, 401);
  });
  await t.test('producción usa cookies Secure y permite deshabilitar registros', async () => {
    const productionServer = createApp(db, { nodeEnv: 'production', origin: 'https://flashcards.example', registrationEnabled: 'false' }).listen(0, '127.0.0.1');
    await once(productionServer, 'listening');
    const origin = `http://127.0.0.1:${productionServer.address().port}`;
    const headers = { 'Content-Type': 'application/json', Origin: 'https://flashcards.example', 'X-Requested-With': 'flashcards' };
    try {
      const disabled = await fetch(`${origin}/api/auth/register`, { method: 'POST', headers, body: JSON.stringify({ username: 'new_user', password: 'Una frase para estudiar segura' }) });
      assert.equal(disabled.status, 403);
      const login = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers, body: JSON.stringify({ username: 'tester', password: 'Una frase segura para estudiar 2026!' }) });
      assert.equal(login.status, 200);
      assert.match(login.headers.get('set-cookie'), /^__Host-flashcards_session=/);
      assert.match(login.headers.get('set-cookie'), /; Secure;/);
      assert.match(login.headers.get('strict-transport-security'), /max-age=31536000/);
    } finally { await new Promise((resolve) => { productionServer.close(resolve); productionServer.closeAllConnections(); }); }
  });
  await t.test('credenciales inválidas y fuerza bruta con límites persistentes', async () => {
    assert.equal((await securityRequest('/api/auth/register', 'POST', { username: 'weak_user', password: 'corta' })).status, 400);
    const wrong = await securityRequest('/api/auth/login', 'POST', { username: 'tester', password: 'incorrecta' });
    const unknown = await securityRequest('/api/auth/login', 'POST', { username: 'unknown_user', password: 'incorrecta' });
    assert.equal(wrong.status, 401);
    assert.deepEqual(wrong.body, unknown.body);
    const duplicate = await securityRequest('/api/auth/register', 'POST', { username: 'tester', password: 'Una frase segura para estudiar 2026!' });
    assert.equal(duplicate.status, 409);
    await db.query('DELETE FROM flashcards.auth_limits');
    for (let i = 0; i < 10; i++) assert.equal((await securityRequest('/api/auth/login', 'POST', { username: 'unknown_user', password: 'incorrecta' })).status, 401);
    assert.equal((await securityRequest('/api/auth/login', 'POST', { username: 'unknown_user', password: 'incorrecta' })).status, 429);
    const anotherServer = createApp(db, { nodeEnv: 'test', registrationEnabled: 'true', origin: base }).listen(0, '127.0.0.1');
    await once(anotherServer, 'listening');
    try {
      const limited = await fetch(`http://127.0.0.1:${anotherServer.address().port}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, 'X-Requested-With': 'flashcards' },
        body: JSON.stringify({ username: 'unknown_user', password: 'incorrecta' }),
      });
      assert.equal(limited.status, 429);
    } finally { await new Promise((resolve) => { anotherServer.close(resolve); anotherServer.closeAllConnections(); }); }
    await db.query('UPDATE flashcards.auth_limits SET expires_at = CURRENT_TIMESTAMP - INTERVAL \'1 second\'');
    assert.equal((await securityRequest('/api/auth/login', 'POST', { username: 'unknown_user', password: 'incorrecta' })).status, 401);
  });
});
