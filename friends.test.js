import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';
import WebSocket from 'ws';
import { createChessServer } from './server.js';
import * as chess from './chess.js';

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
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body: raw ? JSON.parse(raw) : null,
        });
      });
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
    password: 'friend protocol password',
    acceptedFairPlayTerms: true,
    acceptedPrivacyPolicy: true,
  });
  assert.equal(response.status, 201);
  return cookieFrom(response);
}

function createClient(wsUrl, port, cookie, origin = `http://127.0.0.1:${port}`) {
  const socket = new WebSocket(wsUrl, {
    headers: { cookie },
    origin,
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

async function prepareFriends(port) {
  const aliceCookie = await signup(port, 'alice', 'Alice');
  const bobCookie = await signup(port, 'bob', 'Bob');
  const carolCookie = await signup(port, 'carol', 'Carol');
  const requested = await request(port, 'POST', '/api/friends/request', { handle: 'bob' }, aliceCookie);
  assert.equal(requested.status, 201);
  const bobPending = await request(port, 'GET', '/api/friends', undefined, bobCookie);
  assert.equal(bobPending.status, 200);
  assert.equal(bobPending.body.incomingRequests.length, 1);
  const responded = await request(port, 'POST', '/api/friends/respond', {
    requestId: bobPending.body.incomingRequests[0].requestId,
    accept: true,
  }, bobCookie);
  assert.equal(responded.status, 200);
  const aliceFriends = await request(port, 'GET', '/api/friends', undefined, aliceCookie);
  assert.equal(aliceFriends.body.friends[0].handle, 'bob');
  return { aliceCookie, bobCookie, carolCookie };
}

async function expectError(client, action, code) {
  const mark = client.messages.length;
  send(client, action);
  const message = await client.waitFor((candidate) => candidate.type === 'error', mark);
  assert.equal(message.code, code);
  return message;
}

async function openFriendGame(wsUrl, port, aliceCookie, bobCookie, clients, timeControl = '5+3', variant = 'standard', color = 'white') {
  const alice = createClient(wsUrl, port, aliceCookie);
  const bob = createClient(wsUrl, port, bobCookie);
  clients.push(alice, bob);
  await Promise.all([alice.opened, bob.opened]);

  const inviteMark = bob.messages.length;
  send(alice, { type: 'friendInvite', toHandle: 'bob', variant, timeControl, color });
  const invite = await bob.waitFor((message) => message.type === 'friendInvite', inviteMark);
  const stateMark = alice.messages.length;
  send(bob, { type: 'friendInviteRespond', inviteId: invite.inviteId, accept: true });
  const [aliceState, bobState] = await Promise.all([
    alice.waitFor((message) => message.type === 'state' && message.gameId, stateMark),
    bob.waitFor((message) => message.type === 'state' && message.gameId),
  ]);
  return { alice, bob, invite, aliceState, bobState };
}

test('friend invites honor the inviter color choice', async () => {
  const { app, port, wsUrl } = await startServer();
  const clients = [];
  try {
    const { aliceCookie, bobCookie } = await prepareFriends(port);
    const game = await openFriendGame(wsUrl, port, aliceCookie, bobCookie, clients, '5+3', 'standard', 'black');
    assert.equal(game.invite.color, 'black');
    assert.equal(game.aliceState.you, 'black');
    assert.equal(game.bobState.you, 'white');
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    await app.close();
  }
});

test('friend requests require authentication and accepted friendship before direct invites', async () => {
  const { app, port, wsUrl } = await startServer();
  const clients = [];
  try {
    const aliceCookie = await signup(port, 'alice', '<Alice>');
    const bobCookie = await signup(port, 'bob', 'Bob');
    const unauthenticated = await request(port, 'GET', '/api/friends');
    assert.equal(unauthenticated.status, 401);

    const alice = createClient(wsUrl, port, aliceCookie);
    const bob = createClient(wsUrl, port, bobCookie);
    clients.push(alice, bob);
    await Promise.all([alice.opened, bob.opened]);

    await expectError(alice, {
      type: 'friendInvite',
      toHandle: 'bob',
      variant: 'standard',
      timeControl: '5+3',
    }, 'FRIEND_REQUIRED');

    const requested = await request(port, 'POST', '/api/friends/request', { handle: 'bob' }, aliceCookie);
    assert.equal(requested.status, 201);
    const notification = await bob.waitFor((message) => message.type === 'friendRequest');
    const responded = await request(port, 'POST', '/api/friends/respond', {
      requestId: notification.request.requestId,
      accept: true,
    }, bobCookie);
    assert.equal(responded.status, 200);

    const friends = await request(port, 'GET', '/api/friends', undefined, aliceCookie);
    assert.equal(friends.body.friends[0].online, true);
    assert.equal(friends.body.friends[0].displayName, 'Bob');
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    await app.close();
  }
});

test('accepted friends receive direct games with hidden active ratings and server-authoritative results', async () => {
  const { app, port, wsUrl } = await startServer({ clockIntervalMs: 10 });
  const clients = [];
  try {
    const { aliceCookie, bobCookie, carolCookie } = await prepareFriends(port);
    const alice = createClient(wsUrl, port, aliceCookie);
    const bob = createClient(wsUrl, port, bobCookie);
    const carol = createClient(wsUrl, port, carolCookie);
    clients.push(alice, bob, carol);
    await Promise.all([alice.opened, bob.opened, carol.opened]);

    const publicActionMark = alice.messages.length;
    send(alice, { type: 'create', timeControl: '1+0' });
    const publicActionError = await alice.waitFor((message) => message.type === 'error', publicActionMark);
    assert.equal(publicActionError.code, 'INVALID_MESSAGE');
    assert.equal(Object.hasOwn(publicActionError, 'room'), false);

    send(alice, {
      type: 'friendInvite',
      toHandle: 'bob',
      variant: 'standard',
      timeControl: '5+3',
    });
    const inviteSent = await alice.waitFor((message) => message.type === 'friendInviteSent');
    const invite = await bob.waitFor((message) => message.type === 'friendInvite');
    assert.equal(invite.inviteId, inviteSent.inviteId);
    assert.equal(invite.from.handle, 'alice');
    assert.equal(Object.hasOwn(invite, 'room'), false);

    await expectError(carol, {
      type: 'friendInviteRespond',
      inviteId: invite.inviteId,
      accept: true,
    }, 'INVITE_NOT_AUTHORIZED');

    const aliceStartMark = alice.messages.length;
    const bobStartMark = bob.messages.length;
    send(bob, { type: 'friendInviteRespond', inviteId: invite.inviteId, accept: true });
    const aliceState = await alice.waitFor((message) => message.type === 'state' && message.gameId, aliceStartMark);
    const bobState = await bob.waitFor((message) => message.type === 'state' && message.gameId, bobStartMark);
    assert.equal(aliceState.gameId, bobState.gameId);
    assert.equal(aliceState.you, 'white');
    assert.equal(bobState.you, 'black');
    assert.equal(aliceState.variant, 'standard');
    assert.equal(aliceState.timeControl, '5+3');
    assert.equal(Object.hasOwn(aliceState, 'room'), false);
    assert.equal(Object.hasOwn(aliceState.players[0], 'rating'), false);
    assert.equal(Object.hasOwn(aliceState.players[1], 'rating'), false);
    assert.equal(JSON.stringify(aliceState).includes('rating'), false);
    assert.equal(app.activeGameIds.get('alice').has(aliceState.gameId), true);

    const wrongTurn = await expectError(bob, { type: 'friendMove', uci: 'e7e5' }, 'MOVE_REJECTED');
    assert.match(wrongTurn.message, /not your turn/i);
    const illegal = await expectError(alice, { type: 'friendMove', uci: 'e2e5' }, 'MOVE_REJECTED');
    assert.match(illegal.message, /not legal/i);

    const moveMark = alice.messages.length;
    send(alice, { type: 'friendMove', uci: 'e2e4' });
    const moved = await alice.waitFor((message) => message.type === 'state' && message.history.length === 1, moveMark);
    assert.equal(moved.lastMove.from, 12);
    assert.equal(moved.turn, 'black');

    const finishMark = alice.messages.length;
    send(alice, { type: 'friendResign' });
    const finished = await alice.waitFor((message) => message.type === 'state' && message.phase === 'resigned', finishMark);
    assert.equal(finished.winner, 'black');
    assert.equal(finished.result.category, 'blitz');
    assert.equal(finished.result.ratingCategory, 'blitz');
    assert.equal(finished.result.variant, 'standard');
    assert.equal(finished.result.timeControl, '5+3');
    assert.deepEqual(finished.result.ratings.white, { before: 1_200, after: 1_184 });
    assert.deepEqual(finished.result.ratings.black, { before: 1_200, after: 1_216 });
    assert.equal(finished.result.ratings.category, 'blitz');
    assert.equal(finished.result.ratings.variant, 'standard');
    assert.equal(finished.result.ratings.timeControl, '5+3');
    assert.equal(app.activeGameIds.has('alice'), false);

    const rematchMark = alice.messages.length;
    send(alice, { type: 'friendRematch' });
    await alice.waitFor((message) => message.type === 'state' && message.rematchVotes.length === 1, rematchMark);
    send(bob, { type: 'friendRematch' });
    const rematched = await alice.waitFor((message) => message.type === 'state' && message.gameState === 'playing', rematchMark);
    assert.equal(rematched.result, null);
    assert.equal(rematched.variant, 'standard');
    assert.equal(rematched.timeControl, '5+3');

    const drawMark = bob.messages.length;
    send(alice, { type: 'friendDrawOffer' });
    await bob.waitFor((message) => message.type === 'state' && message.drawOffer === 'white', drawMark);
    send(bob, { type: 'friendDrawAccept' });
    const draw = await alice.waitFor((message) => message.type === 'state' && message.phase === 'draw', drawMark);
    assert.equal(draw.drawReason, 'agreement');
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    await app.close();
  }
});

test('finished friend games carry bullet, blitz, and rapid rating categories', async () => {
  const { app, port, wsUrl } = await startServer({ clockIntervalMs: 60_000 });
  const clients = [];
  try {
    const { aliceCookie, bobCookie } = await prepareFriends(port);
    const cases = [
      ['1+0', 'bullet'],
      ['5+3', 'blitz'],
      ['15+10', 'rapid'],
    ];
    const calls = [];
    const originalRecord = app.authStore.recordGameResult.bind(app.authStore);
    app.authStore.recordGameResult = (...args) => {
      calls.push(args);
      return originalRecord(...args);
    };

    for (const [timeControl, category] of cases) {
      const game = await openFriendGame(wsUrl, port, aliceCookie, bobCookie, clients, timeControl);
      assert.equal(game.aliceState.variant, 'standard');
      assert.equal(game.aliceState.timeControl, timeControl);
      assert.equal(Object.hasOwn(game.aliceState, 'ratings'), false);
      assert.equal(JSON.stringify(game.aliceState).includes('rating'), false);

      const mark = game.alice.messages.length;
      send(game.alice, { type: 'friendResign' });
      const finished = await game.alice.waitFor(
        (message) => message.type === 'state' && message.phase === 'resigned',
        mark,
      );
      assert.equal(finished.result.category, category);
      assert.equal(finished.result.ratings.category, category);
      assert.equal(finished.result.ratings.variant, 'standard');
      assert.equal(finished.result.ratings.timeControl, timeControl);
      for (const color of ['white', 'black']) {
        assert.equal(typeof finished.result.ratings[color].before, 'number');
        assert.equal(typeof finished.result.ratings[color].after, 'number');
      }
    }

    assert.equal(calls.length, cases.length);
    for (const [index, [timeControl]] of cases.entries()) {
      assert.equal(calls[index][0], 'alice');
      assert.equal(calls[index][1], 'bob');
      assert.equal(calls[index][2], 'black');
      assert.equal(calls[index][3], 'standard');
      assert.equal(calls[index][4], timeControl);
    }
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    await app.close();
  }
});

test('WebSocket upgrades require a session and same origin, and reconnect tokens authorize only their account seat', async () => {
  const { app, port, wsUrl } = await startServer();
  const clients = [];
  try {
    const { aliceCookie, bobCookie, carolCookie } = await prepareFriends(port);
    const unauthorized = await new Promise((resolve) => {
      const socket = new WebSocket(wsUrl, { origin: `http://127.0.0.1:${port}` });
      const timer = setTimeout(() => {
        socket.terminate();
        resolve(null);
      }, 1_000);
      socket.once('unexpected-response', (request, response) => {
        clearTimeout(timer);
        resolve(response.statusCode);
      });
      socket.once('error', () => {});
    });
    assert.equal(unauthorized, 401);

    const wrongOrigin = await new Promise((resolve) => {
      const socket = new WebSocket(wsUrl, {
        headers: { cookie: aliceCookie },
        origin: 'http://evil.example',
      });
      const timer = setTimeout(() => {
        socket.terminate();
        resolve(null);
      }, 1_000);
      socket.once('unexpected-response', (request, response) => {
        clearTimeout(timer);
        resolve(response.statusCode);
      });
      socket.once('error', () => {});
    });
    assert.equal(wrongOrigin, 403);

    const alice = createClient(wsUrl, port, aliceCookie);
    const bob = createClient(wsUrl, port, bobCookie);
    const carol = createClient(wsUrl, port, carolCookie);
    clients.push(alice, bob, carol);
    await Promise.all([alice.opened, bob.opened, carol.opened]);
    send(alice, { type: 'friendInvite', toHandle: 'bob', variant: 'standard', timeControl: '5+3' });
    const invite = await bob.waitFor((message) => message.type === 'friendInvite');
    send(bob, { type: 'friendInviteRespond', inviteId: invite.inviteId, accept: true });
    const initial = await bob.waitFor((message) => message.type === 'state' && message.gameId);

    await bob.close();
    const replacement = createClient(wsUrl, port, bobCookie);
    clients.push(replacement);
    await replacement.opened;
    await expectError(carol, {
      type: 'friendReconnect',
      gameId: initial.gameId,
      token: initial.token,
    }, 'INVALID_RECONNECT_TOKEN');
    const reconnectMark = replacement.messages.length;
    send(replacement, { type: 'friendReconnect', gameId: initial.gameId, token: initial.token });
    const reconnected = await replacement.waitFor((message) => message.type === 'state' && message.gameId, reconnectMark);
    assert.equal(reconnected.you, 'black');
    assert.equal(reconnected.token, initial.token);
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    await app.close();
  }
});

test('chess960 metadata is supported when available and rejected clearly otherwise', async () => {
  const { app, port, wsUrl } = await startServer();
  const clients = [];
  try {
    const { aliceCookie, bobCookie } = await prepareFriends(port);
    const alice = createClient(wsUrl, port, aliceCookie);
    const bob = createClient(wsUrl, port, bobCookie);
    clients.push(alice, bob);
    await Promise.all([alice.opened, bob.opened]);
    const mark = alice.messages.length;
    send(alice, {
      type: 'friendInvite',
      toHandle: 'bob',
      variant: 'chess960',
      chess960Seed: 42,
      timeControl: '5+3',
    });
    if (typeof chess.createChess960State !== 'function') {
      const error = await alice.waitFor((message) => message.type === 'error', mark);
      assert.equal(error.code, 'VARIANT_UNAVAILABLE');
      assert.match(error.message, /chess960/i);
    } else {
      const invite = await bob.waitFor((message) => message.type === 'friendInvite', mark);
      assert.equal(invite.variant, 'chess960');
      assert.equal(invite.chess960Seed, 42);
      send(bob, { type: 'friendInviteRespond', inviteId: invite.inviteId, accept: true });
      const state = await alice.waitFor((message) => message.type === 'state' && message.gameId, mark);
      assert.equal(state.variant, 'chess960');
      assert.equal(state.chess960Seed, 42);
    }
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    await app.close();
  }
});
