const { randomBytes, createHash, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const { Router } = require('express');

const derive = promisify(scrypt);
const options = { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 };
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const digest = (value) => createHash('sha256').update(value).digest('hex');
const csrfFor = (token) => digest(`csrf:${token}`);
const failure = (status, message) => Object.assign(new Error(message), { status });
const route = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);
let hashing = 0;

async function passwordKey(password, salt) {
  // Bound memory consumption even when attackers use different accounts/IPs.
  if (hashing >= 2) throw failure(503, 'Hay muchos intentos. Vuelve a intentarlo en unos segundos.');
  hashing++;
  try { return await derive(password, salt, 64, options); }
  finally { hashing--; }
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$131072$8$1$${salt}$${(await passwordKey(password, salt)).toString('hex')}`;
}

// Unknown users do the same expensive derivation as known users.
const dummyHash = `scrypt$131072$8$1$${'0'.repeat(32)}$${'0'.repeat(128)}`;
async function verifyPassword(password, stored = dummyHash) {
  if (!/^scrypt\$131072\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(stored)) return false;
  const [, , , , salt, hash] = stored.split('$');
  return timingSafeEqual(await passwordKey(password, salt), Buffer.from(hash, 'hex'));
}

function readCredentials(body, registration = false) {
  const username = typeof body?.username === 'string' ? body.username.trim().toLowerCase() : '';
  const password = body?.password;
  if (!/^[a-z0-9_]{3,32}$/.test(username)) throw failure(400, 'El usuario debe tener de 3 a 32 letras, números o guiones bajos.');
  if (typeof password !== 'string' || password.length === 0 || password.length > 128 || (registration && [...password].length < 15)) {
    throw failure(400, registration ? 'La contraseña debe tener entre 15 y 128 caracteres.' : 'Credenciales inválidas.');
  }
  return { username, password };
}

function cookieToken(req, name) {
  const matches = (req.headers.cookie || '').split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(name.length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}

function createAuth(db, config = {}) {
  const production = (config.nodeEnv ?? process.env.NODE_ENV) === 'production';
  const configuredOrigin = config.origin ?? process.env.APP_ORIGIN;
  if (production && !configuredOrigin) throw new Error('Falta APP_ORIGIN (URL HTTPS pública) para habilitar autenticación en producción.');
  if (configuredOrigin) {
    const parsed = new URL(configuredOrigin);
    if (parsed.origin !== configuredOrigin || (production && parsed.protocol !== 'https:')) {
      throw new Error('APP_ORIGIN debe ser un origen exacto; en producción requiere HTTPS.');
    }
  }
  const cookieName = production ? '__Host-flashcards_session' : 'flashcards_session';
  const cookieOptions = { httpOnly: true, secure: production, sameSite: 'strict', path: '/' };
  const router = Router();
  const registrationEnabled = (config.registrationEnabled ?? process.env.AUTH_ALLOW_REGISTRATION ?? 'true') === 'true';

  function sameOrigin(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const expected = configuredOrigin || `${req.protocol}://${req.get('host')}`;
    if (req.get('origin') !== expected || req.get('x-requested-with') !== 'flashcards') {
      return res.status(403).json({ error: 'Origen de solicitud no permitido.' });
    }
    next();
  }

  async function limit(req, username, registration) {
    const buckets = [
      { key: `ip:${req.ip}`, max: 30, seconds: 900 },
      { key: `user:${username}`, max: 10, seconds: 900 },
      ...(registration ? [{ key: `register:${req.ip}`, max: 5, seconds: 3600 }] : []),
    ];
    // Atomic database counters survive restarts and work across app instances.
    for (const bucket of buckets) {
      const { rows } = await db.query(`INSERT INTO flashcards.auth_limits AS existing (key, attempts, expires_at)
        VALUES ($1, 1, CURRENT_TIMESTAMP + $2 * INTERVAL '1 second')
        ON CONFLICT (key) DO UPDATE SET
          attempts = CASE WHEN existing.expires_at <= CURRENT_TIMESTAMP THEN 1 ELSE existing.attempts + 1 END,
          expires_at = CASE WHEN existing.expires_at <= CURRENT_TIMESTAMP THEN EXCLUDED.expires_at ELSE existing.expires_at END
        RETURNING attempts, expires_at`, [digest(bucket.key), bucket.seconds]);
      if (rows[0].attempts > bucket.max) {
        throw failure(429, 'Demasiados intentos. Espera unos minutos antes de volver a intentarlo.');
      }
    }
  }

  async function issueSession(req, res, user) {
    const token = randomBytes(32).toString('hex');
    const old = cookieToken(req, cookieName);
    await db.transaction(async (client) => {
      if (old) await client.query('DELETE FROM flashcards.sessions WHERE token_hash = $1', [digest(old)]);
      await client.query('INSERT INTO flashcards.sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
        [digest(token), user.id, new Date(Date.now() + SESSION_MS)]);
    });
    res.cookie(cookieName, token, { ...cookieOptions, maxAge: SESSION_MS });
    return { user: { id: user.id, username: user.username }, csrfToken: csrfFor(token) };
  }

  const authenticate = (req, res, next) => Promise.resolve().then(async () => {
    const token = cookieToken(req, cookieName);
    const user = token && (await db.query(`SELECT u.id, u.username FROM flashcards.sessions s
      JOIN flashcards.users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > CURRENT_TIMESTAMP`, [digest(token)])).rows[0];
    if (!user) return res.status(401).json({ error: 'Inicia sesión para continuar.' });
    req.user = user;
    req.sessionToken = token;
    next();
  }).catch(next);
  const csrf = (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const supplied = req.get('x-csrf-token') || '';
      const expected = csrfFor(req.sessionToken);
      if (!/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
        return res.status(403).json({ error: 'Sesión de formulario inválida. Recarga la página.' });
      }
    }
    next();
  };

  router.post('/register', route(async (req, res) => {
    if (!registrationEnabled) throw failure(403, 'El registro de nuevas cuentas está deshabilitado.');
    const { username, password } = readCredentials(req.body, true);
    await limit(req, username, true);
    const passwordHash = await hashPassword(password);
    let user;
    try {
      user = await db.transaction(async (client) => {
        const result = (await client.query('INSERT INTO flashcards.users (username, password_hash) VALUES ($1, $2) RETURNING id, username', [username, passwordHash])).rows[0];
        await client.query("INSERT INTO flashcards.decks (name, user_id) VALUES ('General', $1)", [result.id]);
        return result;
      });
    } catch (error) {
      if (error.code === '23505') throw failure(409, 'No se pudo registrar ese usuario. Prueba otro nombre.');
      throw error;
    }
    res.status(201).json(await issueSession(req, res, user));
  }));
  router.post('/login', route(async (req, res) => {
    const { username, password } = readCredentials(req.body);
    await limit(req, username, false);
    const user = (await db.query('SELECT id, username, password_hash FROM flashcards.users WHERE username = $1', [username])).rows[0];
    const valid = await verifyPassword(password, user?.password_hash);
    if (!user || !valid) throw failure(401, 'Usuario o contraseña incorrectos.');
    res.json(await issueSession(req, res, user));
  }));
  router.get('/me', authenticate, (req, res) => res.json({ user: req.user, csrfToken: csrfFor(req.sessionToken) }));
  router.post('/logout', authenticate, csrf, route(async (req, res) => {
    await db.query('DELETE FROM flashcards.sessions WHERE token_hash = $1', [digest(req.sessionToken)]);
    res.clearCookie(cookieName, cookieOptions);
    res.status(204).end();
  }));

  async function cleanup() {
    await db.query('DELETE FROM flashcards.sessions WHERE expires_at <= CURRENT_TIMESTAMP');
    await db.query('DELETE FROM flashcards.auth_limits WHERE expires_at <= CURRENT_TIMESTAMP');
  }
  return { router, sameOrigin, authenticate, csrf, cleanup };
}

module.exports = { createAuth, hashPassword, verifyPassword, readCredentials };
