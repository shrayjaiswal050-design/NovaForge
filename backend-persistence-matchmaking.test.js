import assert from 'node:assert/strict';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import WebSocket from 'ws';
import {
  AuthStore,
  SESSION_COOKIE_NAME,
} from './auth.js';
import { createChessServer } from './server.js';

async function startServer(options = {}) {
  const app = createChessServer(options);
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const port = app.server.address().port;
  return { app, port, wsUrl: `ws://127.0.0.1:${port}` };
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
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: JSON.parse(Buffer.concat(chunks).toString()),
      }));
    });
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

function cookieFrom(response) {
  return response.headers['set-cookie']?.[0]?.split(';', 1)[0] || null;
}

async function signup(port, handle) {
  const response = await request(port, 'POST', '/api/auth/signup', {
    handle,
    displayName: handle,
    password: `${handle} backend password`,
    acceptedFairPlayTerms: true,
    acceptedPrivacyPolicy: true,
  });
  assert.equal(response.status, 201);
  return cookieFrom(response);
}

function createClient(wsUrl, port, cookie) {
  const socket = new WebSocket(wsUrl, {
    headers: { cookie },
    origin: `http://127.0.0.1:${port}`,
  });
  const messages = [];
  const waiters = [];
  const opened = once(socket, 'open');
  const closed = once(socket, 'close');

  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    messages.push(message);
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      if (messages.length - 1 < waiter.from || !waiter.predicate(message)) continue;
      waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  });
  socket.on('error', () => {});

  function waitFor(predicate, from = 0, timeoutMs = 2_000) {
    for (let index = from; index < messages.length; index += 1) {
      if (predicate(messages[index])) return Promise.resolve(messages[index]);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiterIndex = waiters.findIndex((entry) => entry.timer === timer);
        if (waiterIndex >= 0) waiters.splice(waiterIndex, 1);
        reject(new Error('Timed out waiting for WebSocket message'));
      }, timeoutMs);
      waiters.push({ predicate, from, resolve, reject, timer });
    });
  }

  async function close() {
    if (socket.readyState === WebSocket.CLOSED) return;
    if (socket.readyState === WebSocket.OPEN) socket.close();
    else socket.terminate();
    await closed.catch(() => {});
  }

  return { socket, messages, opened, close, waitFor };
}

function send(client, message) {
  client.socket.send(JSON.stringify(message));
}

async function expectError(client, code) {
  const mark = client.messages.length;
  const error = await client.waitFor((message) => message.type === 'error', mark);
  assert.equal(error.code, code);
  return error;
}

test('persists hashed credentials, sessions, friendships, and category ratings across stores', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nova-chess-auth-'));
  const dbPath = join(directory, 'auth.sqlite');
  const password = 'persistent backend password';
  const first = new AuthStore({ dbPath, now: () => 10_000 });
  const alice = first.signup({
    handle: 'alice',
    displayName: 'Alice',
    password,
    acceptedFairPlayTerms: true,
    acceptedPrivacyPolicy: true,
  });
  const bob = first.signup({
    handle: 'bob',
    displayName: 'Bob',
    password: 'another backend password',
    acceptedFairPlayTerms: true,
    acceptedPrivacyPolicy: true,
  });
  const friendRequest = first.requestFriend(first.accountByHandle('alice'), 'bob');
  first.respondFriend(first.accountByHandle('bob'), friendRequest.request.requestId, true);
  first.recordGameResult('alice', 'bob', 'white', 'chess960', '1+0');
  const cookie = `${SESSION_COOKIE_NAME}=${alice.session.token}`;
  const aliceId = first.accountByHandle('alice').id;
  first.close();

  const rawDb = new DatabaseSync(dbPath);
  const storedAccount = rawDb.prepare('SELECT * FROM accounts WHERE handle = ?').get('alice');
  const storedSession = rawDb.prepare('SELECT * FROM sessions WHERE account_id = ?').get(aliceId);
  const storedFriendships = rawDb.prepare('SELECT COUNT(*) AS count FROM friendships').get().count;
  const storedRating = rawDb.prepare(`
    SELECT rating FROM ratings WHERE handle = ? AND variant = ? AND speed = ?
  `).get('alice', 'chess960', 'bullet');
  assert.ok(storedAccount);
  assert.notEqual(storedAccount.password_salt, password);
  assert.notEqual(storedAccount.password_hash, password);
  assert.equal(storedFriendships, 2);
  assert.equal(storedRating.rating, 1_220);
  assert.equal(JSON.stringify(storedAccount).includes(password), false);
  assert.equal(rawDb.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 2);
  assert.ok(storedSession);
  assert.notEqual(storedSession.token_hash, alice.session.token);
  rawDb.close();

  const second = new AuthStore({ dbPath, now: () => 10_001 });
  try {
    const restoredAlice = second.accountByHandle('alice');
    assert.ok(restoredAlice);
    assert.notEqual(restoredAlice.passwordHash, password);
    assert.equal(second.authenticateRequest({ headers: { cookie } }).handle, 'alice');
    assert.equal(second.areFriends('alice', 'bob'), true);
    assert.equal(second.getRating('alice', 'chess960', '1+0'), 1_220);
    assert.equal(second.getRating('bob', 'chess960', '1+0'), 1_180);
    assert.equal(second.friendList(restoredAlice).friends[0].handle, 'bob');
  } finally {
    second.close();
    const app = createChessServer({ auth: { dbPath } });
    await app.close();
    assert.equal(app.authStore.closed, true);
    await rm(directory, { recursive: true, force: true });
  }
});

test('quick matchmaking uses exact authenticated buckets, random colors, cancellation, and finished ratings', async () => {
  const { app, port, wsUrl } = await startServer({
    auth: { dbPath: ':memory:' },
    clockIntervalMs: 60_000,
  });
  const clients = [];
  try {
    const aliceCookie = await signup(port, 'alice');
    const bobCookie = await signup(port, 'bob');
    const carolCookie = await signup(port, 'carol');
    const daveCookie = await signup(port, 'dave');
    const alice = createClient(wsUrl, port, aliceCookie);
    const bob = createClient(wsUrl, port, bobCookie);
    const carol = createClient(wsUrl, port, carolCookie);
    const dave = createClient(wsUrl, port, daveCookie);
    clients.push(alice, bob, carol, dave);
    await Promise.all(clients.map((client) => client.opened));

    send(alice, { type: 'quickMatch', variant: 'standard', timeControl: '5+3', color: 'white' });
    const queued = await alice.waitFor((message) => message.type === 'quickMatchQueued');
    assert.equal(queued.variant, 'standard');
    assert.equal(queued.timeControl, '5+3');

    const aliceFoundMark = alice.messages.length;
    const bobFoundMark = bob.messages.length;
    send(bob, { type: 'quickMatch', variant: 'standard', timeControl: '5+3' });
    const [aliceFound, bobFound] = await Promise.all([
      alice.waitFor((message) => message.type === 'quickMatchFound', aliceFoundMark),
      bob.waitFor((message) => message.type === 'quickMatchFound', bobFoundMark),
    ]);
    assert.equal(aliceFound.gameId, bobFound.gameId);
    assert.equal(aliceFound.variant, 'standard');
    assert.equal(aliceFound.timeControl, '5+3');
    assert.equal(aliceFound.color, 'white');
    assert.equal(bobFound.color, 'black');
    assert.notEqual(aliceFound.color, bobFound.color);

    const [aliceState, bobState] = await Promise.all([
      alice.waitFor((message) => message.type === 'state' && message.gameId === aliceFound.gameId),
      bob.waitFor((message) => message.type === 'state' && message.gameId === bobFound.gameId),
    ]);
    assert.equal(aliceState.gameId, bobState.gameId);
    assert.equal(aliceState.players.length, 2);
    assert.equal(Object.hasOwn(aliceState.players[0], 'rating'), false);
    assert.equal(Object.hasOwn(aliceState.players[1], 'rating'), false);
    assert.equal(JSON.stringify(aliceState).includes('rating'), false);

    const finishMark = alice.messages.length;
    send(alice, { type: 'friendResign' });
    const finished = await alice.waitFor(
      (message) => message.type === 'state' && message.gameId === aliceFound.gameId && message.phase === 'resigned',
      finishMark,
    );
    assert.ok(finished.result.ratings);
    assert.equal(typeof finished.result.ratings.white.after, 'number');
    assert.equal(typeof finished.result.ratings.black.after, 'number');

    send(carol, { type: 'quickMatch', variant: 'standard', timeControl: '5+3' });
    await carol.waitFor((message) => message.type === 'quickMatchQueued');
    send(dave, { type: 'quickMatch', variant: 'standard', timeControl: '3+2' });
    await dave.waitFor((message) => message.type === 'quickMatchQueued');
    send(dave, {
      type: 'quickMatch',
      variant: 'standard',
      timeControl: { initialMs: 300_000, incrementMs: 3_000 },
    });
    await expectError(dave, 'INVALID_TIME_CONTROL');
    send(dave, { type: 'quickCancel' });
    const daveCancelled = await dave.waitFor((message) => message.type === 'quickMatchCancelled');
    assert.equal(daveCancelled.timeControl, '3+2');
    send(carol, { type: 'cancelQuickMatch' });
    await carol.waitFor((message) => message.type === 'quickMatchCancelled');

    send(carol, { type: 'quickMatch', variant: 'standard', timeControl: '5+3' });
    await carol.waitFor((message) => message.type === 'quickMatchQueued');
    send(dave, { type: 'quickMatch', variant: 'chess960', timeControl: '5+3' });
    await dave.waitFor((message) => message.type === 'quickMatchQueued');
    assert.equal(carol.messages.some((message) => message.type === 'quickMatchFound'), false);
    assert.equal(dave.messages.some((message) => message.type === 'quickMatchFound'), false);
    send(carol, { type: 'cancelQuickMatch' });
    send(dave, { type: 'cancelQuickMatch' });
    await Promise.all([
      carol.waitFor((message) => message.type === 'quickMatchCancelled'),
      dave.waitFor((message) => message.type === 'quickMatchCancelled'),
    ]);

    const carolFoundMark = carol.messages.length;
    const daveFoundMark = dave.messages.length;
    send(carol, { type: 'quickMatch', variant: 'chess960', timeControl: '5+3' });
    await carol.waitFor((message) => message.type === 'quickMatchQueued');
    send(dave, { type: 'quickMatch', variant: 'chess960', timeControl: '5+3' });
    const [carolFound, daveFound] = await Promise.all([
      carol.waitFor((message) => message.type === 'quickMatchFound', carolFoundMark),
      dave.waitFor((message) => message.type === 'quickMatchFound', daveFoundMark),
    ]);
    assert.equal(carolFound.variant, 'chess960');
    assert.equal(carolFound.gameId, daveFound.gameId);
    assert.equal(Number.isSafeInteger(carolFound.chess960Seed), true);
    assert.equal(carolFound.timeControl, '5+3');
    const chess960State = await carol.waitFor(
      (message) => message.type === 'state' && message.gameId === carolFound.gameId,
    );
    assert.equal(chess960State.variant, 'chess960');
    assert.equal(Number.isSafeInteger(chess960State.chess960Seed), true);
    send(carol, { type: 'friendResign' });
    await carol.waitFor(
      (message) => message.type === 'state' && message.gameId === carolFound.gameId && message.phase === 'resigned',
    );
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    await app.close();
  }
});
