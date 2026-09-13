const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAuth, hashPassword, verifyPassword, readCredentials } = require('../auth');
const { createRepository } = require('../repository');

test('contraseñas con sal única y verificación sin truncamiento', async () => {
  const password = 'Una frase larga con espacios y símbolos: á!';
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword(`${password} `, first), false);
  assert.equal(await verifyPassword('incorrecta', first), false);
  assert.equal(await verifyPassword(password, 'hash-malformado'), false);
});

test('validación de usuario y contraseña en servidor', () => {
  assert.deepEqual(readCredentials({ username: ' TEST_User ', password: 'Una frase para estudiar' }, true), {
    username: 'test_user', password: 'Una frase para estudiar',
  });
  for (const username of ['ab', 'x'.repeat(33), "a' OR 1=1", 'área', {}]) {
    assert.throws(() => readCredentials({ username, password: 'Una frase para estudiar' }, true));
  }
  for (const password of ['corta', 'x'.repeat(129), null, ['Una frase para estudiar']]) {
    assert.throws(() => readCredentials({ username: 'tester', password }, true));
  }
});

test('producción exige un origen HTTPS exacto', () => {
  assert.throws(() => createAuth({}, { nodeEnv: 'production', origin: '' }), /Falta APP_ORIGIN/);
  for (const origin of ['http://example.com', 'https://example.com/', 'https://example.com/path', 'https://user:pass@example.com']) {
    assert.throws(() => createAuth({}, { nodeEnv: 'production', origin }), /APP_ORIGIN/);
  }
  assert.doesNotThrow(() => createAuth({}, { nodeEnv: 'production', origin: 'https://example.com' }));
});

test('el repositorio no acepta un usuario omitido o inválido', () => {
  for (const id of [undefined, 0, -1, '1', NaN]) assert.throws(() => createRepository({}, id), /usuario autenticado/);
});
