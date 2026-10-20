import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';
import WebSocket from 'ws';
import { createChessServer } from './server.js';

async function startServer(options = {}) {
  const app = createChessServer(options);
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const port = app.server.address().port;
  return {
    app,
    port,
    wsUrl: `ws://127.0.0.1:${port}`,
  };
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
        body: Buffer.concat(chunks).toString(),
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

async function signup(port, handle, displayName = handle) {
  const response = await request(port, 'POST', '/api/auth/signup', {
    handle,
    displayName,
    password: 'server integration password',
    acceptedFairPlayTerms: true,
    acceptedPrivacyPolicy: true,
  });
  assert.equal(response.status, 201);
  return cookieFrom(response);
}

async function prepareFriends(port) {
  const aliceCookie = await signup(port, 'alice', 'Alice');
  const bobCookie = await signup(port, 'bob', 'Bob');
  const carolCookie = await signup(port, 'carol', 'Carol');
  const requested = await request(port, 'POST', '/api/friends/request', { handle: 'bob' }, aliceCookie);
  assert.equal(requested.status, 201);
  const bobFriends = await request(port, 'GET', '/api/friends', undefined, bobCookie);
  const responded = await request(port, 'POST', '/api/friends/respond', {
    requestId: JSON.parse(bobFriends.body).incomingRequests[0].requestId,
    accept: true,
  }, bobCookie);
  assert.equal(responded.status, 200);
  return { aliceCookie, bobCookie, carolCookie };
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

  return { socket, messages, opened, closed, waitFor, close };
}

function send(client, message) {
  client.socket.send(JSON.stringify(message));
}

async function expectError(client, action, code) {
  const mark = client.messages.length;
  send(client, action);
  const error = await client.waitFor((message) => message.type === 'error', mark);
  assert.equal(error.code, code);
  return error;
}

async function openFriendGame(wsUrl, port, cookies, clients, timeControl) {
  const alice = createClient(wsUrl, port, cookies.aliceCookie);
  const bob = createClient(wsUrl, port, cookies.bobCookie);
  clients.push(alice, bob);
  await Promise.all([alice.opened, bob.opened]);

  const inviteMark = bob.messages.length;
  send(alice, {
    type: 'friendInvite',
    toHandle: 'bob',
    variant: 'standard',
    timeControl,
  });
  const invite = await bob.waitFor((message) => message.type === 'friendInvite', inviteMark);
  const stateMark = alice.messages.length;
  send(bob, { type: 'friendInviteRespond', inviteId: invite.inviteId, accept: true });
  const [aliceState, bobState] = await Promise.all([
    alice.waitFor((message) => message.type === 'state' && message.gameId, stateMark),
    bob.waitFor((message) => message.type === 'state' && message.gameId),
  ]);
  return { alice, bob, aliceState, bobState };
}

test('authenticated friend games reject public room messages, enforce legal moves, and settle clocks', async () => {
  let stamp = 0;
  const { app, port, wsUrl } = await startServer({ now: () => stamp, clockIntervalMs: 60_000 });
  const clients = [];
  try {
    const cookies = await prepareFriends(port);
    assert.equal(Object.hasOwn(app, 'rooms'), false);
    const carol = createClient(wsUrl, port, cookies.carolCookie);
    clients.push(carol);
    await carol.opened;

    await expectError(carol, { type: 'create', timeControl: '5+3' }, 'INVALID_MESSAGE');
    await expectError(carol, { type: 'join', room: 'PUBLIC1' }, 'INVALID_MESSAGE');

    const game = await openFriendGame(
      wsUrl,
      port,
      cookies,
      clients,
      { initialMs: 10_000, incrementMs: 500 },
    );
    assert.equal(game.aliceState.variant, 'standard');
    assert.deepEqual(game.aliceState.timeControl, { initialMs: 10_000, incrementMs: 500 });
    assert.equal(Object.hasOwn(game.aliceState, 'room'), false);
    assert.equal(Object.hasOwn(game.aliceState, 'ratings'), false);
    assert.equal(JSON.stringify(game.aliceState).includes('rating'), false);

    const wrongTurn = await expectError(game.bob, { type: 'friendMove', uci: 'e7e5' }, 'MOVE_REJECTED');
    assert.match(wrongTurn.message, /not your turn/i);
    const illegal = await expectError(game.alice, { type: 'friendMove', uci: 'e2e5' }, 'MOVE_REJECTED');
    assert.match(illegal.message, /not legal/i);

    stamp = 250;
    const moveMark = game.alice.messages.length;
    send(game.alice, { type: 'friendMove', uci: 'e2e4' });
    const moved = await game.alice.waitFor((message) => message.type === 'state' && message.history.length === 1, moveMark);
    assert.equal(moved.clocks.white, 10_250);
    assert.equal(moved.clocks.black, 10_000);
    assert.equal(moved.turn, 'black');

    await expectError(carol, { type: 'friendMove', uci: 'e2e4' }, 'GAME_REQUIRED');
    await expectError(carol, {
      type: 'friendInvite',
      toHandle: 'alice',
      variant: 'standard',
      timeControl: '5+3',
    }, 'FRIEND_REQUIRED');
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    await app.close();
  }
});

test('records a finished timeout with category metadata and before/after ratings', async () => {
  let stamp = 0;
  const { app, port, wsUrl } = await startServer({ now: () => stamp, clockIntervalMs: 5 });
  const clients = [];
  try {
    const cookies = await prepareFriends(port);
    const game = await openFriendGame(
      wsUrl,
      port,
      cookies,
      clients,
      { initialMs: 60_000, incrementMs: 0 },
    );
    stamp = 60_001;
    const finished = await game.alice.waitFor((message) => message.type === 'state' && message.phase === 'timeout');
    assert.equal(finished.winner, 'black');
    assert.equal(finished.clocks.white, 0);
    assert.equal(finished.gameState, 'finished');
    assert.equal(finished.result.category, 'bullet');
    assert.equal(finished.result.variant, 'standard');
    assert.deepEqual(finished.result.timeControl, { initialMs: 60_000, incrementMs: 0 });
    assert.deepEqual(finished.result.ratings.white, { before: 1_200, after: 1_180 });
    assert.deepEqual(finished.result.ratings.black, { before: 1_200, after: 1_220 });
    assert.deepEqual(finished.result.ratings.before, { white: 1_200, black: 1_200 });
    assert.deepEqual(finished.result.ratings.after, { white: 1_180, black: 1_220 });
    assert.equal(app.activeGameIds.has('alice'), false);
    assert.equal(app.activeGameIds.has('bob'), false);
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    await app.close();
  }
});

test('resign, draw acceptance, and rematches retain friend-game metadata', async () => {
  const { app, port, wsUrl } = await startServer({ clockIntervalMs: 60_000 });
  const clients = [];
  try {
    const cookies = await prepareFriends(port);
    const game = await openFriendGame(wsUrl, port, cookies, clients, '5+3');
    const finishMark = game.alice.messages.length;
    send(game.alice, { type: 'friendResign' });
    const resigned = await game.alice.waitFor((message) => message.type === 'state' && message.phase === 'resigned', finishMark);
    assert.equal(resigned.winner, 'black');
    assert.equal(resigned.result.category, 'blitz');

    const voteMark = game.alice.messages.length;
    send(game.alice, { type: 'friendRematch' });
    await game.alice.waitFor((message) => message.type === 'state' && message.rematchVotes.length === 1, voteMark);
    send(game.bob, { type: 'friendRematch' });
    const rematched = await game.alice.waitFor(
      (message) => message.type === 'state' && message.gameState === 'playing' && message.rematchVotes.length === 0,
      voteMark,
    );
    assert.equal(rematched.result, null);
    assert.equal(rematched.variant, 'standard');
    assert.equal(rematched.timeControl, '5+3');

    const drawMark = game.alice.messages.length;
    send(game.alice, { type: 'friendDrawOffer' });
    await game.bob.waitFor((message) => message.type === 'state' && message.drawOffer === 'white');
    send(game.bob, { type: 'friendDrawAccept' });
    const draw = await game.alice.waitFor((message) => message.type === 'state' && message.phase === 'draw', drawMark);
    assert.equal(draw.drawReason, 'agreement');
    assert.equal(draw.winner, null);
    assert.equal(draw.result.category, 'blitz');
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    await app.close();
  }
});

test('protects static files and sends security headers without exposing server sources', async () => {
  const { app, port } = await startServer();
  try {
    const root = await request(port, 'GET', '/');
    assert.equal(root.status, 200);
    assert.equal(root.headers['x-content-type-options'], 'nosniff');
    assert.equal(root.headers['referrer-policy'], 'no-referrer');

    const premoveModule = await request(port, 'GET', '/premove.js');
    assert.equal(premoveModule.status, 200);
    assert.match(premoveModule.headers['content-type'], /^text\/javascript/);

    const health = await request(port, 'GET', '/health');
    assert.equal(health.status, 200);
    assert.equal(health.headers['cache-control'], 'no-store');
    assert.equal(health.headers['x-content-type-options'], 'nosniff');

    const unauthorizedFriends = await request(port, 'GET', '/api/friends');
    assert.equal(unauthorizedFriends.status, 401);
    assert.equal(unauthorizedFriends.headers['x-content-type-options'], 'nosniff');

    const serverSource = await request(port, 'GET', '/server.js');
    const packageJson = await request(port, 'GET', '/package.json');
    const traversal = await request(port, 'GET', '/%2e%2e/server.js');
    const malformedPath = await request(port, 'GET', '/%E0%A4%A');
    assert.notEqual(serverSource.status, 200);
    assert.notEqual(packageJson.status, 200);
    assert.notEqual(traversal.status, 200);
    assert.equal(malformedPath.status, 400);
    assert.equal(serverSource.body.includes('createChessServer'), false);
  } finally {
    await app.close();
  }
});
