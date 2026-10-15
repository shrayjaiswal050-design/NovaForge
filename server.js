import http from 'node:http';
import { performance } from 'node:perf_hooks';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import * as chess from './chess.js';

const {
  applyMove,
  createInitialState,
  getGameStatus,
  moveToUci,
  toFEN,
  uciToMove,
} = chess;

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const DEFAULT_PORT = 8787;
const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_ROOM_TTL_MS = 30 * 60 * 1000;
const DEFAULT_CLOCK_INTERVAL_MS = 250;
const DEFAULT_MAX_PAYLOAD_BYTES = 16 * 1024;

function environmentNumber(name, fallback, { integer = false, minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  if (typeof raw !== 'string' || raw.trim() === '') return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value) || (integer && !Number.isSafeInteger(value)) || value < minimum || value > maximum) {
    return fallback;
  }
  return value;
}

function environmentString(name, fallback) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

const PORT = environmentNumber('PORT', DEFAULT_PORT, { integer: true, maximum: 65_535 });
const HOST = environmentString('HOST', DEFAULT_HOST);
const ROOM_TTL_MS = environmentNumber('ROOM_TTL_MS', DEFAULT_ROOM_TTL_MS, { minimum: Number.MIN_VALUE });
const CLOCK_INTERVAL_MS = environmentNumber('CLOCK_INTERVAL_MS', DEFAULT_CLOCK_INTERVAL_MS, { minimum: Number.MIN_VALUE });
const MAX_PAYLOAD_BYTES = environmentNumber('MAX_PAYLOAD_BYTES', DEFAULT_MAX_PAYLOAD_BYTES, {
  integer: true,
  minimum: 256,
});
const MAX_NAME_LENGTH = 64;
const MAX_TOKEN_LENGTH = 128;
const MAX_CLAIM_REASON_LENGTH = 80;
const MIN_CUSTOM_INITIAL_MS = 1;
const MAX_CUSTOM_INITIAL_MS = 24 * 60 * 60 * 1000;
const MAX_CUSTOM_INCREMENT_MS = 60 * 60 * 1000;
const PLAYER_COLORS = ['white', 'black'];
const ROOM_CODE = /^[A-Z0-9]{4,8}$/;
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const OPEN = 1;
const CONNECTING = 0;
const CLOSED = 3;

export const TIME_CONTROLS = Object.freeze({
  '1+0': Object.freeze({ initialMs: 60_000, incrementMs: 0 }),
  '2+1': Object.freeze({ initialMs: 120_000, incrementMs: 1_000 }),
  '3+2': Object.freeze({ initialMs: 180_000, incrementMs: 2_000 }),
  '5+3': Object.freeze({ initialMs: 300_000, incrementMs: 3_000 }),
  '10+0': Object.freeze({ initialMs: 600_000, incrementMs: 0 }),
  '15+10': Object.freeze({ initialMs: 900_000, incrementMs: 10_000 }),
});

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

// Only browser assets are public. In particular, server.js, tests, package
// metadata, and README files are intentionally absent from this allowlist.
const STATIC_FILES = new Set([
  'index.html',
  'styles.css',
  'app.js',
  'chess.js',
  'engine.js',
  'engine-worker.js',
]);

const MESSAGE_TYPES = new Set([
  'create',
  'join',
  'move',
  'rematch',
  'resign',
  'drawOffer',
  'offerDraw',
  'drawAccept',
  'acceptDraw',
  'claimDraw',
  'ping',
]);

class ProtocolError extends Error {
  constructor(message, code = 'INVALID_MESSAGE') {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
  }
}

function now() {
  // performance.now() is monotonic. It is used for clocks, TTLs, and room
  // activity so a system clock correction cannot add or remove game time.
  return performance.now();
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function colorName(value) {
  if (value === 'white' || value === chess.WHITE || value === 0) return 'white';
  if (value === 'black' || value === chess.BLACK || value === 1) return 'black';
  return null;
}

function otherColor(color) {
  return color === 'white' ? 'black' : 'white';
}

function colorNumber(color) {
  return color === 'white' ? chess.WHITE : chess.BLACK;
}

function randomRoomCode(rooms) {
  let code;
  do {
    code = randomBytes(4).toString('hex').toUpperCase();
  } while (rooms.has(code));
  return code;
}

function cleanName(value, fallback) {
  const cleaned = value
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .trim()
    .slice(0, 18);
  return cleaned || fallback;
}

function cloneTimeControl(value) {
  return typeof value === 'string' ? value : { ...value };
}

function parseTimeControl(value) {
  const requested = value === undefined ? '5+3' : value;
  if (typeof requested === 'string') {
    const preset = TIME_CONTROLS[requested];
    if (!Object.hasOwn(TIME_CONTROLS, requested)) {
      throw new ProtocolError(
        `Unsupported time control. Use one of ${Object.keys(TIME_CONTROLS).join(', ')} or provide {initialMs, incrementMs}.`,
        'INVALID_TIME_CONTROL',
      );
    }
    return {
      publicValue: requested,
      initialMs: preset.initialMs,
      incrementMs: preset.incrementMs,
    };
  }

  if (!isPlainObject(requested)) {
    throw new ProtocolError('timeControl must be a preset string or an object with initialMs and incrementMs.', 'INVALID_TIME_CONTROL');
  }

  const { initialMs, incrementMs } = requested;
  if (!Number.isSafeInteger(initialMs) || initialMs < MIN_CUSTOM_INITIAL_MS || initialMs > MAX_CUSTOM_INITIAL_MS) {
    throw new ProtocolError(
      `Custom initialMs must be an integer from ${MIN_CUSTOM_INITIAL_MS} to ${MAX_CUSTOM_INITIAL_MS}.`,
      'INVALID_TIME_CONTROL',
    );
  }
  if (!Number.isSafeInteger(incrementMs) || incrementMs < 0 || incrementMs > MAX_CUSTOM_INCREMENT_MS) {
    throw new ProtocolError(
      `Custom incrementMs must be an integer from 0 to ${MAX_CUSTOM_INCREMENT_MS}.`,
      'INVALID_TIME_CONTROL',
    );
  }

  return {
    publicValue: { initialMs, incrementMs },
    initialMs,
    incrementMs,
  };
}

function validateOptionalString(message, field, maxLength) {
  if (message[field] === undefined || message[field] === null) return;
  if (typeof message[field] !== 'string') {
    throw new ProtocolError(`${field} must be a string.`, 'INVALID_MESSAGE');
  }
  if (message[field].length > maxLength) {
    throw new ProtocolError(`${field} is too long.`, 'INVALID_MESSAGE');
  }
}

function parseMessage(raw, maxPayloadBytes) {
  const byteLength = Buffer.isBuffer(raw) ? raw.byteLength : Buffer.byteLength(String(raw));
  if (byteLength > maxPayloadBytes) {
    throw new ProtocolError('Message payload is too large.', 'PAYLOAD_TOO_LARGE');
  }

  let message;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    throw new ProtocolError('Messages must be valid JSON.', 'INVALID_JSON');
  }
  if (!isPlainObject(message)) {
    throw new ProtocolError('Messages must be JSON objects.', 'INVALID_MESSAGE');
  }
  if (typeof message.type !== 'string' || !MESSAGE_TYPES.has(message.type)) {
    throw new ProtocolError('Message type is missing or unsupported.', 'INVALID_MESSAGE');
  }

  if (message.type === 'create') {
    validateOptionalString(message, 'name', MAX_NAME_LENGTH);
    parseTimeControl(message.timeControl);
  } else if (message.type === 'join') {
    if (typeof message.room !== 'string') throw new ProtocolError('join.room must be a room code.', 'INVALID_MESSAGE');
    const room = message.room.toUpperCase();
    if (!ROOM_CODE.test(room)) throw new ProtocolError('join.room must be a 4-8 character room code.', 'INVALID_MESSAGE');
    if (message.token !== undefined && message.token !== null && typeof message.token !== 'string') {
      throw new ProtocolError('join.token must be a string when supplied.', 'INVALID_MESSAGE');
    }
    if (typeof message.token === 'string' && message.token.length > MAX_TOKEN_LENGTH) {
      throw new ProtocolError('join.token is too long.', 'INVALID_MESSAGE');
    }
    validateOptionalString(message, 'name', MAX_NAME_LENGTH);
    message.room = room;
  } else if (message.type === 'move') {
    if (typeof message.uci !== 'string' || !UCI.test(message.uci.toLowerCase())) {
      throw new ProtocolError('move.uci must be a UCI move such as e2e4 or e7e8q.', 'INVALID_MOVE');
    }
    message.uci = message.uci.toLowerCase();
  } else if (message.type === 'claimDraw') {
    const reason = message.reason ?? message.drawReason;
    if (reason !== undefined && reason !== null && typeof reason !== 'string') {
      throw new ProtocolError('claimDraw.reason must be a string when supplied.', 'INVALID_MESSAGE');
    }
    if (typeof reason === 'string' && reason.length > MAX_CLAIM_REASON_LENGTH) {
      throw new ProtocolError('claimDraw.reason is too long.', 'INVALID_MESSAGE');
    }
    message.reason = reason;
  } else if (message.type === 'drawOffer') {
    // No payload is needed; unknown fields are ignored for forward compatibility.
  }

  return message;
}

function send(socket, payload) {
  if (!socket || (socket.readyState !== OPEN && socket.readyState !== CONNECTING)) return;
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    try {
      socket.terminate();
    } catch {
      // The socket is already gone.
    }
  }
}

function sendError(socket, message, code = 'REQUEST_REJECTED') {
  send(socket, { type: 'error', code, message });
}

function playerSnapshot(room, color) {
  const player = room.players[color];
  return {
    color,
    name: player?.name || `${color[0].toUpperCase()}${color.slice(1)} player`,
    connected: Boolean(player?.socket),
  };
}

function normalizeResult(result, fallback = {}) {
  const source = isPlainObject(result?.result) ? result.result : result;
  const phase = typeof source?.phase === 'string' ? source.phase : fallback.phase;
  const hasWinner = isPlainObject(source) && Object.hasOwn(source, 'winner');
  const winner = hasWinner ? colorName(source.winner) : fallback.winner || null;
  const drawReason = Object.hasOwn(source || {}, 'drawReason') ? source.drawReason : fallback.drawReason ?? null;
  const reason = Object.hasOwn(source || {}, 'reason') ? source.reason : fallback.reason ?? drawReason;
  return {
    phase,
    winner,
    drawReason: typeof drawReason === 'string' ? drawReason : null,
    reason: typeof reason === 'string' ? reason : null,
  };
}

function fallbackTimeoutResult(loserColor) {
  return {
    phase: 'timeout',
    winner: otherColor(loserColor),
    drawReason: null,
    reason: `${loserColor} ran out of time`,
  };
}

function timeoutResultFor(room, loserColor) {
  const fallback = fallbackTimeoutResult(loserColor);
  if (typeof chess.timeoutResult !== 'function') return fallback;
  try {
    const candidate = chess.timeoutResult(room.state, colorNumber(loserColor));
    const normalized = normalizeResult(candidate, fallback);
    return {
      ...fallback,
      ...normalized,
      phase: normalized.phase || fallback.phase,
      reason: normalized.reason || fallback.reason,
    };
  } catch {
    // Keep the server compatible with older chess.js versions and retain the
    // authoritative timeout result if an optional helper is unavailable.
    return fallback;
  }
}

function createRoom(code, timeControl, clockNow) {
  const stamp = clockNow();
  return {
    code,
    state: createInitialState(),
    timeControl: cloneTimeControl(timeControl.publicValue),
    control: { initialMs: timeControl.initialMs, incrementMs: timeControl.incrementMs },
    clocks: {
      white: timeControl.initialMs,
      black: timeControl.initialMs,
    },
    clockStamp: stamp,
    clockRunning: false,
    players: { white: null, black: null },
    result: null,
    drawOffer: null,
    rematchVotes: new Set(),
    roomState: 'waiting',
    revision: 0,
    createdAt: stamp,
    lastActivity: stamp,
    closed: false,
  };
}

function setResult(room, result, at, bumpRevision = true) {
  if (room.result) return false;
  room.result = normalizeResult(result, {
    phase: 'draw',
    winner: null,
    drawReason: null,
    reason: null,
  });
  room.roomState = 'finished';
  room.clockRunning = false;
  room.clockStamp = at;
  room.drawOffer = null;
  room.rematchVotes.clear();
  room.lastActivity = at;
  if (bumpRevision) room.revision += 1;
  return true;
}

function finishFromRules(room, rules, at) {
  if (!rules || rules.phase === 'playing') return false;
  return setResult(room, {
    phase: rules.phase,
    winner: colorName(rules.winner),
    drawReason: rules.drawReason || null,
    reason: rules.drawReason || null,
  }, at, false);
}

function settleClock(room, at) {
  if (!room.clockRunning || room.result || !room.players.white || !room.players.black) {
    room.clockStamp = at;
    return false;
  }

  const elapsed = Math.max(0, at - room.clockStamp);
  room.clockStamp = at;
  if (elapsed <= 0) return false;

  const turn = room.state.turn === chess.WHITE ? 'white' : 'black';
  room.clocks[turn] = Math.max(0, room.clocks[turn] - elapsed);
  if (room.clocks[turn] <= 0) {
    room.clocks[turn] = 0;
    setResult(room, timeoutResultFor(room, turn), at, true);
    return true;
  }
  return false;
}

function startGameIfReady(room, at) {
  if (room.result || !room.players.white || !room.players.black) return;
  if (room.roomState === 'waiting') {
    room.roomState = 'playing';
    room.clockRunning = true;
    room.clockStamp = at;
  }
}

function statusFor(room) {
  const rules = getGameStatus(room.state);
  if (room.result) {
    return {
      phase: room.result.phase,
      winner: room.result.winner,
      drawReason: room.result.drawReason,
      reason: room.result.reason,
      inCheck: rules.inCheck,
      claimableDraws: [],
    };
  }
  return {
    phase: rules.phase,
    winner: colorName(rules.winner),
    drawReason: rules.drawReason || null,
    reason: null,
    inCheck: Boolean(rules.inCheck),
    claimableDraws: Array.isArray(rules.claimableDraws) ? [...rules.claimableDraws] : [],
  };
}

function roomSnapshot(room, viewer = null) {
  const status = statusFor(room);
  const isCurrentViewer = Boolean(viewer && room.players[viewer.color] === viewer);
  const result = room.result
    ? {
      phase: room.result.phase,
      winner: room.result.winner,
      drawReason: room.result.drawReason,
      reason: room.result.reason,
    }
    : null;
  return {
    type: 'state',
    room: room.code,
    you: isCurrentViewer ? viewer.color : null,
    // A reconnect token is a private capability. It is sent only to the
    // player object that owns it, never to the other seat.
    token: isCurrentViewer ? viewer.token : null,
    fen: toFEN(room.state),
    history: room.state.history.map((entry) => ({ ...entry })),
    lastMove: room.state.lastMove ? { ...room.state.lastMove } : null,
    turn: room.state.turn === chess.WHITE ? 'white' : 'black',
    phase: status.phase,
    winner: status.winner || null,
    drawReason: status.drawReason || null,
    reason: status.reason || null,
    inCheck: status.inCheck,
    clocks: { ...room.clocks },
    timeControl: cloneTimeControl(room.timeControl),
    players: [playerSnapshot(room, 'white'), playerSnapshot(room, 'black')],
    ready: Boolean(room.players.white && room.players.black),
    // Additive protocol fields for synchronization and room-level actions.
    revision: room.revision,
    roomState: room.roomState,
    result,
    claimableDraws: status.claimableDraws,
    drawOffer: room.drawOffer,
    rematchVotes: [...room.rematchVotes],
  };
}

function broadcast(room, payloadFactory) {
  if (room.closed) return;
  for (const color of PLAYER_COLORS) {
    const player = room.players[color];
    if (!player?.socket) continue;
    const payload = typeof payloadFactory === 'function' ? payloadFactory(player) : payloadFactory;
    send(player.socket, payload);
  }
}

function broadcastState(room, at = now()) {
  if (room.closed) return;
  settleClock(room, at);
  broadcast(room, (player) => roomSnapshot(room, player));
}

function broadcastClock(room, at = now()) {
  if (room.closed) return;
  settleClock(room, at);
  if (room.result || !room.clockRunning) return;
  broadcast(room, {
    type: 'clock',
    clocks: {
      ...room.clocks,
      turn: room.state.turn === chess.WHITE ? 'white' : 'black',
    },
    revision: room.revision,
  });
}

function attachPlayer(room, color, socket, name, token, clockNow) {
  const existing = room.players[color];
  if (existing?.socket) return null;
  const player = existing
    ? { ...existing, socket, name: name || existing.name }
    : { color, socket, name, token: token || randomUUID() };
  room.players[color] = player;
  socket.playerMeta = { room, color, token: player.token };
  room.lastActivity = clockNow();
  room.revision += 1;
  return player;
}

function closeSocket(socket, code = 1000, reason = 'Room closed') {
  if (!socket) return;
  try {
    if (socket.readyState === OPEN) socket.close(code, reason);
    if (socket.readyState === CONNECTING) socket.terminate();
    if (socket.readyState !== CLOSED) {
      const fallback = setTimeout(() => {
        if (socket.readyState !== CLOSED) socket.terminate();
      }, 1_000);
      fallback.unref?.();
    }
  } catch {
    try {
      socket.terminate();
    } catch {
      // The socket is already closed.
    }
  }
}

function closeRoom(room, rooms, reason = 'Room expired') {
  if (room.closed) return;
  room.closed = true;
  rooms.delete(room.code);
  for (const color of PLAYER_COLORS) {
    const player = room.players[color];
    if (!player?.socket) continue;
    const socket = player.socket;
    player.socket = null;
    socket.playerMeta = null;
    closeSocket(socket, 1000, reason);
  }
}

function authenticatedPlayer(socket) {
  const meta = socket.playerMeta;
  const room = meta?.room;
  const player = room && room.players[meta.color];
  if (!room || room.closed || !player || player.socket !== socket || player.token !== meta.token) return null;
  return { room, player };
}

function prepareGameAction(room, clockNow) {
  const at = clockNow();
  if (settleClock(room, at)) {
    broadcastState(room, at);
    return null;
  }
  return at;
}

function gameReadinessError(room) {
  if (!room.players.white || !room.players.black) return 'Waiting for the second player.';
  if (room.result) return 'This game has already ended.';
  return null;
}

function applyServerMove(room, player, uci, clockNow) {
  const readyError = gameReadinessError(room);
  if (readyError) return { error: readyError };

  const expectedColor = room.state.turn === chess.WHITE ? 'white' : 'black';
  if (player.color !== expectedColor) return { error: 'It is not your turn.' };
  const move = uciToMove(room.state, uci);
  if (!move) return { error: 'That move is not legal in the current position.' };

  // Legal move generation is synchronous, but settle once more at commit so
  // time spent validating the move is also authoritative game time.
  const commitAt = clockNow();
  if (settleClock(room, commitAt)) {
    broadcastState(room, commitAt);
    return { error: 'The game ended on time before that move was accepted.', timedOut: true };
  }

  room.state = applyMove(room.state, move, { record: true });
  room.clocks[player.color] += room.control.incrementMs;
  room.clockStamp = commitAt;
  room.lastActivity = commitAt;
  // An offer survives the offerer's move; the recipient's move declines it.
  if (room.drawOffer === otherColor(player.color)) room.drawOffer = null;
  room.revision += 1;

  const rules = getGameStatus(room.state);
  finishFromRules(room, rules, commitAt);
  return { move: moveToUci(move) };
}

function resultForDrawClaim(room, requestedReason) {
  const rules = getGameStatus(room.state);
  const available = Array.isArray(rules.claimableDraws) ? rules.claimableDraws : [];
  if (!available.length) return { error: 'No claimable draw is available in this position.' };
  if (requestedReason) {
    const wanted = requestedReason.trim().toLowerCase();
    const selected = available.find((reason) => reason.toLowerCase() === wanted);
    if (!selected) return { error: `That draw claim is not available. Available claims: ${available.join(', ')}.` };
    return { reason: selected };
  }
  return { reason: available[0] };
}

function resetForRematch(room, at) {
  room.state = createInitialState();
  room.clocks = {
    white: room.control.initialMs,
    black: room.control.initialMs,
  };
  room.clockStamp = at;
  room.clockRunning = true;
  room.result = null;
  room.drawOffer = null;
  room.rematchVotes.clear();
  room.roomState = 'playing';
  room.lastActivity = at;
  room.revision += 1;
}

function sameOrigin(request) {
  const origin = request.headers.origin;
  // Node clients and command-line clients normally omit Origin. Browser
  // connections with an Origin header must match the HTTP host exactly.
  if (origin === undefined) return true;
  if (typeof origin !== 'string' || origin === 'null') return false;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  const expectedProtocol = request.socket.encrypted ? 'https:' : 'http:';
  const host = request.headers.host;
  return Boolean(host)
    && parsed.protocol === expectedProtocol
    && parsed.host.toLowerCase() === String(host).toLowerCase();
}

function rejectUpgrade(socket, status = 403, text = 'Forbidden') {
  try {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } finally {
    socket.destroy();
  }
}

function responseBody(response, status, headers, body, headOnly = false) {
  response.writeHead(status, headers);
  if (headOnly) response.end();
  else response.end(body);
}

async function serveFile(request, response) {
  const headOnly = request.method === 'HEAD';
  if (request.method !== 'GET' && !headOnly) {
    responseBody(response, 405, { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' }, 'Method Not Allowed', false);
    return;
  }

  let rawPath;
  try {
    rawPath = (request.url || '/').split('?')[0];
    const pathname = decodeURIComponent(rawPath);
    if (pathname === '/health') {
      const body = JSON.stringify({ ok: true, service: 'nova-chess' });
      responseBody(response, 200, { 'content-type': 'application/json', 'cache-control': 'no-store' }, body, headOnly);
      return;
    }
    if (!pathname.startsWith('/')) {
      responseBody(response, 400, { 'content-type': 'text/plain; charset=utf-8' }, 'Bad path', headOnly);
      return;
    }
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (relative.split('/').includes('..') || relative.includes('\0') || !STATIC_FILES.has(relative)) {
      responseBody(response, 404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }, 'Not found', headOnly);
      return;
    }
    const contents = await readFile(join(ROOT, relative));
    responseBody(response, 200, {
      'content-type': CONTENT_TYPES[extname(relative)] || 'application/octet-stream',
      'cache-control': 'no-store',
    }, contents, headOnly);
  } catch (error) {
    if (error instanceof URIError) {
      responseBody(response, 400, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }, 'Bad path', headOnly);
      return;
    }
    if (!response.writableEnded) {
      responseBody(response, 404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }, 'Not found', headOnly);
    }
  }
}

export function createChessServer(options = {}) {
  const rooms = new Map();
  const clockNow = typeof options.now === 'function' ? options.now : now;
  const roomTtlMs = options.roomTtlMs ?? ROOM_TTL_MS;
  const clockIntervalMs = options.clockIntervalMs ?? CLOCK_INTERVAL_MS;
  const maxPayloadBytes = options.maxPayloadBytes ?? MAX_PAYLOAD_BYTES;

  if (!Number.isFinite(roomTtlMs) || roomTtlMs <= 0) throw new TypeError('roomTtlMs must be a positive number.');
  if (!Number.isFinite(clockIntervalMs) || clockIntervalMs <= 0) throw new TypeError('clockIntervalMs must be a positive number.');
  if (!Number.isSafeInteger(maxPayloadBytes) || maxPayloadBytes < 256) throw new TypeError('maxPayloadBytes must be an integer of at least 256.');

  const server = http.createServer((request, response) => {
    void serveFile(request, response);
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: maxPayloadBytes });

  function expireInactiveRooms(at) {
    for (const room of rooms.values()) {
      if (room.closed) continue;

      const timedOut = settleClock(room, at);
      if (timedOut) {
        broadcastState(room, at);
      }

      // A running game is retained even when neither player sends a move (or
      // even when both clients reconnect later). Finished and waiting rooms
      // are bounded by the TTL.
      const activeGame = room.roomState === 'playing' && !room.result;
      if (!activeGame && at - room.lastActivity > roomTtlMs) {
        closeRoom(room, rooms);
        continue;
      }
      if (!room.result && room.clockRunning) broadcastClock(room, at);
    }
  }

  const clockTimer = setInterval(() => expireInactiveRooms(clockNow()), clockIntervalMs);
  clockTimer.unref?.();

  server.on('upgrade', (request, socket, head) => {
    if (!sameOrigin(request)) {
      rejectUpgrade(socket);
      return;
    }
    wss.handleUpgrade(request, socket, head, (client) => {
      wss.emit('connection', client, request);
    });
  });

  wss.on('connection', (socket) => {
    socket.on('error', () => {
      // ws emits errors for malformed frames and terminated peers. The close
      // handler below owns room membership cleanup.
    });

    socket.on('message', (raw) => {
      let message;
      try {
        message = parseMessage(raw, maxPayloadBytes);
      } catch (error) {
        sendError(socket, error instanceof ProtocolError ? error.message : 'Invalid message.', error.code || 'INVALID_MESSAGE');
        if (error?.code === 'PAYLOAD_TOO_LARGE') socket.close(1009, 'Payload too large');
        return;
      }

      try {
        if (message.type === 'ping') {
          send(socket, { type: 'pong', at: clockNow() });
          return;
        }

        if (message.type === 'create') {
          if (socket.playerMeta?.room) {
            sendError(socket, 'You are already in a room.', 'ALREADY_IN_ROOM');
            return;
          }
          const timeControl = parseTimeControl(message.timeControl);
          const room = createRoom(randomRoomCode(rooms), timeControl, clockNow);
          rooms.set(room.code, room);
          const player = attachPlayer(
            room,
            'white',
            socket,
            cleanName(message.name || '', 'White'),
            null,
            clockNow,
          );
          if (!player) {
            closeRoom(room, rooms, 'Unable to create room');
            sendError(socket, 'Unable to create the room.', 'ROOM_CREATE_FAILED');
            return;
          }
          send(socket, {
            type: 'created',
            room: room.code,
            color: 'white',
            token: player.token,
            timeControl: cloneTimeControl(room.timeControl),
            revision: room.revision,
          });
          broadcastState(room, clockNow());
          return;
        }

        if (message.type === 'join') {
          if (socket.playerMeta?.room) {
            sendError(socket, 'You are already in a room.', 'ALREADY_IN_ROOM');
            return;
          }
          const room = rooms.get(message.room);
          if (!room || room.closed) {
            sendError(socket, 'That room does not exist.', 'ROOM_NOT_FOUND');
            return;
          }

          const requestedToken = typeof message.token === 'string' && message.token.length ? message.token : null;
          let color = null;
          let reconnect = false;
          if (requestedToken) {
            for (const candidateColor of PLAYER_COLORS) {
              if (room.players[candidateColor]?.token === requestedToken) {
                color = candidateColor;
                reconnect = true;
                break;
              }
            }
            if (!color) {
              sendError(socket, 'That reconnect token does not match this room.', 'INVALID_RECONNECT_TOKEN');
              return;
            }
          } else if (!room.players.black) {
            color = 'black';
          } else {
            sendError(socket, 'That room is full; a reconnect token is required for the occupied seat.', 'RECONNECT_TOKEN_REQUIRED');
            return;
          }

          const existing = room.players[color];
          if (existing?.socket) {
            sendError(socket, 'That reconnect token is already in use.', 'RECONNECT_TOKEN_IN_USE');
            return;
          }
          const fallback = existing?.name || `${color[0].toUpperCase()}${color.slice(1)}`;
          const player = attachPlayer(
            room,
            color,
            socket,
            cleanName(message.name || '', fallback),
            reconnect ? requestedToken : null,
            clockNow,
          );
          if (!player) {
            sendError(socket, 'That seat is no longer available.', 'SEAT_UNAVAILABLE');
            return;
          }
          const startAt = clockNow();
          startGameIfReady(room, startAt);
          send(socket, {
            type: 'joined',
            room: room.code,
            color,
            token: player.token,
            timeControl: cloneTimeControl(room.timeControl),
            revision: room.revision,
          });
          broadcastState(room, clockNow());
          return;
        }

        const authenticated = authenticatedPlayer(socket);
        if (!authenticated) {
          sendError(socket, 'Join a room before sending that action.', 'NOT_AUTHENTICATED');
          return;
        }
        const { room, player } = authenticated;

        if (message.type === 'rematch') {
          if (!room.result) {
            sendError(socket, 'A rematch can be requested only after the game finishes.', 'REMATCH_NOT_AVAILABLE');
            return;
          }
          if (!room.rematchVotes.has(player.color)) {
            room.rematchVotes.add(player.color);
            room.lastActivity = clockNow();
            room.revision += 1;
          }
          if (room.rematchVotes.size === PLAYER_COLORS.length) {
            resetForRematch(room, clockNow());
          }
          broadcastState(room, clockNow());
          return;
        }

        const actionAt = prepareGameAction(room, clockNow);
        if (actionAt === null) {
          sendError(socket, 'The game has ended because the active clock reached zero.', 'GAME_FINISHED');
          return;
        }
        const readinessError = gameReadinessError(room);
        if (readinessError) {
          sendError(socket, readinessError, room.result ? 'GAME_FINISHED' : 'WAITING_FOR_PLAYER');
          return;
        }

        if (message.type === 'move') {
          const result = applyServerMove(room, player, message.uci, clockNow);
          if (result.error) {
            sendError(socket, result.error, result.timedOut ? 'GAME_FINISHED' : 'MOVE_REJECTED');
            return;
          }
          broadcastState(room, clockNow());
          return;
        }

        if (message.type === 'resign') {
          setResult(room, {
            phase: 'resigned',
            winner: otherColor(player.color),
            drawReason: null,
            reason: `${player.color} resigned`,
          }, actionAt, true);
          broadcastState(room, actionAt);
          return;
        }

        if (message.type === 'drawOffer' || message.type === 'offerDraw') {
          if (room.drawOffer === player.color) {
            sendError(socket, 'You already have a draw offer pending.', 'DRAW_OFFER_PENDING');
            return;
          }
          if (room.drawOffer) {
            sendError(socket, 'A draw offer is already pending for the other player.', 'DRAW_OFFER_PENDING');
            return;
          }
          room.drawOffer = player.color;
          room.lastActivity = actionAt;
          room.revision += 1;
          broadcastState(room, actionAt);
          return;
        }

        if (message.type === 'drawAccept' || message.type === 'acceptDraw') {
          if (!room.drawOffer) {
            sendError(socket, 'There is no draw offer to accept.', 'NO_DRAW_OFFER');
            return;
          }
          if (room.drawOffer === player.color) {
            sendError(socket, 'The player who made the offer cannot accept it.', 'DRAW_OFFER_SELF_ACCEPT');
            return;
          }
          setResult(room, {
            phase: 'draw',
            winner: null,
            drawReason: 'agreement',
            reason: 'draw by agreement',
          }, actionAt, true);
          broadcastState(room, actionAt);
          return;
        }

        if (message.type === 'claimDraw') {
          const turn = room.state.turn === chess.WHITE ? 'white' : 'black';
          if (player.color !== turn) {
            sendError(socket, 'Only the player whose turn it is can claim a draw.', 'DRAW_CLAIM_REJECTED');
            return;
          }
          const claim = resultForDrawClaim(room, message.reason);
          if (claim.error) {
            sendError(socket, claim.error, 'DRAW_CLAIM_REJECTED');
            return;
          }
          setResult(room, {
            phase: 'draw',
            winner: null,
            drawReason: claim.reason,
            reason: `draw claimed: ${claim.reason}`,
          }, actionAt, true);
          broadcastState(room, actionAt);
          return;
        }

        sendError(socket, 'Unsupported action.', 'INVALID_MESSAGE');
      } catch (error) {
        if (error instanceof ProtocolError) sendError(socket, error.message, error.code);
        else sendError(socket, 'The server could not process that action.', 'REQUEST_FAILED');
      }
    });

    socket.on('close', () => {
      const meta = socket.playerMeta;
      if (!meta?.room || meta.room.closed) return;
      const current = meta.room.players[meta.color];
      if (current?.socket !== socket) return;
      current.socket = null;
      meta.room.lastActivity = clockNow();
      broadcastState(meta.room, clockNow());
    });
  });

  let closePromise = null;
  function close(callback) {
    if (!closePromise) {
      closePromise = new Promise((resolve) => {
        clearInterval(clockTimer);
        for (const room of [...rooms.values()]) closeRoom(room, rooms, 'Server shutting down');
        rooms.clear();
        for (const client of wss.clients) {
          closeSocket(client, 1001, 'Server shutting down');
        }

        const finish = () => resolve();
        try {
          wss.close(() => {
            if (!server.listening) finish();
            else {
              try {
                server.close(() => finish());
              } catch {
                finish();
              }
            }
          });
        } catch {
          if (!server.listening) finish();
          else {
            try {
              server.close(() => finish());
            } catch {
              finish();
            }
          }
        }
      });
    }
    if (typeof callback === 'function') closePromise.then(() => callback(), callback);
    return closePromise;
  }

  return {
    server,
    wss,
    rooms,
    close,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = createChessServer();
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received; shutting down Nova Chess server.`);
    app.close()
      .then(() => {
        process.exitCode = 0;
      })
      .catch((error) => {
        console.error('Failed to shut down Nova Chess server cleanly.', error);
        process.exitCode = 1;
      });
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  app.server.listen(PORT, HOST, () => {
    const address = app.server.address();
    const boundPort = typeof address === 'object' && address ? address.port : PORT;
    console.log(`Nova Chess server running at http://${HOST}:${boundPort}`);
    console.log(`WebSocket rooms available at ws://${HOST}:${boundPort}`);
  });
}
