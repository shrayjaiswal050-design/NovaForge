import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';
import { createChessServer } from './server.js';

async function startServer(options = {}) {
  const app = createChessServer(options);
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  return { app, port: app.server.address().port };
}

function request(port, method, path, body = undefined, cookie = undefined) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = {};
    if (payload !== null) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(payload);
    }
    if (cookie) headers.cookie = cookie;
    const req = http.request({ hostname: '127.0.0.1', port, method, path, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        let parsed = null;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch {
          parsed = raw;
        }
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body: parsed,
          raw,
        });
      });
    });
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

function cookieFrom(response) {
  const value = response.headers['set-cookie']?.[0];
  return value?.split(';', 1)[0] || null;
}

test('signup normalizes unsafe names, stores salted passwords, and authenticates with an opaque cookie', async () => {
  const { app, port } = await startServer();
  try {
    const signup = await request(port, 'POST', '/api/auth/signup', {
      handle: 'Alice_1',
      displayName: '<img src=x onerror=alert(1)> A\u202elice',
      password: 'correct horse battery staple',
      acceptedFairPlayTerms: true,
      acceptedPrivacyPolicy: true,
    });
    assert.equal(signup.status, 201);
    assert.equal(signup.body.account.handle, 'alice_1');
    assert.equal(signup.body.account.displayName.includes('<'), false);
    assert.equal(signup.body.account.displayName.includes('>'), false);
    assert.equal(signup.raw.includes('correct horse'), false);
    const cookie = cookieFrom(signup);
    assert.ok(cookie);
    assert.match(signup.headers['set-cookie'][0], /HttpOnly/);
    assert.match(signup.headers['set-cookie'][0], /SameSite=Lax/);
    assert.match(signup.headers['set-cookie'][0], /Max-Age=/);

    const stored = app.authStore.accountByHandle('alice_1');
    assert.ok(stored);
    assert.notEqual(stored.passwordSalt, 'correct horse battery staple');
    assert.notEqual(stored.passwordHash, 'correct horse battery staple');

    const me = await request(port, 'GET', '/api/me', undefined, cookie);
    assert.equal(me.status, 200);
    assert.deepEqual(me.body.account, signup.body.account);
    assert.equal(JSON.stringify(me.body).includes('password'), false);

    const wrongPassword = await request(port, 'POST', '/api/auth/login', {
      handle: 'alice_1',
      password: 'wrong password',
    });
    const unknownHandle = await request(port, 'POST', '/api/auth/login', {
      handle: 'nobody_1',
      password: 'wrong password',
    });
    assert.equal(wrongPassword.status, 401);
    assert.equal(unknownHandle.status, 401);
    assert.deepEqual(wrongPassword.body, unknownHandle.body);
    assert.equal(JSON.stringify(wrongPassword.body).includes('alice_1'), false);

    const login = await request(port, 'POST', '/api/auth/login', {
      handle: 'ALICE_1',
      password: 'correct horse battery staple',
    });
    assert.equal(login.status, 200);
    assert.ok(cookieFrom(login));
  } finally {
    await app.close();
  }
});

test('auth schema requires fair-play acceptance, rejects unknown fields, expires sessions, and logs out', async () => {
  let stamp = 1_000;
  const { app, port } = await startServer({
    auth: {
      now: () => stamp,
      sessionTtlMs: 100,
    },
  });
  try {
    const missingTerms = await request(port, 'POST', '/api/auth/signup', {
      handle: 'terms_user',
      displayName: 'Terms User',
      password: 'password 1234',
      acceptedFairPlayTerms: false,
      acceptedPrivacyPolicy: true,
    });
    assert.equal(missingTerms.status, 400);
    assert.equal(missingTerms.body.error.code, 'TERMS_REQUIRED');

    const missingPrivacy = await request(port, 'POST', '/api/auth/signup', {
      handle: 'privacy_user',
      displayName: 'Privacy User',
      password: 'password 1234',
      acceptedFairPlayTerms: true,
    });
    assert.equal(missingPrivacy.status, 400);
    assert.equal(missingPrivacy.body.error.code, 'PRIVACY_REQUIRED');

    const extraField = await request(port, 'POST', '/api/auth/signup', {
      handle: 'terms_user',
      displayName: 'Terms User',
      password: 'password 1234',
      acceptedFairPlayTerms: true,
      acceptedPrivacyPolicy: true,
      extra: 'rejected',
    });
    assert.equal(extraField.status, 400);
    assert.equal(extraField.body.error.code, 'INVALID_SCHEMA');

    const signup = await request(port, 'POST', '/api/auth/signup', {
      handle: 'terms_user',
      displayName: 'Terms User',
      password: 'password 1234',
      acceptedFairPlayTerms: true,
      acceptedPrivacyPolicy: true,
    });
    assert.equal(signup.status, 201);
    const cookie = cookieFrom(signup);
    assert.ok(cookie);

    stamp += 101;
    const expired = await request(port, 'GET', '/api/me', undefined, cookie);
    assert.equal(expired.status, 401);

    const fresh = await request(port, 'POST', '/api/auth/login', {
      handle: 'terms_user',
      password: 'password 1234',
    });
    assert.equal(fresh.status, 200);
    const freshCookie = cookieFrom(fresh);
    const loggedOut = await request(port, 'POST', '/api/auth/logout', {}, freshCookie);
    assert.equal(loggedOut.status, 200);
    assert.match(loggedOut.headers['set-cookie'][0], /Max-Age=0/);
    const afterLogout = await request(port, 'GET', '/api/me', undefined, freshCookie);
    assert.equal(afterLogout.status, 401);
  } finally {
    await app.close();
  }
});
