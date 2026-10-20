import http from 'node:http';
import { performance } from 'node:perf_hooks';
import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import * as chess from './chess.js';
import {
  AuthError,
  AuthStore,
  createAuthStore,
  normalizeHandle,
} from './auth.js';
import { timeControlCategory } from './rating.js';

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
const DEFAULT_GAME_TTL_MS = 30 * 60 * 1000;
const DEFAULT_CLOCK_INTERVAL_MS = 250;
const DEFAULT_MAX_PAYLOAD_BYTES = 16 * 1024;
const DEFAULT_INVITE_TTL_MS = 15 * 60 * 1000;
const MAX_HTTP_BODY_BYTES = 16 * 1024;
const MAX_HANDLE_INPUT_LENGTH = 64;
const MAX_GAME_ID_LENGTH = 80;
const MAX_RECONNECT_TOKEN_LENGTH = 128;
const MAX_INVITE_ID_LENGTH = 80;
const MAX_DRAW_REASON_LENGTH = 80;
const PLAYER_COLORS = ['white', 'black'];
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

// Only browser assets are public. In particular, server.js, auth.js, tests,
// package metadata, and README files are intentionally absent from this list.
const STATIC_FILES = new Set([
  'index.html',
  'styles.css',
  'app.js',
  'chess.js',
  'engine.js',
  'engine-worker.js',
  'premove.js',
  'static-mode.js',
]);

const MESSAGE_TYPES = new Set([
  'quickMatch',
  'cancelQuickMatch',
  // Keep the existing browser action as a compatibility alias.
  'quickCancel',
  'friendInvite',
  'friendInviteRespond',
  'friendMove',
  'friendResign',
  'friendDrawOffer',
  'friendDrawAccept',
  'friendRematch',
  'friendReconnect',
  'ping',
]);

class ProtocolError extends Error {
  constructor(message, code = 'INVALID_MESSAGE') {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
  }
}

class HttpError extends Error {
  constructor(message, status = 400, code = 'REQUEST_REJECTED') {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

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
const GAME_TTL_MS = environmentNumber('ROOM_TTL_MS', DEFAULT_GAME_TTL_MS, { minimum: Number.MIN_VALUE });
const CLOCK_INTERVAL_MS = environmentNumber('CLOCK_INTERVAL_MS', DEFAULT_CLOCK_INTERVAL_MS, { minimum: Number.MIN_VALUE });
const MAX_PAYLOAD_BYTES = environmentNumber('MAX_PAYLOAD_BYTES', DEFAULT_MAX_PAYLOAD_BYTES, {
  integer: true,
  minimum: 256,
});
const MIN_CUSTOM_INITIAL_MS = 1;
const MAX_CUSTOM_INITIAL_MS = 24 * 60 * 60 * 1000;
const MAX_CUSTOM_INCREMENT_MS = 60 * 60 * 1000;

function now() {
  // performance.now() is monotonic. It is used for clocks, TTLs, and game
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

function cloneTimeControl(value) {
  return typeof value === 'string' ? value : { ...value };
}

function assertMessageFields(message, required, optional = []) {
  const allowed = new Set(['type', ...required, ...optional]);
  for (const key of Object.keys(message)) {
    if (!allowed.has(key)) throw new ProtocolError('Message contains an unsupported field.', 'INVALID_MESSAGE');
  }
  for (const key of required) {
    if (!Object.hasOwn(message, key)) throw new ProtocolError('Message is missing a required field.', 'INVALID_MESSAGE');
  }
}

function parseTimeControl(value) {
  if (typeof value === 'string') {
    const preset = TIME_CONTROLS[value];
    if (!Object.hasOwn(TIME_CONTROLS, value)) {
      throw new ProtocolError('Unsupported time control.', 'INVALID_TIME_CONTROL');
    }
    return {
      publicValue: value,
      initialMs: preset.initialMs,
      incrementMs: preset.incrementMs,
    };
  }
  if (!isPlainObject(value)) {
    throw new ProtocolError('timeControl must be a preset string or an object.', 'INVALID_TIME_CONTROL');
  }
  const keys = Object.keys(value);
  if (keys.some((key) => key !== 'initialMs' && key !== 'incrementMs')
    || keys.length !== 2) {
    throw new ProtocolError('timeControl must contain only initialMs and incrementMs.', 'INVALID_TIME_CONTROL');
  }
  const { initialMs, incrementMs } = value;
  if (!Number.isSafeInteger(initialMs) || initialMs < MIN_CUSTOM_INITIAL_MS || initialMs > MAX_CUSTOM_INITIAL_MS) {
    throw new ProtocolError('Custom initialMs is outside the allowed range.', 'INVALID_TIME_CONTROL');
  }
  if (!Number.isSafeInteger(incrementMs) || incrementMs < 0 || incrementMs > MAX_CUSTOM_INCREMENT_MS) {
    throw new ProtocolError('Custom incrementMs is outside the allowed range.', 'INVALID_TIME_CONTROL');
  }
  return {
    publicValue: { initialMs, incrementMs },
    initialMs,
    incrementMs,
  };
}

function parseQuickMatchTimeControl(value) {
  if (typeof value !== 'string' || !Object.hasOwn(TIME_CONTROLS, value)) {
    throw new ProtocolError('quickMatch requires an exact preset time control.', 'INVALID_TIME_CONTROL');
  }
  return parseTimeControl(value);
}

function ratingCategoryFor(timeControl) {
  try {
    return timeControlCategory(timeControl);
  } catch {
    return 'rapid';
  }
}

function parseVariant(value) {
  if (value !== 'standard' && value !== 'chess960') {
    throw new ProtocolError('variant must be standard or chess960.', 'INVALID_VARIANT');
  }
  return value;
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
  if (!isPlainObject(message)) throw new ProtocolError('Messages must be JSON objects.', 'INVALID_MESSAGE');
  if (typeof message.type !== 'string' || !MESSAGE_TYPES.has(message.type)) {
    throw new ProtocolError('Message type is missing or unsupported.', 'INVALID_MESSAGE');
  }

  if (message.type === 'quickMatch') {
    assertMessageFields(message, ['variant', 'timeControl'], ['color']);
    parseVariant(message.variant);
    parseQuickMatchTimeControl(message.timeControl);
    if (message.color !== undefined
      && message.color !== 'white' && message.color !== 'black' && message.color !== 'random') {
      throw new ProtocolError('color must be white, black, or random.', 'INVALID_MESSAGE');
    }
  } else if (message.type === 'cancelQuickMatch' || message.type === 'quickCancel') {
    assertMessageFields(message, [], ['matchId']);
    if (message.matchId !== undefined
      && (typeof message.matchId !== 'string' || !message.matchId.length || message.matchId.length > MAX_INVITE_ID_LENGTH)) {
      throw new ProtocolError('matchId is invalid.', 'INVALID_MESSAGE');
    }
  } else if (message.type === 'friendInvite') {
    assertMessageFields(message, ['toHandle', 'variant', 'timeControl'], ['chess960Seed', 'color']);
    if (typeof message.toHandle !== 'string' || message.toHandle.length > MAX_HANDLE_INPUT_LENGTH) {
      throw new ProtocolError('toHandle is invalid.', 'INVALID_MESSAGE');
    }
    parseVariant(message.variant);
    parseTimeControl(message.timeControl);
    if (message.color !== undefined
      && message.color !== 'white' && message.color !== 'black' && message.color !== 'random') {
      throw new ProtocolError('color must be white, black, or random.', 'INVALID_MESSAGE');
    }
    if (message.chess960Seed !== undefined
      && (!Number.isSafeInteger(message.chess960Seed) || message.chess960Seed < 0 || message.chess960Seed > 959)) {
      throw new ProtocolError('chess960Seed must be an integer from 0 to 959.', 'INVALID_VARIANT');
    }
    if (message.variant === 'standard' && message.chess960Seed !== undefined) {
      throw new ProtocolError('chess960Seed is only valid for chess960.', 'INVALID_VARIANT');
    }
  } else if (message.type === 'friendInviteRespond') {
    assertMessageFields(message, ['inviteId', 'accept']);
    if (typeof message.inviteId !== 'string' || !message.inviteId.length || message.inviteId.length > MAX_INVITE_ID_LENGTH) {
      throw new ProtocolError('inviteId is invalid.', 'INVALID_MESSAGE');
    }
    if (typeof message.accept !== 'boolean') throw new ProtocolError('accept must be a boolean.', 'INVALID_MESSAGE');
  } else if (message.type === 'friendMove') {
    assertMessageFields(message, ['uci']);
    if (typeof message.uci !== 'string' || !UCI.test(message.uci.toLowerCase())) {
      throw new ProtocolError('uci must be a legal UCI-shaped move.', 'INVALID_MOVE');
    }
    message.uci = message.uci.toLowerCase();
  } else if (message.type === 'friendReconnect') {
    assertMessageFields(message, ['gameId', 'token']);
    if (typeof message.gameId !== 'string' || !message.gameId.length || message.gameId.length > MAX_GAME_ID_LENGTH) {
      throw new ProtocolError('gameId is invalid.', 'INVALID_MESSAGE');
    }
    if (typeof message.token !== 'string' || !message.token.length || message.token.length > MAX_RECONNECT_TOKEN_LENGTH) {
      throw new ProtocolError('token is invalid.', 'INVALID_MESSAGE');
    }
  } else if (message.type === 'ping') {
    assertMessageFields(message, []);
  } else {
    assertMessageFields(message, []);
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

function authProtocolError(error) {
  if (error instanceof AuthError) return new ProtocolError(error.message, error.code);
  return error;
}

function hashToken(token) {
  return createHash('sha256').update(token, 'utf8').digest();
}

function tokenMatches(token, expected) {
  const candidate = hashToken(token);
  const actual = hashToken(expected);
  return timingSafeEqual(candidate, actual);
}

function normalizedResult(result, fallback = {}) {
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

function finiteRating(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function ratingFromSource(source, color, stage) {
  const stageSource = isPlainObject(source?.[stage]) ? source[stage] : source;
  const ratings = isPlainObject(stageSource?.ratings) ? stageSource.ratings : stageSource;
  const player = ratings?.[color];
  if (isPlainObject(player)) {
    const candidates = stage === 'before'
      ? [player.before, player.beforeRating, player.start]
      : [player.after, player.afterRating, player.rating, player.end];
    for (const candidate of candidates) {
      const rating = finiteRating(candidate);
      if (rating !== null) return rating;
    }
    return null;
  }
  return finiteRating(player);
}

function ratingTimeControlArgument(timeControl, category) {
  if (!isPlainObject(timeControl)) return timeControl;
  const isKnownTimeControl = Object.values(TIME_CONTROLS).some((control) => (
    control.initialMs === timeControl.initialMs && control.incrementMs === timeControl.incrementMs
  ));
  if (isKnownTimeControl) return { ...timeControl };
  // AuthStore accepts custom controls through the category field while the
  // original initial/increment values remain available to the store caller.
  return { ...timeControl, category };
}

function storedRating(authStore, handle, variant, timeControl, category) {
  if (typeof authStore.getCategoryRating === 'function') {
    const categoryRating = finiteRating(authStore.getCategoryRating(handle, {
      category,
      variant,
      timeControl: cloneTimeControl(timeControl),
    }));
    if (categoryRating !== null) return categoryRating;
  }
  if (typeof authStore.getRating === 'function') {
    return finiteRating(authStore.getRating(
      handle,
      variant,
      ratingTimeControlArgument(timeControl, category),
    ));
  }
  return null;
}

function recordRatings(authStore, game, outcome) {
  const timeControl = cloneTimeControl(game.timeControl);
  const category = ratingCategoryFor(timeControl);
  const storeTimeControl = ratingTimeControlArgument(timeControl, category);
  const before = {
    white: storedRating(authStore, game.players.white.handle, game.variant, timeControl, category),
    black: storedRating(authStore, game.players.black.handle, game.variant, timeControl, category),
  };
  const recorded = authStore.recordGameResult(
    game.players.white.handle,
    game.players.black.handle,
    outcome,
    game.variant,
    storeTimeControl,
  );
  const after = {
    white: ratingFromSource(recorded, 'white', 'after')
      ?? storedRating(authStore, game.players.white.handle, game.variant, timeControl, category),
    black: ratingFromSource(recorded, 'black', 'after')
      ?? storedRating(authStore, game.players.black.handle, game.variant, timeControl, category),
  };
  const beforeRatings = {
    white: ratingFromSource(recorded, 'white', 'before') ?? before.white,
    black: ratingFromSource(recorded, 'black', 'before') ?? before.black,
  };
  const afterRatings = {
    white: after.white,
    black: after.black,
  };
  const recordedCategory = typeof recorded?.category === 'string' ? recorded.category : category;

  return {
    category: recordedCategory,
    speed: recorded?.speed || recordedCategory,
    variant: game.variant,
    timeControl,
    ratingKey: recorded?.ratingKey || `${game.variant}:${recordedCategory}`,
    before: beforeRatings,
    after: afterRatings,
    white: {
      before: beforeRatings.white,
      after: after.white,
    },
    black: {
      before: beforeRatings.black,
      after: after.black,
    },
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

function timeoutResultFor(game, loserColor) {
  const fallback = fallbackTimeoutResult(loserColor);
  if (typeof chess.timeoutResult !== 'function') return fallback;
  try {
    const candidate = chess.timeoutResult(game.state, colorNumber(loserColor));
    const result = normalizedResult(candidate, fallback);
    return {
      ...fallback,
      ...result,
      phase: result.phase || fallback.phase,
      reason: result.reason || fallback.reason,
    };
  } catch {
    // Keep compatibility with chess.js versions without the optional helper.
    return fallback;
  }
}

function closeSocket(socket, code = 1000, reason = 'Connection closed') {
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
      // The socket is already gone.
    }
  }
}

function sameOrigin(request) {
  const origin = request.headers.origin;
  // Non-browser clients often omit Origin. If one is supplied, it must be the
  // exact HTTP(S) origin represented by the Host header.
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

function securityHeaders(extra = {}) {
  return {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...extra,
  };
}

function responseBody(response, status, headers, body = '', headOnly = false) {
  response.writeHead(status, securityHeaders(headers));
  if (headOnly) response.end();
  else response.end(body);
}

function jsonResponse(response, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  responseBody(response, status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...extraHeaders,
  }, body);
}

function publicRequest(request) {
  return {
    requestId: request.requestId,
    handle: request.fromHandle,
    createdAt: request.createdAt,
  };
}

async function readJsonBody(request, maxBytes = MAX_HTTP_BODY_BYTES) {
  const contentLength = request.headers['content-length'];
  if (contentLength !== undefined) {
    const parsedLength = Number(contentLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maxBytes) {
      throw new HttpError('Request body is too large.', 413, 'PAYLOAD_TOO_LARGE');
    }
  }
  const contentType = request.headers['content-type'];
  if (contentType && !/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new HttpError('Request body must be JSON.', 415, 'UNSUPPORTED_MEDIA_TYPE');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new HttpError('Request body is too large.', 413, 'PAYLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError('Request body must be valid JSON.', 400, 'INVALID_JSON');
  }
}

async function serveFile(request, response) {
  const headOnly = request.method === 'HEAD';
  if (request.method !== 'GET' && !headOnly) {
    responseBody(response, 405, { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' }, 'Method Not Allowed');
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

function resultForGame(game) {
  if (!game.result) return null;
  const category = game.result.ratings?.category || null;
  return {
    phase: game.result.phase,
    winner: game.result.winner,
    drawReason: game.result.drawReason,
    reason: game.result.reason,
    variant: game.variant,
    timeControl: cloneTimeControl(game.timeControl),
    category,
    ratingCategory: category,
    // Ratings are deliberately nested in a finished-only result snapshot.
    ratings: game.result.ratings ? {
      ...game.result.ratings,
      timeControl: cloneTimeControl(game.result.ratings.timeControl),
      before: { ...game.result.ratings.before },
      after: { ...game.result.ratings.after },
      white: { ...game.result.ratings.white },
      black: { ...game.result.ratings.black },
    } : null,
  };
}

export function createChessServer(options = {}) {
  const games = new Map();
  const invites = new Map();
  const onlineConnections = new Map();
  const activeGameIds = new Map();
  const matchmakingBuckets = new Map();
  const quickMatchesByHandle = new Map();
  const clockNow = typeof options.now === 'function' ? options.now : now;
  const gameTtlMs = options.roomTtlMs ?? options.gameTtlMs ?? GAME_TTL_MS;
  const inviteTtlMs = options.inviteTtlMs ?? DEFAULT_INVITE_TTL_MS;
  const clockIntervalMs = options.clockIntervalMs ?? CLOCK_INTERVAL_MS;
  const maxPayloadBytes = options.maxPayloadBytes ?? MAX_PAYLOAD_BYTES;
  const authOptions = {
    ...(options.auth || {}),
    ...(options.sessionTtlMs !== undefined && options.auth?.sessionTtlMs === undefined
      ? { sessionTtlMs: options.sessionTtlMs }
      : {}),
    ...(options.authNow !== undefined && options.auth?.now === undefined
      ? { now: options.authNow }
      : {}),
    ...(options.authDbPath !== undefined && options.auth?.dbPath === undefined
      ? { dbPath: options.authDbPath }
      : {}),
  };
  const authStore = options.authStore instanceof AuthStore
    ? options.authStore
    : createAuthStore(authOptions);

  if (!Number.isFinite(gameTtlMs) || gameTtlMs <= 0) throw new TypeError('gameTtlMs must be a positive number.');
  if (!Number.isFinite(inviteTtlMs) || inviteTtlMs <= 0) throw new TypeError('inviteTtlMs must be a positive number.');
  if (!Number.isFinite(clockIntervalMs) || clockIntervalMs <= 0) throw new TypeError('clockIntervalMs must be a positive number.');
  if (!Number.isSafeInteger(maxPayloadBytes) || maxPayloadBytes < 256) throw new TypeError('maxPayloadBytes must be an integer of at least 256.');

  function accountIsOnline(handle) {
    const sockets = onlineConnections.get(handle);
    return Boolean(sockets && sockets.size);
  }

  function notifyAccount(handle, payload) {
    const sockets = onlineConnections.get(handle);
    if (!sockets) return;
    for (const socket of sockets) send(socket, payload);
  }

  function addOnlineConnection(socket, account) {
    let sockets = onlineConnections.get(account.handle);
    if (!sockets) {
      sockets = new Set();
      onlineConnections.set(account.handle, sockets);
    }
    sockets.add(socket);
    socket.account = account;
    socket.accountHandle = account.handle;
    socket.gameIds = new Set();
    socket.currentGameId = null;
  }

  function removeOnlineConnection(socket) {
    const sockets = onlineConnections.get(socket.accountHandle);
    sockets?.delete(socket);
    if (sockets && sockets.size === 0) onlineConnections.delete(socket.accountHandle);
  }

  function rememberActiveGame(game) {
    for (const seat of Object.values(game.players)) {
      let ids = activeGameIds.get(seat.handle);
      if (!ids) {
        ids = new Set();
        activeGameIds.set(seat.handle, ids);
      }
      ids.add(game.gameId);
    }
  }

  function forgetActiveGame(game) {
    for (const seat of Object.values(game.players)) {
      const ids = activeGameIds.get(seat.handle);
      ids?.delete(game.gameId);
      if (ids && ids.size === 0) activeGameIds.delete(seat.handle);
    }
  }

  function hasActiveGame(handle) {
    return Boolean(activeGameIds.get(handle)?.size);
  }

  function socketHasAttachedGame(socket) {
    return Boolean(socket?.gameIds?.size);
  }

  function matchmakingBucketKey(variant, timeControl) {
    return `${variant}:${timeControl.publicValue}`;
  }

  function quickMatchSeats(first, second) {
    const firstChoice = first.requestedColor || 'random';
    const secondChoice = second.requestedColor || 'random';
    let whiteEntry;
    if (firstChoice === 'white' && secondChoice !== 'white') whiteEntry = first;
    else if (secondChoice === 'white' && firstChoice !== 'white') whiteEntry = second;
    else if (firstChoice === 'black' && secondChoice !== 'black') whiteEntry = second;
    else if (secondChoice === 'black' && firstChoice !== 'black') whiteEntry = first;
    else whiteEntry = randomInt(0, 2) === 0 ? first : second;
    return {
      whiteEntry,
      blackEntry: whiteEntry === first ? second : first,
    };
  }

  function removeQuickMatch(entry) {
    if (!entry) return false;
    const bucket = matchmakingBuckets.get(entry.bucketKey);
    bucket?.delete(entry);
    if (bucket && bucket.size === 0) matchmakingBuckets.delete(entry.bucketKey);
    if (quickMatchesByHandle.get(entry.handle) === entry) quickMatchesByHandle.delete(entry.handle);
    return true;
  }

  function notifyQuickMatchFound(entry, game) {
    const color = game.players.white.handle === entry.handle ? 'white' : 'black';
    send(entry.socket, {
      type: 'quickMatchFound',
      matchId: entry.matchId,
      gameId: game.gameId,
      color,
      variant: game.variant,
      ...(game.variant === 'chess960' ? { chess960Seed: game.chess960Seed } : {}),
      timeControl: cloneTimeControl(game.timeControl),
    });
  }

  function enqueueQuickMatch(account, socket, variant, timeControl, requestedColor = 'random') {
    if (variant === 'chess960' && typeof chess.createChess960State !== 'function') {
      throw new ProtocolError('Chess960 is not available on this server.', 'VARIANT_UNAVAILABLE');
    }
    if (socketHasAttachedGame(socket) || hasActiveGame(account.handle)) {
      throw new ProtocolError('You are already in an active game.', 'ACTIVE_GAME_EXISTS');
    }
    if (quickMatchesByHandle.has(account.handle)) {
      throw new ProtocolError('You are already waiting for a quick match.', 'QUICK_MATCH_ALREADY_QUEUED');
    }

    const entry = {
      matchId: randomUUID(),
      accountId: account.id,
      handle: account.handle,
      socket,
      variant,
      timeControl,
      requestedColor,
      bucketKey: matchmakingBucketKey(variant, timeControl),
      createdAt: clockNow(),
    };
    let bucket = matchmakingBuckets.get(entry.bucketKey);
    if (!bucket) {
      bucket = new Set();
      matchmakingBuckets.set(entry.bucketKey, bucket);
    }

    let opponent = null;
    for (const candidate of bucket) {
      if (candidate.socket.readyState !== OPEN
        || quickMatchesByHandle.get(candidate.handle) !== candidate
        || hasActiveGame(candidate.handle)
        || socketHasAttachedGame(candidate.socket)) {
        removeQuickMatch(candidate);
        continue;
      }
      if (candidate.handle !== entry.handle) {
        opponent = candidate;
        break;
      }
    }

    if (!opponent) {
      bucket = matchmakingBuckets.get(entry.bucketKey);
      if (!bucket) {
        bucket = new Set();
        matchmakingBuckets.set(entry.bucketKey, bucket);
      }
      bucket.add(entry);
      quickMatchesByHandle.set(entry.handle, entry);
      send(socket, {
        type: 'quickMatchQueued',
        matchId: entry.matchId,
        variant,
        timeControl: cloneTimeControl(timeControl.publicValue),
      });
      return null;
    }

    removeQuickMatch(opponent);
    const { whiteEntry, blackEntry } = quickMatchSeats(opponent, entry);
    const game = createGame({
      variant,
      timeControl,
      whiteHandle: whiteEntry.handle,
      blackHandle: blackEntry.handle,
      whiteSocket: whiteEntry.socket,
      blackSocket: blackEntry.socket,
    }, whiteEntry.socket, blackEntry.socket, clockNow());
    notifyQuickMatchFound(entry, game);
    notifyQuickMatchFound(opponent, game);
    broadcastState(game, clockNow());
    return game;
  }

  function createVariantState(variant, requestedSeed) {
    if (variant === 'standard') return { state: createInitialState(), seed: null };
    if (typeof chess.createChess960State !== 'function') {
      throw new ProtocolError('Chess960 is not available on this server.', 'VARIANT_UNAVAILABLE');
    }
    const seed = requestedSeed === undefined ? randomInt(0, 960) : requestedSeed;
    let state;
    try {
      state = chess.createChess960State(seed);
    } catch {
      try {
        state = chess.createChess960State({ seed });
      } catch {
        throw new ProtocolError('Chess960 could not be initialized safely.', 'VARIANT_UNAVAILABLE');
      }
    }
    if (!state || !Array.isArray(state.board) || state.board.length !== 64 || !state.positionCounts) {
      throw new ProtocolError('Chess960 could not be initialized safely.', 'VARIANT_UNAVAILABLE');
    }
    return { state, seed };
  }

  function createGame(gameSpec, firstSocket, secondSocket, at) {
    const variantState = createVariantState(gameSpec.variant, gameSpec.chess960Seed);
    let whiteHandle = gameSpec.whiteHandle ?? gameSpec.fromHandle;
    let blackHandle = gameSpec.blackHandle ?? gameSpec.toHandle;
    if (!gameSpec.whiteHandle && gameSpec.fromHandle && gameSpec.toHandle) {
      const inviterColor = gameSpec.requestedColor === 'black'
        ? 'black'
        : gameSpec.requestedColor === 'random'
          ? (randomInt(0, 2) === 0 ? 'white' : 'black')
          : 'white';
      whiteHandle = inviterColor === 'white' ? gameSpec.fromHandle : gameSpec.toHandle;
      blackHandle = inviterColor === 'white' ? gameSpec.toHandle : gameSpec.fromHandle;
    }
    const whiteAccount = authStore.accountByHandle(whiteHandle);
    const blackAccount = authStore.accountByHandle(blackHandle);
    if (!whiteAccount || !blackAccount) throw new ProtocolError('The invited account is unavailable.', 'INVITE_UNAVAILABLE');
    const whiteSocket = gameSpec.whiteSocket
      ?? (whiteHandle === gameSpec.fromHandle ? firstSocket : secondSocket);
    const blackSocket = gameSpec.blackSocket
      ?? (blackHandle === gameSpec.fromHandle ? firstSocket : secondSocket);
    const game = {
      gameId: randomUUID(),
      variant: gameSpec.variant,
      chess960Seed: gameSpec.variant === 'chess960' ? variantState.seed : null,
      state: variantState.state,
      timeControl: cloneTimeControl(gameSpec.timeControl.publicValue),
      control: {
        initialMs: gameSpec.timeControl.initialMs,
        incrementMs: gameSpec.timeControl.incrementMs,
      },
      clocks: {
        white: gameSpec.timeControl.initialMs,
        black: gameSpec.timeControl.initialMs,
      },
      clockStamp: at,
      clockRunning: true,
      players: {
        white: {
          color: 'white',
          accountId: whiteAccount.id,
          handle: whiteAccount.handle,
          displayName: whiteAccount.displayName,
          socket: null,
          token: randomBytes(32).toString('base64url'),
        },
        black: {
          color: 'black',
          accountId: blackAccount.id,
          handle: blackAccount.handle,
          displayName: blackAccount.displayName,
          socket: null,
          token: randomBytes(32).toString('base64url'),
        },
      },
      result: null,
      drawOffer: null,
      rematchVotes: new Set(),
      roomState: 'playing',
      revision: 0,
      createdAt: at,
      lastActivity: at,
      closed: false,
    };
    games.set(game.gameId, game);
    rememberActiveGame(game);

    attachSeat(game, game.players.white, whiteSocket);
    attachSeat(game, game.players.black, blackSocket);
    return game;
  }

  function attachSeat(game, seat, socket) {
    if (!socket || socket.readyState !== OPEN || socket.accountHandle !== seat.handle) return false;
    if (seat.socket && seat.socket !== socket) return false;
    seat.socket = socket;
    socket.gameIds.add(game.gameId);
    socket.currentGameId = game.gameId;
    game.lastActivity = clockNow();
    game.revision += 1;
    return true;
  }

  function detachSeat(game, seat, socket) {
    if (seat.socket !== socket) return;
    seat.socket = null;
    socket.gameIds?.delete(game.gameId);
    if (socket.currentGameId === game.gameId) socket.currentGameId = null;
  }

  function playerSnapshot(game, color) {
    const player = game.players[color];
    return {
      color,
      handle: player.handle,
      displayName: player.displayName,
      connected: Boolean(player.socket && player.socket.readyState === OPEN),
    };
  }

  function statusFor(game) {
    const rules = getGameStatus(game.state);
    if (game.result) {
      return {
        phase: game.result.phase,
        winner: game.result.winner,
        drawReason: game.result.drawReason,
        reason: game.result.reason,
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

  function gameSnapshot(game, viewer = null) {
    const status = statusFor(game);
    const viewerSeat = viewer && game.players[viewer.color] === viewer ? viewer : null;
    return {
      type: 'state',
      gameId: game.gameId,
      you: viewerSeat?.color || null,
      // A reconnect token is a private capability and is sent only to its seat.
      token: viewerSeat?.token || null,
      variant: game.variant,
      ...(game.variant === 'chess960' ? { chess960Seed: game.chess960Seed } : {}),
      fen: toFEN(game.state),
      history: game.state.history.map((entry) => ({ ...entry })),
      lastMove: game.state.lastMove ? { ...game.state.lastMove } : null,
      turn: game.state.turn === chess.WHITE ? 'white' : 'black',
      phase: status.phase,
      winner: status.winner || null,
      drawReason: status.drawReason || null,
      reason: status.reason || null,
      inCheck: status.inCheck,
      clocks: { ...game.clocks },
      timeControl: cloneTimeControl(game.timeControl),
      players: [playerSnapshot(game, 'white'), playerSnapshot(game, 'black')],
      ready: Boolean(game.players.white && game.players.black),
      revision: game.revision,
      gameState: game.roomState,
      result: resultForGame(game),
      claimableDraws: status.claimableDraws,
      drawOffer: game.drawOffer,
      rematchVotes: [...game.rematchVotes],
    };
  }

  function broadcastGame(game, payloadFactory) {
    if (game.closed) return;
    for (const color of PLAYER_COLORS) {
      const player = game.players[color];
      if (!player?.socket) continue;
      const payload = typeof payloadFactory === 'function' ? payloadFactory(player) : payloadFactory;
      send(player.socket, payload);
    }
  }

  function broadcastState(game, at = clockNow()) {
    if (game.closed) return;
    settleClock(game, at);
    broadcastGame(game, (player) => gameSnapshot(game, player));
  }

  function broadcastClock(game, at = clockNow()) {
    if (game.closed) return;
    settleClock(game, at);
    if (game.result || !game.clockRunning) return;
    broadcastGame(game, {
      type: 'clock',
      gameId: game.gameId,
      clocks: { ...game.clocks },
      turn: game.state.turn === chess.WHITE ? 'white' : 'black',
      revision: game.revision,
    });
  }

  function setResult(game, result, at, bumpRevision = true) {
    if (game.result) return false;
    game.result = normalizedResult(result, {
      phase: 'draw',
      winner: null,
      drawReason: null,
      reason: null,
    });
    const outcome = game.result.winner || null;
    game.result.ratings = recordRatings(authStore, game, outcome);
    game.roomState = 'finished';
    game.clockRunning = false;
    game.clockStamp = at;
    game.drawOffer = null;
    game.rematchVotes.clear();
    game.lastActivity = at;
    forgetActiveGame(game);
    if (bumpRevision) game.revision += 1;
    return true;
  }

  function finishFromRules(game, rules, at) {
    if (!rules || rules.phase === 'playing') return false;
    return setResult(game, {
      phase: rules.phase,
      winner: colorName(rules.winner),
      drawReason: rules.drawReason || null,
      reason: rules.drawReason || null,
    }, at, false);
  }

  function settleClock(game, at) {
    if (!game.clockRunning || game.result || !game.players.white || !game.players.black) {
      game.clockStamp = at;
      return false;
    }
    const elapsed = Math.max(0, at - game.clockStamp);
    game.clockStamp = at;
    if (elapsed <= 0) return false;
    const turn = game.state.turn === chess.WHITE ? 'white' : 'black';
    game.clocks[turn] = Math.max(0, game.clocks[turn] - elapsed);
    if (game.clocks[turn] <= 0) {
      game.clocks[turn] = 0;
      setResult(game, timeoutResultFor(game, turn), at, true);
      return true;
    }
    return false;
  }

  function gameReadinessError(game) {
    if (!game?.players.white || !game?.players.black) return 'Waiting for the other player.';
    if (game.result) return 'This game has already ended.';
    return null;
  }

  function applyServerMove(game, player, uci) {
    const readyError = gameReadinessError(game);
    if (readyError) return { error: readyError };
    const expectedColor = game.state.turn === chess.WHITE ? 'white' : 'black';
    if (player.color !== expectedColor) return { error: 'It is not your turn.' };
    const move = uciToMove(game.state, uci);
    if (!move) return { error: 'That move is not legal in the current position.' };

    // Legal move generation is synchronous, but settle once more at commit so
    // validation time is also authoritative game time.
    const commitAt = clockNow();
    if (settleClock(game, commitAt)) {
      broadcastState(game, commitAt);
      return { error: 'The game ended on time before that move was accepted.', timedOut: true };
    }
    game.state = applyMove(game.state, move, { record: true });
    game.clocks[player.color] += game.control.incrementMs;
    game.clockStamp = commitAt;
    game.lastActivity = commitAt;
    if (game.drawOffer === otherColor(player.color)) game.drawOffer = null;
    game.revision += 1;
    finishFromRules(game, getGameStatus(game.state), commitAt);
    return { move: moveToUci(move) };
  }

  function prepareGameAction(game) {
    const at = clockNow();
    if (settleClock(game, at)) {
      broadcastState(game, at);
      return null;
    }
    return at;
  }

  function resetForRematch(game, at) {
    const variantState = createVariantState(game.variant, game.chess960Seed);
    game.state = variantState.state;
    if (game.variant === 'chess960') game.chess960Seed = variantState.seed;
    game.clocks = {
      white: game.control.initialMs,
      black: game.control.initialMs,
    };
    game.clockStamp = at;
    game.clockRunning = true;
    game.result = null;
    game.drawOffer = null;
    game.rematchVotes.clear();
    game.roomState = 'playing';
    game.lastActivity = at;
    game.revision += 1;
    rememberActiveGame(game);
  }

  function currentGameForSocket(socket, requireActive = false) {
    const candidates = [...(socket.gameIds || [])]
      .map((gameId) => games.get(gameId))
      .filter((game) => game && !game.closed && (!requireActive || !game.result));
    if (candidates.length === 1) return candidates[0];
    if (socket.currentGameId) {
      const selected = games.get(socket.currentGameId);
      if (selected && !selected.closed && (!requireActive || !selected.result)) return selected;
    }
    if (candidates.length > 1) throw new ProtocolError('This connection has more than one game; reconnect one game explicitly.', 'GAME_SELECTION_REQUIRED');
    return null;
  }

  function seatForSocket(game, socket) {
    for (const color of PLAYER_COLORS) {
      const player = game.players[color];
      if (player.socket === socket && player.accountId === socket.account.id) return player;
    }
    return null;
  }

  function notifyPendingInvites(socket) {
    const nowStamp = clockNow();
    for (const invite of invites.values()) {
      if (invite.expiresAt <= nowStamp) continue;
      if (invite.toHandle !== socket.accountHandle) continue;
      send(socket, {
        type: 'friendInvite',
        inviteId: invite.inviteId,
        from: {
          handle: invite.fromHandle,
          displayName: invite.fromDisplayName,
        },
        variant: invite.variant,
        ...(invite.variant === 'chess960' ? { chess960Seed: invite.chess960Seed } : {}),
        color: invite.requestedColor,
        timeControl: cloneTimeControl(invite.timeControl.publicValue),
      });
    }
  }

  function notifyReconnectableGames(socket) {
    for (const game of games.values()) {
      if (game.closed) continue;
      for (const color of PLAYER_COLORS) {
        const player = game.players[color];
        if (player.handle !== socket.accountHandle || player.socket) continue;
        send(socket, {
          type: 'friendGameAvailable',
          gameId: game.gameId,
          token: player.token,
          variant: game.variant,
          ...(game.variant === 'chess960' ? { chess960Seed: game.chess960Seed } : {}),
          timeControl: cloneTimeControl(game.timeControl),
          finished: Boolean(game.result),
        });
      }
    }
  }

  function closeGame(game, reason = 'Game expired') {
    if (game.closed) return;
    game.closed = true;
    games.delete(game.gameId);
    forgetActiveGame(game);
    for (const color of PLAYER_COLORS) {
      const player = game.players[color];
      if (!player?.socket) continue;
      const socket = player.socket;
      detachSeat(game, player, socket);
      closeSocket(socket, 1000, reason);
    }
  }

  function expireInactiveData(at) {
    authStore.pruneExpiredSessions();
    for (const [inviteId, invite] of invites) {
      if (invite.expiresAt <= at) {
        invites.delete(inviteId);
        notifyAccount(invite.fromHandle, { type: 'friendInviteExpired', inviteId });
        notifyAccount(invite.toHandle, { type: 'friendInviteExpired', inviteId });
      }
    }
    for (const game of games.values()) {
      if (game.closed) continue;
      const timedOut = settleClock(game, at);
      if (timedOut) broadcastState(game, at);
      const activeGame = !game.result;
      if (!activeGame && at - game.lastActivity > gameTtlMs) {
        closeGame(game);
        continue;
      }
      if (!game.result && game.clockRunning) broadcastClock(game, at);
    }
  }

  function onlineFriendList(account) {
    const list = authStore.friendList(account);
    return {
      friends: list.friends.map((friend) => ({
        ...friend,
        online: accountIsOnline(friend.handle),
      })),
      incomingRequests: list.incomingRequests,
      outgoingRequests: list.outgoingRequests,
    };
  }

  function requireHttpAccount(request) {
    const account = authStore.authenticateRequest(request);
    if (!account) throw new HttpError('Authentication required.', 401, 'AUTH_REQUIRED');
    return account;
  }

  async function handleApi(request, response) {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname;
    const ip = request.socket.remoteAddress || 'unknown';
    const route = `${request.method || 'GET'} ${pathname}`;

    try {
      if (pathname === '/api/auth/signup') {
        if (request.method !== 'POST') {
          responseBody(response, 405, { allow: 'POST', 'content-type': 'text/plain; charset=utf-8' }, 'Method Not Allowed');
          return true;
        }
        const result = authStore.signup(await readJsonBody(request), { ip });
        jsonResponse(response, 201, { account: result.account, user: result.account }, { 'set-cookie': result.session.setCookie });
        return true;
      }

      if (pathname === '/api/auth/login') {
        if (request.method !== 'POST') {
          responseBody(response, 405, { allow: 'POST', 'content-type': 'text/plain; charset=utf-8' }, 'Method Not Allowed');
          return true;
        }
        try {
          const result = authStore.login(await readJsonBody(request), { ip });
          jsonResponse(response, 200, { account: result.account, user: result.account }, { 'set-cookie': result.session.setCookie });
        } catch (error) {
          // Wrong passwords and unknown handles intentionally take the same
          // response path and message. No credential detail is returned.
          throw error;
        }
        return true;
      }

      if (pathname === '/api/auth/logout') {
        if (request.method !== 'POST') {
          responseBody(response, 405, { allow: 'POST', 'content-type': 'text/plain; charset=utf-8' }, 'Method Not Allowed');
          return true;
        }
        const body = await readJsonBody(request);
        if (!isPlainObject(body) || Object.keys(body).length) throw new HttpError('Request body must be empty.', 400, 'INVALID_SCHEMA');
        jsonResponse(response, 200, { ok: true }, { 'set-cookie': authStore.logout(request) });
        return true;
      }

      if (pathname === '/api/me') {
        if (request.method !== 'GET') {
          responseBody(response, 405, { allow: 'GET', 'content-type': 'text/plain; charset=utf-8' }, 'Method Not Allowed');
          return true;
        }
        const account = requireHttpAccount(request);
        const publicAccount = authStore.publicAccount(account);
        jsonResponse(response, 200, { account: publicAccount, user: publicAccount });
        return true;
      }

      if (pathname === '/api/friends/request') {
        if (request.method !== 'POST') {
          responseBody(response, 405, { allow: 'POST', 'content-type': 'text/plain; charset=utf-8' }, 'Method Not Allowed');
          return true;
        }
        const account = requireHttpAccount(request);
        const body = await readJsonBody(request);
        const requestKeys = isPlainObject(body) ? Object.keys(body) : [];
        const hasHandle = isPlainObject(body) && typeof body.handle === 'string';
        const hasToHandle = isPlainObject(body) && typeof body.toHandle === 'string';
        if (requestKeys.length !== 1 || (!hasHandle && !hasToHandle)) {
          throw new HttpError('Request must contain only handle.', 400, 'INVALID_SCHEMA');
        }
        const created = authStore.requestFriend(account, hasHandle ? body.handle : body.toHandle, { ip });
        const responseRequest = {
          ...publicRequest(created.request),
          handle: created.to.handle,
          toHandle: created.to.handle,
        };
        notifyAccount(created.to.handle, {
          type: 'friendRequest',
          request: {
            requestId: created.request.requestId,
            from: authStore.publicAccount(created.from),
          },
        });
        jsonResponse(response, 201, { request: responseRequest });
        return true;
      }

      if (pathname === '/api/friends/respond') {
        if (request.method !== 'POST') {
          responseBody(response, 405, { allow: 'POST', 'content-type': 'text/plain; charset=utf-8' }, 'Method Not Allowed');
          return true;
        }
        const account = requireHttpAccount(request);
        const body = await readJsonBody(request);
        if (!isPlainObject(body) || Object.keys(body).length !== 2
          || typeof body.requestId !== 'string' || typeof body.accept !== 'boolean') {
          throw new HttpError('Request must contain requestId and accept.', 400, 'INVALID_SCHEMA');
        }
        const result = authStore.respondFriend(account, body.requestId, body.accept, { ip });
        if (result.accepted) {
          const friend = authStore.publicAccount(result.from);
          notifyAccount(result.from.handle, {
            type: 'friendRequestResponded',
            requestId: result.request.requestId,
            accepted: true,
            friend: authStore.publicAccount(result.to),
          });
          notifyAccount(result.to.handle, {
            type: 'friendRequestResponded',
            requestId: result.request.requestId,
            accepted: true,
            friend,
          });
        }
        jsonResponse(response, 200, {
          request: {
            requestId: result.request.requestId,
            accepted: result.accepted,
          },
          friend: result.accepted ? authStore.publicAccount(result.from) : null,
        });
        return true;
      }

      if (pathname === '/api/friends') {
        if (request.method !== 'GET') {
          responseBody(response, 405, { allow: 'GET', 'content-type': 'text/plain; charset=utf-8' }, 'Method Not Allowed');
          return true;
        }
        const account = requireHttpAccount(request);
        jsonResponse(response, 200, onlineFriendList(account));
        return true;
      }

      if (pathname.startsWith('/api/')) {
        jsonResponse(response, 404, { error: { code: 'NOT_FOUND', message: 'Not found.' } });
        return true;
      }
      return false;
    } catch (error) {
      if (error instanceof AuthError || error instanceof HttpError) {
        const status = error.status || 400;
        const headers = status === 429 && error.retryAfterMs
          ? { 'retry-after': String(Math.ceil(error.retryAfterMs / 1_000)) }
          : {};
        jsonResponse(response, status, {
          error: {
            code: error.code || 'REQUEST_REJECTED',
            message: error.message,
          },
        }, headers);
        return true;
      }
      // Do not return exception text: it could contain implementation or
      // request data. The request body and credentials are never logged.
      if (!response.writableEnded) jsonResponse(response, 500, {
        error: { code: 'REQUEST_FAILED', message: 'The server could not process that request.' },
      });
      return true;
    }
  }

  const server = http.createServer((request, response) => {
    const pathname = (request.url || '/').split('?')[0];
    if (pathname.startsWith('/api/')) {
      void handleApi(request, response);
      return;
    }
    void serveFile(request, response);
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: maxPayloadBytes });

  const clockTimer = setInterval(() => expireInactiveData(clockNow()), clockIntervalMs);
  clockTimer.unref?.();

  server.on('upgrade', (request, socket, head) => {
    if (!sameOrigin(request)) {
      rejectUpgrade(socket, 403, 'Forbidden');
      return;
    }
    const account = authStore.authenticateRequest(request);
    if (!account) {
      rejectUpgrade(socket, 401, 'Unauthorized');
      return;
    }
    wss.handleUpgrade(request, socket, head, (client) => {
      wss.emit('connection', client, request, account);
    });
  });

  wss.on('connection', (socket, request, account) => {
    addOnlineConnection(socket, account);
    send(socket, {
      type: 'ready',
      account: authStore.publicAccount(account),
    });
    notifyPendingInvites(socket);
    notifyReconnectableGames(socket);

    socket.on('error', () => {
      // ws emits errors for malformed frames and terminated peers. The close
      // handler owns account and game membership cleanup.
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
          send(socket, { type: 'pong' });
          return;
        }

        if (message.type === 'quickMatch') {
          const variant = parseVariant(message.variant);
          const timeControl = parseQuickMatchTimeControl(message.timeControl);
          enqueueQuickMatch(account, socket, variant, timeControl, message.color || 'random');
          return;
        }

        if (message.type === 'cancelQuickMatch' || message.type === 'quickCancel') {
          const entry = quickMatchesByHandle.get(account.handle);
          if (!entry) throw new ProtocolError('You are not waiting for a quick match.', 'QUICK_MATCH_NOT_FOUND');
          if (message.matchId !== undefined && message.matchId !== entry.matchId) {
            throw new ProtocolError('That quick match is no longer available.', 'QUICK_MATCH_NOT_FOUND');
          }
          removeQuickMatch(entry);
          send(socket, {
            type: 'quickMatchCancelled',
            matchId: entry.matchId,
            variant: entry.variant,
            timeControl: cloneTimeControl(entry.timeControl.publicValue),
          });
          return;
        }

        if (message.type === 'friendInvite') {
          const toHandle = normalizeHandle(message.toHandle);
          const to = authStore.accountByHandle(toHandle);
          if (!to || to.handle === account.handle || !authStore.areFriends(account, to)) {
            throw new ProtocolError('You can invite accepted friends only.', 'FRIEND_REQUIRED');
          }
          if (socketHasAttachedGame(socket) || hasActiveGame(account.handle) || hasActiveGame(to.handle)) {
            throw new ProtocolError('One of the players is already in an active game.', 'ACTIVE_GAME_EXISTS');
          }
          const variant = parseVariant(message.variant);
          if (variant === 'chess960' && typeof chess.createChess960State !== 'function') {
            throw new ProtocolError('Chess960 is not available on this server.', 'VARIANT_UNAVAILABLE');
          }
          const timeControl = parseTimeControl(message.timeControl);
          const chess960Seed = variant === 'chess960'
            ? (message.chess960Seed === undefined ? randomInt(0, 960) : message.chess960Seed)
            : null;
      const invite = {
            inviteId: randomUUID(),
            fromHandle: account.handle,
            fromDisplayName: account.displayName,
            toHandle: to.handle,
        variant,
        chess960Seed,
        requestedColor: message.color || 'white',
        timeControl,
            senderSocket: socket,
            createdAt: clockNow(),
            expiresAt: clockNow() + inviteTtlMs,
          };
          invites.set(invite.inviteId, invite);
          send(socket, {
            type: 'friendInviteSent',
            inviteId: invite.inviteId,
            toHandle: invite.toHandle,
            variant: invite.variant,
            ...(variant === 'chess960' ? { chess960Seed } : {}),
            color: invite.requestedColor,
            timeControl: cloneTimeControl(timeControl.publicValue),
          });
          notifyAccount(to.handle, {
            type: 'friendInvite',
            inviteId: invite.inviteId,
            from: {
              handle: account.handle,
              displayName: account.displayName,
            },
            variant: invite.variant,
            ...(variant === 'chess960' ? { chess960Seed } : {}),
            color: invite.requestedColor,
            timeControl: cloneTimeControl(timeControl.publicValue),
          });
          return;
        }

        if (message.type === 'friendInviteRespond') {
          const invite = invites.get(message.inviteId);
          if (!invite || invite.expiresAt <= clockNow()) {
            invites.delete(message.inviteId);
            throw new ProtocolError('That invitation is no longer available.', 'INVITE_NOT_FOUND');
          }
          if (invite.toHandle !== account.handle) {
            throw new ProtocolError('You are not authorized to respond to that invitation.', 'INVITE_NOT_AUTHORIZED');
          }
          invites.delete(invite.inviteId);
          if (!message.accept) {
            notifyAccount(invite.fromHandle, { type: 'friendInviteDeclined', inviteId: invite.inviteId });
            send(socket, { type: 'friendInviteDeclined', inviteId: invite.inviteId });
            return;
          }
          const inviter = authStore.accountByHandle(invite.fromHandle);
          if (!inviter || !authStore.areFriends(inviter, account)) {
            throw new ProtocolError('The invitation requires an accepted friendship.', 'FRIEND_REQUIRED');
          }
          if (hasActiveGame(inviter.handle) || hasActiveGame(account.handle)) {
            throw new ProtocolError('One of the players is already in an active game.', 'ACTIVE_GAME_EXISTS');
          }
          if (socketHasAttachedGame(socket) || (invite.senderSocket && socketHasAttachedGame(invite.senderSocket))) {
            throw new ProtocolError('One of the players is already connected to a finished game.', 'GAME_ALREADY_ATTACHED');
          }
          const senderSocket = invite.senderSocket?.readyState === OPEN ? invite.senderSocket : null;
           const game = createGame(invite, senderSocket, socket, clockNow());
          send(socket, {
            type: 'friendInviteAccepted',
            inviteId: invite.inviteId,
            gameId: game.gameId,
          });
          notifyAccount(invite.fromHandle, {
            type: 'friendInviteAccepted',
            inviteId: invite.inviteId,
            gameId: game.gameId,
          });
          broadcastState(game, clockNow());
          return;
        }

        if (message.type === 'friendReconnect') {
          const game = games.get(message.gameId);
          if (!game || game.closed) throw new ProtocolError('That game is not available.', 'GAME_NOT_FOUND');
          let seat = null;
          for (const color of PLAYER_COLORS) {
            const candidate = game.players[color];
            if (candidate.accountId === account.id) {
              seat = candidate;
              break;
            }
          }
          if (!seat || !tokenMatches(message.token, seat.token)) {
            throw new ProtocolError('That reconnect token is invalid.', 'INVALID_RECONNECT_TOKEN');
          }
          if (seat.socket && seat.socket !== socket) {
            throw new ProtocolError('That game seat is already connected.', 'RECONNECT_TOKEN_IN_USE');
          }
          attachSeat(game, seat, socket);
          game.lastActivity = clockNow();
          game.revision += 1;
          send(socket, {
            type: 'friendReconnected',
            gameId: game.gameId,
            color: seat.color,
            token: seat.token,
          });
          broadcastState(game, clockNow());
          return;
        }

        const game = currentGameForSocket(socket);
        if (!game) throw new ProtocolError('Connect to a friend game before sending that action.', 'GAME_REQUIRED');
        const player = seatForSocket(game, socket);
        if (!player) throw new ProtocolError('This connection is not authorized for that game.', 'NOT_AUTHORIZED');

        if (message.type === 'friendRematch') {
          if (!game.result) throw new ProtocolError('A rematch is available only after the game ends.', 'REMATCH_NOT_AVAILABLE');
          if (!game.rematchVotes.has(player.color)) {
            game.rematchVotes.add(player.color);
            game.lastActivity = clockNow();
            game.revision += 1;
          }
          if (game.rematchVotes.size === PLAYER_COLORS.length) resetForRematch(game, clockNow());
          broadcastState(game, clockNow());
          return;
        }

        const actionAt = prepareGameAction(game);
        if (actionAt === null) {
          sendError(socket, 'The game has ended because the active clock reached zero.', 'GAME_FINISHED');
          return;
        }
        const readinessError = gameReadinessError(game);
        if (readinessError) {
          sendError(socket, readinessError, game.result ? 'GAME_FINISHED' : 'WAITING_FOR_PLAYER');
          return;
        }

        if (message.type === 'friendMove') {
          const result = applyServerMove(game, player, message.uci);
          if (result.error) {
            sendError(socket, result.error, result.timedOut ? 'GAME_FINISHED' : 'MOVE_REJECTED');
            return;
          }
          broadcastState(game, clockNow());
          return;
        }

        if (message.type === 'friendResign') {
          setResult(game, {
            phase: 'resigned',
            winner: otherColor(player.color),
            drawReason: null,
            reason: `${player.color} resigned`,
          }, actionAt, true);
          broadcastState(game, actionAt);
          return;
        }

        if (message.type === 'friendDrawOffer') {
          if (game.drawOffer === player.color) {
            sendError(socket, 'You already have a draw offer pending.', 'DRAW_OFFER_PENDING');
            return;
          }
          if (game.drawOffer) {
            sendError(socket, 'A draw offer is already pending for the other player.', 'DRAW_OFFER_PENDING');
            return;
          }
          game.drawOffer = player.color;
          game.lastActivity = actionAt;
          game.revision += 1;
          broadcastState(game, actionAt);
          return;
        }

        if (message.type === 'friendDrawAccept') {
          if (!game.drawOffer) {
            sendError(socket, 'There is no draw offer to accept.', 'NO_DRAW_OFFER');
            return;
          }
          if (game.drawOffer === player.color) {
            sendError(socket, 'The player who made the offer cannot accept it.', 'DRAW_OFFER_SELF_ACCEPT');
            return;
          }
          setResult(game, {
            phase: 'draw',
            winner: null,
            drawReason: 'agreement',
            reason: 'draw by agreement',
          }, actionAt, true);
          broadcastState(game, actionAt);
          return;
        }

        throw new ProtocolError('Unsupported action.', 'INVALID_MESSAGE');
      } catch (error) {
        const safeError = authProtocolError(error);
        if (safeError instanceof ProtocolError) sendError(socket, safeError.message, safeError.code);
        else sendError(socket, 'The server could not process that action.', 'REQUEST_FAILED');
      }
    });

    socket.on('close', () => {
      removeQuickMatch(quickMatchesByHandle.get(socket.accountHandle));
      removeOnlineConnection(socket);
      for (const game of games.values()) {
        for (const color of PLAYER_COLORS) {
          const player = game.players[color];
          if (player?.socket === socket) {
            detachSeat(game, player, socket);
            game.lastActivity = clockNow();
            game.revision += 1;
            broadcastState(game, clockNow());
          }
        }
      }
    });
  });

  let closePromise = null;
  function close(callback) {
    if (!closePromise) {
      closePromise = new Promise((resolve) => {
        clearInterval(clockTimer);
        for (const entry of [...quickMatchesByHandle.values()]) removeQuickMatch(entry);
        matchmakingBuckets.clear();
        for (const game of [...games.values()]) closeGame(game, 'Server shutting down');
        games.clear();
        invites.clear();
        for (const client of wss.clients) closeSocket(client, 1001, 'Server shutting down');

        const finish = () => {
          try {
            authStore.close?.();
          } catch {
            // The server is already shutting down; do not leave the close callback pending.
          }
          resolve();
        };
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
    // `games` is the internal game registry. It contains opaque game IDs;
    // there is no public room-code registry or create/join protocol.
    games,
    invites,
    matchmakingBuckets,
    quickMatchesByHandle,
    onlineConnections,
    activeGameIds,
    authStore,
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
      .catch(() => {
        process.exitCode = 1;
      });
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  app.server.listen(PORT, HOST, () => {
    const address = app.server.address();
    const boundPort = typeof address === 'object' && address ? address.port : PORT;
    console.log(`Nova Chess server running at http://${HOST}:${boundPort}`);
    console.log(`Authenticated friend WebSocket available at ws://${HOST}:${boundPort}`);
  });
}
