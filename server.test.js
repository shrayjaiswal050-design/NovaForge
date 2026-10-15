import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';
import WebSocket from 'ws';
import { createChessServer } from './server.js';
import { stateFromFEN } from './chess.js';

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function startServer(options = {}) {
  const app = createChessServer(options);
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  return {
    app,
    port: app.server.address().port,
    url: `ws://127.0.0.1:${app.server.address().port}`,
  };
}

function createClient(url, options = {}) {
  const socket = new WebSocket(url, options);
  const messages = [];
  const waiters = [];
  const opened = once(socket, 'open');
  const closed = once(socket, 'close');

  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      message = { type: 'invalid-test-message' };
    }
    messages.push(message);
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      if (messages.length - 1 < waiter.from || !waiter.predicate(message)) continue;
      waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  });

  socket.on('error', () => {
    // Individual tests assert the protocol result; ws errors are expected for
    // the deliberate same-origin rejection case.
  });

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

async function createGame(url, clients, timeControl = '5+3') {
  const white = createClient(url);
  const black = createClient(url);
  clients.push(white, black);
  await Promise.all([white.opened, black.opened]);
  send(white, { type: 'create', timeControl, name: 'Alice' });
  const created = await white.waitFor((message) => message.type === 'created');
  const whiteMark = white.messages.length;
  send(black, { type: 'join', room: created.room, name: 'Bob' });
  const joined = await black.waitFor((message) => message.type === 'joined');
  const state = await white.waitFor((message) => message.type === 'state' && message.ready, whiteMark);
  await black.waitFor((message) => message.type === 'state' && message.ready);
  return { white, black, created, joined, state };
}

async function expectError(client, action, code) {
  const mark = client.messages.length;
  send(client, action);
  const error = await client.waitFor((message) => message.type === 'error', mark);
  assert.equal(error.code, code);
  return error;
}

async function playMove(client, uci, ply) {
  const mark = client.messages.length;
  send(client, { type: 'move', uci });
  return client.waitFor((message) => message.type === 'state' && message.history.length === ply, mark);
}

async function closeAll(app, clients) {
  await Promise.all(clients.map((client) => client.close()));
  await app.close();
}

async function httpGet(port, path) {
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: '127.0.0.1', port, path }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        body: Buffer.concat(chunks).toString(),
      }));
    });
    request.on('error', reject);
  });
}

test('creates isolated invite rooms, validates moves, and protects reconnect tokens', async () => {
  const { app, url } = await startServer({ clockIntervalMs: 10 });
  const clients = [];
  try {
    const white = createClient(url);
    const black = createClient(url);
    const third = createClient(url);
    clients.push(white, black, third);
    await Promise.all([white.opened, black.opened, third.opened]);

    let mark = white.messages.length;
    send(white, { type: 'create', timeControl: '1+0', name: 'Alice' });
    const created = await white.waitFor((message) => message.type === 'created', mark);
    const initialWhiteState = await white.waitFor((message) => message.type === 'state', mark);
    assert.match(created.room, /^[A-Z0-9]{4,8}$/);
    assert.equal(created.color, 'white');
    assert.equal(initialWhiteState.token, created.token);
    assert.equal(initialWhiteState.ready, false);

    mark = black.messages.length;
    send(black, { type: 'join', room: created.room, name: 'Bob' });
    const joined = await black.waitFor((message) => message.type === 'joined', mark);
    const blackState = await black.waitFor((message) => message.type === 'state' && message.ready, mark);
    const whiteState = await white.waitFor((message) => message.type === 'state' && message.ready, mark);
    assert.equal(joined.color, 'black');
    assert.equal(blackState.token, joined.token);
    assert.notEqual(joined.token, created.token);
    assert.equal(whiteState.token, created.token);
    assert.equal(JSON.stringify(blackState).includes(created.token), false, 'white token leaked to black');
    assert.equal(JSON.stringify(whiteState).includes(joined.token), false, 'black token leaked to white');

    mark = black.messages.length;
    send(black, { type: 'move', uci: 'e7e5' });
    const wrongTurn = await black.waitFor((message) => message.type === 'error', mark);
    assert.match(wrongTurn.message, /not your turn/i);

    mark = white.messages.length;
    send(white, { type: 'move', uci: 'e2e5' });
    const illegal = await white.waitFor((message) => message.type === 'error', mark);
    assert.match(illegal.message, /not legal/i);

    mark = white.messages.length;
    send(white, { type: 'move', uci: 'e2e4' });
    const moved = await white.waitFor((message) => message.type === 'state' && message.history.length === 1, mark);
    assert.equal(moved.lastMove.from, 12);
    assert.equal(moved.turn, 'black');

    mark = third.messages.length;
    send(third, { type: 'join', room: created.room });
    const full = await third.waitFor((message) => message.type === 'error', mark);
    assert.match(full.message, /full|reconnect token/i);

    mark = third.messages.length;
    send(third, { type: 'join', room: created.room, token: 'not-a-token' });
    const invalidToken = await third.waitFor((message) => message.type === 'error', mark);
    assert.equal(invalidToken.code, 'INVALID_RECONNECT_TOKEN');

    await black.close();
    const reconnect = createClient(url);
    clients.push(reconnect);
    await reconnect.opened;
    mark = reconnect.messages.length;
    send(reconnect, { type: 'join', room: created.room, token: joined.token, name: 'Bob again' });
    const rejoined = await reconnect.waitFor((message) => message.type === 'joined', mark);
    assert.equal(rejoined.color, 'black');

    mark = third.messages.length;
    send(third, { type: 'join', room: created.room, token: joined.token });
    const occupied = await third.waitFor((message) => message.type === 'error', mark);
    assert.equal(occupied.code, 'RECONNECT_TOKEN_IN_USE');

    mark = third.messages.length;
    send(third, { type: 'move', uci: 'e7e5' });
    const unauthorized = await third.waitFor((message) => message.type === 'error', mark);
    assert.equal(unauthorized.code, 'NOT_AUTHENTICATED');
  } finally {
    await closeAll(app, clients);
  }
});

test('settles monotonic clocks once, applies one increment, and records timeout', async () => {
  const { app, url } = await startServer({ clockIntervalMs: 5 });
  const clients = [];
  try {
    const white = createClient(url);
    const black = createClient(url);
    clients.push(white, black);
    await Promise.all([white.opened, black.opened]);

    let mark = white.messages.length;
    send(white, { type: 'create', timeControl: { initialMs: 10_000, incrementMs: 500 } });
    const created = await white.waitFor((message) => message.type === 'created', mark);
    mark = black.messages.length;
    send(black, { type: 'join', room: created.room });
    const ready = await white.waitFor((message) => message.type === 'state' && message.ready, mark);
    const beforeWhite = ready.clocks.white;

    mark = white.messages.length;
    send(white, { type: 'move', uci: 'e2e4' });
    const afterMove = await white.waitFor((message) => message.type === 'state' && message.history.length === 1, mark);
    assert.ok(afterMove.clocks.white > beforeWhite + 200, 'the move did not receive its increment');
    assert.ok(afterMove.clocks.white < beforeWhite + 700, 'the move received more than one increment');
    const clockMark = black.messages.length;
    await black.waitFor((message) => message.type === 'clock' && message.clocks.turn === 'black', clockMark);

    const timeoutWhite = createClient(url);
    const timeoutBlack = createClient(url);
    clients.push(timeoutWhite, timeoutBlack);
    await Promise.all([timeoutWhite.opened, timeoutBlack.opened]);
    mark = timeoutWhite.messages.length;
    send(timeoutWhite, { type: 'create', timeControl: { initialMs: 60, incrementMs: 0 } });
    const timeoutCreated = await timeoutWhite.waitFor((message) => message.type === 'created', mark);
    mark = timeoutBlack.messages.length;
    send(timeoutBlack, { type: 'join', room: timeoutCreated.room });
    const timeoutState = await timeoutWhite.waitFor((message) => message.type === 'state' && message.phase === 'timeout', mark, 2_000);
    assert.equal(timeoutState.winner, 'black');
    assert.equal(timeoutState.drawReason, null);
    assert.equal(timeoutState.clocks.white, 0);
    assert.equal(timeoutState.roomState, 'finished');
  } finally {
    await closeAll(app, clients);
  }
});

test('requires mutual rematch consent and supports draw offer acceptance', async () => {
  const { app, url } = await startServer({ clockIntervalMs: 10 });
  const clients = [];
  try {
    const white = createClient(url);
    const black = createClient(url);
    clients.push(white, black);
    await Promise.all([white.opened, black.opened]);
    let mark = white.messages.length;
    send(white, { type: 'create', timeControl: '5+3' });
    const created = await white.waitFor((message) => message.type === 'created', mark);
    mark = black.messages.length;
    const whiteReadyMark = white.messages.length;
    send(black, { type: 'join', room: created.room });
    await white.waitFor((message) => message.type === 'state' && message.ready, whiteReadyMark);

    mark = white.messages.length;
    send(white, { type: 'resign' });
    const resigned = await white.waitFor((message) => message.type === 'state' && message.phase === 'resigned', mark);
    assert.equal(resigned.winner, 'black');
    assert.equal(resigned.drawReason, null);
    assert.equal(resigned.reason, 'white resigned');
    assert.equal(resigned.roomState, 'finished');

    mark = white.messages.length;
    send(white, { type: 'rematch' });
    const oneVote = await white.waitFor((message) => message.type === 'state' && message.rematchVotes.length === 1, mark);
    assert.equal(oneVote.roomState, 'finished');
    assert.equal(oneVote.history.length, 0);

    mark = black.messages.length;
    const rematchWhiteMark = white.messages.length;
    send(black, { type: 'rematch' });
    const rematched = await white.waitFor((message) => message.type === 'state' && message.roomState === 'playing' && message.rematchVotes.length === 0, rematchWhiteMark);
    assert.equal(rematched.phase, 'playing');
    assert.equal(rematched.history.length, 0);
    assert.equal(rematched.ready, true);

    mark = white.messages.length;
    const offerBlackMark = black.messages.length;
    send(white, { type: 'drawOffer' });
    const offered = await black.waitFor((message) => message.type === 'state' && message.drawOffer === 'white', offerBlackMark);
    assert.equal(offered.drawOffer, 'white');

    mark = black.messages.length;
    const acceptWhiteMark = white.messages.length;
    send(black, { type: 'drawAccept' });
    const agreed = await white.waitFor((message) => message.type === 'state' && message.phase === 'draw', acceptWhiteMark);
    assert.equal(agreed.drawReason, 'agreement');
    assert.equal(agreed.winner, null);
  } finally {
    await closeAll(app, clients);
  }
});

test('keeps active rooms past TTL and protects the static and WebSocket origins', async () => {
  const { app, port, url } = await startServer({ roomTtlMs: 40, clockIntervalMs: 5 });
  const clients = [];
  try {
    const white = createClient(url);
    const black = createClient(url);
    clients.push(white, black);
    await Promise.all([white.opened, black.opened]);
    let mark = white.messages.length;
    send(white, { type: 'create', timeControl: '1+0' });
    const created = await white.waitFor((message) => message.type === 'created', mark);
    mark = black.messages.length;
    send(black, { type: 'join', room: created.room });
    await white.waitFor((message) => message.type === 'state' && message.ready, mark);
    await delay(100);
    assert.equal(app.rooms.has(created.room), true, 'an active game expired without a move');

    const root = await httpGet(port, '/');
    assert.equal(root.status, 200);
    const serverSource = await httpGet(port, '/server.js');
    const packageJson = await httpGet(port, '/package.json');
    const traversal = await httpGet(port, '/%2e%2e/server.js');
    const badUri = await httpGet(port, '/%E0%A4%A');
    assert.notEqual(serverSource.status, 200);
    assert.notEqual(packageJson.status, 200);
    assert.notEqual(traversal.status, 200);
    assert.equal(badUri.status, 400);
    assert.equal(serverSource.body.includes('createChessServer'), false);

    const rejected = await new Promise((resolve) => {
      const socket = new WebSocket(url, { origin: 'http://evil.example' });
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
    assert.equal(rejected, 403);
  } finally {
    await closeAll(app, clients);
  }
});

test('rejects malformed protocol messages and oversized frames', async () => {
  const { app, url } = await startServer({ maxPayloadBytes: 256, clockIntervalMs: 10 });
  const client = createClient(url);
  try {
    await client.opened;
    let mark = client.messages.length;
    client.socket.send('{not json');
    const invalidJson = await client.waitFor((message) => message.type === 'error', mark);
    assert.equal(invalidJson.code, 'INVALID_JSON');

    mark = client.messages.length;
    send(client, { type: 'create', timeControl: '__proto__' });
    const invalidControl = await client.waitFor((message) => message.type === 'error', mark);
    assert.equal(invalidControl.code, 'INVALID_TIME_CONTROL');

    const closePromise = client.closed;
    client.socket.send(JSON.stringify({ type: 'ping', padding: 'x'.repeat(1_000) }));
    const [code] = await closePromise;
    assert.equal(code, 1009);
  } finally {
    await client.close();
    await app.close();
  }
});

test('preserves a null winner when flag fall is a draw for insufficient mating material', async () => {
  let stamp = 0;
  const { app, url } = await startServer({ now: () => stamp, clockIntervalMs: 60_000 });
  const clients = [];
  try {
    const { white, black, created } = await createGame(url, clients, { initialMs: 1_000, incrementMs: 100 });
    const room = app.rooms.get(created.room);
    // White still has a rook, but the non-flagging side has only a bare king.
    room.state = stateFromFEN('4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
    stamp = 1_000;
    const blackMark = black.messages.length;
    await expectError(white, { type: 'move', uci: 'a1a2' }, 'GAME_FINISHED');
    const result = await black.waitFor((message) => message.type === 'state' && message.roomState === 'finished', blackMark);
    assert.equal(result.phase, 'draw');
    assert.equal(result.winner, null);
    assert.equal(result.result.winner, null);
    assert.equal(result.drawReason, 'timeout with insufficient mating material');
    assert.equal(result.reason, 'white ran out of time');
    assert.equal(result.clocks.white, 0);
    assert.equal(result.history.length, 0, 'a flagged move must not be applied or receive increment');
  } finally {
    await closeAll(app, clients);
  }
});

test('settles each accepted move once with a deterministic increment', async () => {
  let stamp = 0;
  const { app, url } = await startServer({ now: () => stamp, clockIntervalMs: 60_000 });
  const clients = [];
  try {
    const { white, black, state } = await createGame(url, clients, { initialMs: 10_000, incrementMs: 500 });
    assert.deepEqual(state.clocks, { white: 10_000, black: 10_000 });

    stamp = 250;
    const afterWhite = await playMove(white, 'e2e4', 1);
    assert.equal(afterWhite.clocks.white, 10_250, 'white loses 250ms and receives exactly one 500ms increment');
    assert.equal(afterWhite.clocks.black, 10_000);

    stamp = 500;
    const afterBlack = await playMove(black, 'e7e5', 2);
    assert.equal(afterBlack.clocks.white, 10_250);
    assert.equal(afterBlack.clocks.black, 10_250, 'black loses 250ms and receives exactly one 500ms increment');
  } finally {
    await closeAll(app, clients);
  }
});

test('does not leak moves or reconnect tokens across rooms', async () => {
  const { app, url } = await startServer({ now: () => 0, clockIntervalMs: 60_000 });
  const clients = [];
  try {
    const first = await createGame(url, clients);
    const second = await createGame(url, clients);
    assert.notEqual(first.created.room, second.created.room);

    const outsider = createClient(url);
    clients.push(outsider);
    await outsider.opened;
    await expectError(outsider, {
      type: 'join',
      room: second.created.room,
      token: first.created.token,
    }, 'INVALID_RECONNECT_TOKEN');

    const secondMark = second.white.messages.length;
    await playMove(first.white, 'e2e4', 1);
    await delay(20);
    assert.equal(second.white.messages.length, secondMark, 'room two did not receive room one state');
  } finally {
    await closeAll(app, clients);
  }
});

test('expires inactive waiting rooms and closes their connected sockets', async () => {
  let stamp = 0;
  const { app, url } = await startServer({ now: () => stamp, roomTtlMs: 40, clockIntervalMs: 5 });
  const clients = [];
  try {
    const client = createClient(url);
    clients.push(client);
    await client.opened;
    send(client, { type: 'create', timeControl: '1+0' });
    const created = await client.waitFor((message) => message.type === 'created');
    const closed = client.closed;
    stamp = 41;
    await delay(30);
    assert.equal(app.rooms.has(created.room), false);
    const [closeCode] = await closed;
    assert.equal(closeCode, 1000);
  } finally {
    await closeAll(app, clients);
  }
});

test('allows only the side to move to claim an available repetition draw', async () => {
  const { app, url } = await startServer({ now: () => 0, clockIntervalMs: 60_000 });
  const clients = [];
  try {
    const { white, black } = await createGame(url, clients);
    let state;
    const cycle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
    for (let ply = 0; ply < 8; ply += 1) {
      state = await playMove(ply % 2 ? black : white, cycle[ply % cycle.length], ply + 1);
    }
    assert.equal(state.phase, 'playing');
    assert.deepEqual(state.claimableDraws, ['threefold repetition']);
    await expectError(black, { type: 'claimDraw', reason: 'threefold repetition' }, 'DRAW_CLAIM_REJECTED');
    const mark = white.messages.length;
    send(white, { type: 'claimDraw', drawReason: ' THREEFOLD REPETITION ' });
    const claimed = await white.waitFor((message) => message.type === 'state' && message.phase === 'draw', mark);
    assert.equal(claimed.drawReason, 'threefold repetition');
    assert.equal(claimed.winner, null);
    assert.deepEqual(claimed.claimableDraws, []);
  } finally {
    await closeAll(app, clients);
  }
});

test('keeps a draw offer through the offering player move until the opponent responds', async () => {
  const { app, url } = await startServer({ now: () => 0, clockIntervalMs: 60_000 });
  const clients = [];
  try {
    const { white, black } = await createGame(url, clients);
    let mark = white.messages.length;
    send(white, { type: 'offerDraw' });
    await white.waitFor((message) => message.type === 'state' && message.drawOffer === 'white', mark);
    await expectError(white, { type: 'drawAccept' }, 'DRAW_OFFER_SELF_ACCEPT');
    const moved = await playMove(white, 'e2e4', 1);
    assert.equal(moved.drawOffer, 'white');
    mark = black.messages.length;
    send(black, { type: 'acceptDraw' });
    const agreed = await black.waitFor((message) => message.type === 'state' && message.phase === 'draw', mark);
    assert.equal(agreed.drawReason, 'agreement');
    assert.equal(agreed.winner, null);
  } finally {
    await closeAll(app, clients);
  }
});
