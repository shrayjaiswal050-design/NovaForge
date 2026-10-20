import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_RATING,
  RATING_SPEEDS,
  RATING_VARIANTS,
  ratingCategory,
  updateElo,
} from './rating.js';

export const SESSION_COOKIE_NAME = 'nova_chess_session';
export const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 24;
export const DISPLAY_NAME_MAX_LENGTH = 40;
export const DEFAULT_AUTH_DB_PATH = './data/nova-chess.sqlite';

const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_SCRYPT_OPTIONS = Object.freeze({
  N: 16_384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
});
const DUMMY_PASSWORD = 'invalid-login-password';
const DUMMY_SALT = Buffer.from('nova-chess-dummy-salt', 'utf8');
const DUMMY_PASSWORD_HASH = scryptSync(DUMMY_PASSWORD, DUMMY_SALT, PASSWORD_KEY_LENGTH, PASSWORD_SCRYPT_OPTIONS);
const CONTROL_OR_FORMAT_CHARACTERS = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}]/gu;
const UNSAFE_DISPLAY_CHARACTERS = /[^\p{L}\p{M}\p{N} _.\-]/gu;
const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9_]{2,23})$/;
const COOKIE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export class AuthError extends Error {
  constructor(message, code = 'AUTH_REQUEST_REJECTED', status = 400) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
  }
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertSchema(value, allowedKeys, requiredKeys = []) {
  if (!isPlainObject(value)) throw new AuthError('Request body must be a JSON object.', 'INVALID_SCHEMA', 400);
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new AuthError('Request contains an unsupported field.', 'INVALID_SCHEMA', 400);
  }
  for (const key of requiredKeys) {
    if (!Object.hasOwn(value, key)) throw new AuthError('Request is missing a required field.', 'INVALID_SCHEMA', 400);
  }
}

function assertString(value, field, minLength, maxLength) {
  if (typeof value !== 'string' || value.length < minLength || value.length > maxLength) {
    throw new AuthError(`Invalid ${field}.`, 'INVALID_SCHEMA', 400);
  }
}

export function normalizeHandle(value) {
  if (typeof value !== 'string') throw new AuthError('Invalid handle.', 'INVALID_HANDLE', 400);
  const normalized = value.normalize('NFKC').trim().toLowerCase();
  if (normalized.length < HANDLE_MIN_LENGTH || normalized.length > HANDLE_MAX_LENGTH || !HANDLE_PATTERN.test(normalized)) {
    throw new AuthError('Handle must be 3-24 lowercase letters, numbers, or underscores.', 'INVALID_HANDLE', 400);
  }
  return normalized;
}

export function normalizeDisplayName(value) {
  if (typeof value !== 'string') throw new AuthError('Invalid display name.', 'INVALID_DISPLAY_NAME', 400);
  const normalized = value
    .normalize('NFKC')
    .replace(CONTROL_OR_FORMAT_CHARACTERS, '')
    .replace(UNSAFE_DISPLAY_CHARACTERS, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!normalized || normalized.length > DISPLAY_NAME_MAX_LENGTH) {
    throw new AuthError('Display name must contain 1-40 safe characters.', 'INVALID_DISPLAY_NAME', 400);
  }
  return normalized;
}

function normalizePassword(value) {
  assertString(value, 'password', PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH);
  if (CONTROL_OR_FORMAT_CHARACTERS.test(value)) {
    CONTROL_OR_FORMAT_CHARACTERS.lastIndex = 0;
    throw new AuthError('Invalid password.', 'INVALID_SCHEMA', 400);
  }
  CONTROL_OR_FORMAT_CHARACTERS.lastIndex = 0;
  return value;
}

function passwordHash(password, salt) {
  return scryptSync(password, salt, PASSWORD_KEY_LENGTH, PASSWORD_SCRYPT_OPTIONS);
}

function hashSessionToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function authDbPath(options) {
  const configured = options.dbPath
    ?? options.databasePath
    ?? options.authDbPath
    ?? process.env.AUTH_DB_PATH;
  if (typeof configured === 'string' && configured.trim()) return configured.trim();
  if (process.env.NODE_TEST_CONTEXT
    && options.dbPath === undefined
    && options.databasePath === undefined
    && options.authDbPath === undefined) {
    return ':memory:';
  }
  return DEFAULT_AUTH_DB_PATH;
}

function isMemoryDatabase(path) {
  return path === ':memory:' || path.startsWith('file::memory:');
}

function accountFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    passwordSalt: row.password_salt,
    passwordHash: row.password_hash,
    acceptedFairPlayTerms: Boolean(row.accepted_fair_play_terms),
  };
}

function transaction(database, callback) {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // Preserve the original database error.
    }
    throw error;
  }
}

function timingSafeHashEqual(left, right) {
  if (!Buffer.isBuffer(left) || !Buffer.isBuffer(right) || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function readCookie(header, name) {
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    const value = part.slice(separator + 1).trim();
    return COOKIE_TOKEN_PATTERN.test(value) ? value : null;
  }
  return null;
}

export function sessionTokenFromRequest(request) {
  return readCookie(request?.headers?.cookie, SESSION_COOKIE_NAME);
}

export function sessionCookie(token, ttlMs, secure = false) {
  const maxAge = Math.max(1, Math.ceil(ttlMs / 1_000));
  const attributes = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function expiredSessionCookie(secure = false) {
  const attributes = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

function publicAccount(account) {
  return {
    handle: account.handle,
    displayName: account.displayName,
    acceptedFairPlayTerms: true,
    acceptedPrivacyPolicy: true,
  };
}

function rateLimitSetting(options, name, defaults) {
  const configured = options.rateLimits?.[name] || options[`${name}RateLimit`] || {};
  const max = Number.isSafeInteger(configured.max) && configured.max > 0 ? configured.max : defaults.max;
  const windowMs = Number.isFinite(configured.windowMs) && configured.windowMs > 0
    ? configured.windowMs
    : defaults.windowMs;
  return Object.freeze({ max, windowMs });
}

function rateLimited(message, retryAfterMs) {
  const error = new AuthError(message, 'RATE_LIMITED', 429);
  error.retryAfterMs = retryAfterMs;
  return error;
}

export class AuthStore {
  constructor(options = {}) {
    this.now = typeof options.now === 'function' ? options.now : () => Date.now();
    this.sessionTtlMs = Number.isFinite(options.sessionTtlMs) && options.sessionTtlMs > 0
      ? options.sessionTtlMs
      : DEFAULT_SESSION_TTL_MS;
    this.secureCookies = Boolean(options.secureCookies);
    this.dbPath = authDbPath(options);
    if (!isMemoryDatabase(this.dbPath)) mkdirSync(dirname(this.dbPath), { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        handle TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        accepted_fair_play_terms INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_account_id_idx ON sessions(account_id);
      CREATE TABLE IF NOT EXISTS friendships (
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        friend_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (account_id, friend_account_id),
        CHECK (account_id <> friend_account_id)
      );
      CREATE TABLE IF NOT EXISTS friend_requests (
        request_id TEXT PRIMARY KEY,
        from_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        to_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        CHECK (from_account_id <> to_account_id)
      );
      CREATE INDEX IF NOT EXISTS friend_requests_to_idx ON friend_requests(to_account_id, created_at);
      CREATE INDEX IF NOT EXISTS friend_requests_from_idx ON friend_requests(from_account_id, created_at);
      CREATE TABLE IF NOT EXISTS ratings (
        handle TEXT NOT NULL,
        variant TEXT NOT NULL,
        speed TEXT NOT NULL,
        rating INTEGER NOT NULL,
        PRIMARY KEY (handle, variant, speed)
      );
    `);
    this.closed = false;
    this.accountsById = new Map();
    this.accountsByHandle = new Map();
    this.sessions = new Map();
    this.friendships = new Map();
    this.friendRequests = new Map();
    this.ratings = new Map();
    this.rateLimits = new Map();
    this.rateLimitSettings = Object.freeze({
      signup: rateLimitSetting(options, 'signup', { max: 5, windowMs: 60 * 60 * 1000 }),
      login: rateLimitSetting(options, 'login', { max: 12, windowMs: 15 * 60 * 1000 }),
      friendRequest: rateLimitSetting(options, 'friendRequest', { max: 30, windowMs: 60 * 1000 }),
      friendRespond: rateLimitSetting(options, 'friendRespond', { max: 60, windowMs: 60 * 1000 }),
    });
    this.hydrateCaches();
  }

  close() {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }

  cacheAccount(account) {
    if (!account) return null;
    this.accountsById.set(account.id, account);
    this.accountsByHandle.set(account.handle, account);
    if (!this.friendships.has(account.handle)) this.friendships.set(account.handle, new Set());
    return account;
  }

  accountFromDatabase(row) {
    if (!row) return null;
    const cached = this.accountsById.get(row.id);
    return cached || this.cacheAccount(accountFromRow(row));
  }

  hydrateCaches() {
    for (const row of this.db.prepare(`
      SELECT id, handle, display_name, password_salt, password_hash,
        accepted_fair_play_terms
      FROM accounts
    `).all()) {
      this.cacheAccount(accountFromRow(row));
    }
    for (const row of this.db.prepare(`
      SELECT f.account_id, f.friend_account_id
      FROM friendships f
    `).all()) {
      const account = this.accountsById.get(row.account_id);
      const friend = this.accountsById.get(row.friend_account_id);
      if (account && friend) this.friendships.get(account.handle)?.add(friend.handle);
    }
    for (const row of this.db.prepare(`
      SELECT r.request_id, r.created_at, from_account.handle AS from_handle,
        to_account.handle AS to_handle
      FROM friend_requests r
      JOIN accounts from_account ON from_account.id = r.from_account_id
      JOIN accounts to_account ON to_account.id = r.to_account_id
    `).all()) {
      this.friendRequests.set(row.request_id, {
        requestId: row.request_id,
        fromHandle: row.from_handle,
        toHandle: row.to_handle,
        createdAt: row.created_at,
      });
    }
    for (const row of this.db.prepare(`
      SELECT handle, variant, speed, rating
      FROM ratings
    `).all()) {
      this.ratings.set(this.ratingStorageKey(row.handle, `${row.variant}:${row.speed}`), Number(row.rating));
    }
    for (const row of this.db.prepare(`
      SELECT token_hash, account_id, expires_at
      FROM sessions
      WHERE expires_at > ?
    `).all(this.now())) {
      this.sessions.set(row.token_hash, {
        accountId: row.account_id,
        expiresAt: row.expires_at,
      });
    }
  }

  publicAccount(accountOrHandle) {
    const account = typeof accountOrHandle === 'string'
      ? this.accountByHandle(accountOrHandle)
      : accountOrHandle;
    return account ? publicAccount(account) : null;
  }

  accountByHandle(value) {
    let handle;
    try {
      handle = normalizeHandle(value);
    } catch {
      return null;
    }
    const cached = this.accountsByHandle.get(handle);
    if (cached) return cached;
    return this.accountFromDatabase(this.db.prepare(`
      SELECT id, handle, display_name, password_salt, password_hash,
        accepted_fair_play_terms
      FROM accounts
      WHERE handle = ?
    `).get(handle));
  }

  accountById(accountId) {
    const cached = this.accountsById.get(accountId);
    if (cached) return cached;
    return this.accountFromDatabase(this.db.prepare(`
      SELECT id, handle, display_name, password_salt, password_hash,
        accepted_fair_play_terms
      FROM accounts
      WHERE id = ?
    `).get(accountId));
  }

  consumeRateLimit(bucket, key) {
    const setting = this.rateLimitSettings[bucket];
    if (!setting) return { allowed: true, retryAfterMs: 0 };
    const now = this.now();
    const mapKey = `${bucket}:${String(key || 'unknown')}`;
    const current = this.rateLimits.get(mapKey);
    if (!current || now >= current.resetAt) {
      this.rateLimits.set(mapKey, { count: 1, resetAt: now + setting.windowMs });
      return { allowed: true, retryAfterMs: 0 };
    }
    if (current.count >= setting.max) {
      return { allowed: false, retryAfterMs: Math.max(1, current.resetAt - now) };
    }
    current.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  clearRateLimit(bucket, key) {
    this.rateLimits.delete(`${bucket}:${String(key || 'unknown')}`);
  }

  validateSignupInput(input) {
    assertSchema(input, ['handle', 'displayName', 'password', 'acceptedFairPlayTerms', 'acceptedTerms', 'acceptedPrivacyPolicy'], [
      'handle',
      'displayName',
      'password',
    ]);
    const hasFairPlayField = Object.hasOwn(input, 'acceptedFairPlayTerms');
    const hasTermsAlias = Object.hasOwn(input, 'acceptedTerms');
    if (hasFairPlayField === hasTermsAlias) {
      throw new AuthError('Fair-play terms must be accepted.', 'TERMS_REQUIRED', 400);
    }
    assertString(input.handle, 'handle', 1, HANDLE_MAX_LENGTH * 2);
    assertString(input.displayName, 'display name', 1, DISPLAY_NAME_MAX_LENGTH * 3);
    const handle = normalizeHandle(input.handle);
    const displayName = normalizeDisplayName(input.displayName);
    const password = normalizePassword(input.password);
    const acceptedFairPlayTerms = hasFairPlayField ? input.acceptedFairPlayTerms : input.acceptedTerms;
    if (acceptedFairPlayTerms !== true) {
      throw new AuthError('Fair-play terms must be accepted.', 'TERMS_REQUIRED', 400);
    }
    if (input.acceptedPrivacyPolicy !== true) {
      throw new AuthError('Privacy policy must be accepted.', 'PRIVACY_REQUIRED', 400);
    }
    return { handle, displayName, password };
  }

  validateLoginInput(input) {
    assertSchema(input, ['handle', 'password'], ['handle', 'password']);
    assertString(input.handle, 'handle', 1, HANDLE_MAX_LENGTH * 2);
    const password = normalizePassword(input.password);
    return { handle: input.handle, password };
  }

  issueSession(account) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = this.now() + this.sessionTtlMs;
    const tokenHash = hashSessionToken(token);
    this.db.prepare(`
      INSERT INTO sessions (token_hash, account_id, expires_at)
      VALUES (?, ?, ?)
    `).run(tokenHash, account.id, expiresAt);
    this.sessions.set(tokenHash, {
      accountId: account.id,
      expiresAt,
    });
    return {
      token,
      expiresAt,
      setCookie: sessionCookie(token, this.sessionTtlMs, this.secureCookies),
    };
  }

  signup(input, context = {}) {
    const validation = this.validateSignupInput(input);
    const rateKey = context.ip || 'unknown';
    const signupRate = this.consumeRateLimit('signup', rateKey);
    if (!signupRate.allowed) {
      throw rateLimited('Too many account attempts. Try again later.', signupRate.retryAfterMs);
    }
    if (this.accountByHandle(validation.handle)) {
      throw new AuthError('That handle is unavailable.', 'HANDLE_UNAVAILABLE', 409);
    }

    const account = {
      id: randomUUID(),
      handle: validation.handle,
      displayName: validation.displayName,
      passwordSalt: randomBytes(16).toString('base64url'),
      passwordHash: null,
      acceptedFairPlayTerms: true,
    };
    account.passwordHash = scryptSync(
      validation.password,
      Buffer.from(account.passwordSalt, 'base64url'),
      PASSWORD_KEY_LENGTH,
      PASSWORD_SCRYPT_OPTIONS,
    ).toString('base64url');
    try {
      const session = transaction(this.db, () => {
        this.db.prepare(`
          INSERT INTO accounts (
            id, handle, display_name, password_salt, password_hash,
            accepted_fair_play_terms, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          account.id,
          account.handle,
          account.displayName,
          account.passwordSalt,
          account.passwordHash,
          1,
          this.now(),
        );
        for (const variant of RATING_VARIANTS) {
          for (const speed of RATING_SPEEDS) {
            this.db.prepare(`
              INSERT OR IGNORE INTO ratings (handle, variant, speed, rating)
              VALUES (?, ?, ?, ?)
            `).run(account.handle, variant, speed, DEFAULT_RATING);
          }
        }
        return this.issueSession(account);
      });
      this.cacheAccount(account);
      return {
        account: publicAccount(account),
        session,
      };
    } catch (error) {
      if (String(error?.message || '').includes('UNIQUE constraint failed: accounts.handle')) {
        throw new AuthError('That handle is unavailable.', 'HANDLE_UNAVAILABLE', 409);
      }
      throw error;
    }
  }

  login(input, context = {}) {
    const validation = this.validateLoginInput(input);
    const rateKey = context.ip || 'unknown';
    const loginRate = this.consumeRateLimit('login', rateKey);
    if (!loginRate.allowed) {
      throw rateLimited('Too many login attempts. Try again later.', loginRate.retryAfterMs);
    }

    let normalizedHandle = null;
    try {
      normalizedHandle = normalizeHandle(validation.handle);
    } catch {
      // Invalid handles deliberately follow the same credential failure path.
    }
    const account = normalizedHandle ? this.accountByHandle(normalizedHandle) : null;
    const salt = account ? Buffer.from(account.passwordSalt, 'base64url') : DUMMY_SALT;
    const expected = account
      ? Buffer.from(account.passwordHash, 'base64url')
      : DUMMY_PASSWORD_HASH;
    const candidate = passwordHash(validation.password, salt);
    const valid = timingSafeHashEqual(candidate, expected);
    if (!account || !valid) {
      throw new AuthError('Invalid handle or password.', 'INVALID_CREDENTIALS', 401);
    }

    this.clearRateLimit('login', rateKey);
    const session = this.issueSession(account);
    return {
      account: publicAccount(account),
      session,
    };
  }

  authenticateRequest(request) {
    const token = sessionTokenFromRequest(request);
    if (!token) return null;
    const key = hashSessionToken(token);
    const session = this.db.prepare(`
      SELECT account_id AS accountId, expires_at AS expiresAt
      FROM sessions
      WHERE token_hash = ?
    `).get(key);
    if (!session) return null;
    if (this.now() >= session.expiresAt) {
      this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(key);
      this.sessions.delete(key);
      return null;
    }
    this.sessions.set(key, session);
    return this.accountById(session.accountId);
  }

  logout(request) {
    const token = sessionTokenFromRequest(request);
    if (token) {
      const key = hashSessionToken(token);
      this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(key);
      this.sessions.delete(key);
    }
    return expiredSessionCookie(this.secureCookies);
  }

  pruneExpiredSessions() {
    const stamp = this.now();
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(stamp);
    for (const [key, session] of this.sessions) {
      if (stamp >= session.expiresAt) this.sessions.delete(key);
    }
  }

  areFriends(first, second) {
    const firstHandle = typeof first === 'string' ? first : first?.handle;
    const secondHandle = typeof second === 'string' ? second : second?.handle;
    if (!firstHandle || !secondHandle) return false;
    const firstAccount = this.accountByHandle(firstHandle);
    const secondAccount = this.accountByHandle(secondHandle);
    if (!firstAccount || !secondAccount || firstAccount.id === secondAccount.id) return false;
    return Boolean(this.db.prepare(`
      SELECT 1
      FROM friendships
      WHERE account_id = ? AND friend_account_id = ?
    `).get(firstAccount.id, secondAccount.id));
  }

  requestFriend(fromAccount, requestedHandle, context = {}) {
    const from = typeof fromAccount === 'string'
      ? this.accountByHandle(fromAccount)
      : this.accountById(fromAccount?.id) || this.accountByHandle(fromAccount?.handle);
    const toHandle = normalizeHandle(requestedHandle);
    const to = this.accountByHandle(toHandle);
    const rateKey = context.ip || from?.handle || 'unknown';
    const requestRate = this.consumeRateLimit('friendRequest', rateKey);
    if (!requestRate.allowed) {
      throw rateLimited('Too many friend requests. Try again later.', requestRate.retryAfterMs);
    }
    if (!from || !to || from.handle === to.handle) {
      throw new AuthError('Friend request could not be created.', 'FRIEND_REQUEST_REJECTED', 400);
    }
    if (this.areFriends(from, to)) {
      throw new AuthError('You are already friends.', 'ALREADY_FRIENDS', 409);
    }
    const existingRequest = this.db.prepare(`
      SELECT request_id
      FROM friend_requests
      WHERE (from_account_id = ? AND to_account_id = ?)
        OR (from_account_id = ? AND to_account_id = ?)
      LIMIT 1
    `).get(from.id, to.id, to.id, from.id);
    if (existingRequest) {
      throw new AuthError('A friend request is already pending.', 'FRIEND_REQUEST_EXISTS', 409);
    }
    const request = {
      requestId: randomUUID(),
      fromHandle: from.handle,
      toHandle: to.handle,
      createdAt: this.now(),
    };
    this.db.prepare(`
      INSERT INTO friend_requests (request_id, from_account_id, to_account_id, created_at)
      VALUES (?, ?, ?, ?)
    `).run(request.requestId, from.id, to.id, request.createdAt);
    this.friendRequests.set(request.requestId, request);
    return {
      request: { ...request },
      from,
      to,
    };
  }

  respondFriend(account, requestId, accept, context = {}) {
    const resolvedAccount = account?.id
      ? this.accountById(account.id)
      : this.accountByHandle(account?.handle);
    if (!resolvedAccount || typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(requestId) || typeof accept !== 'boolean') {
      throw new AuthError('Invalid friend response.', 'INVALID_SCHEMA', 400);
    }
    const rateKey = context.ip || resolvedAccount.handle;
    const respondRate = this.consumeRateLimit('friendRespond', rateKey);
    if (!respondRate.allowed) {
      throw rateLimited('Too many friend responses. Try again later.', respondRate.retryAfterMs);
    }
    const requestRow = this.db.prepare(`
      SELECT request_id, from_account_id, to_account_id, created_at
      FROM friend_requests
      WHERE request_id = ?
    `).get(requestId);
    if (!requestRow || requestRow.to_account_id !== resolvedAccount.id) {
      throw new AuthError('Friend request not found.', 'FRIEND_REQUEST_NOT_FOUND', 404);
    }
    const from = this.accountById(requestRow.from_account_id);
    const to = this.accountById(requestRow.to_account_id);
    if (!from || !to) throw new AuthError('Friend request not found.', 'FRIEND_REQUEST_NOT_FOUND', 404);
    const request = {
      requestId: requestRow.request_id,
      fromHandle: from.handle,
      toHandle: to.handle,
      createdAt: requestRow.created_at,
    };
    transaction(this.db, () => {
      this.db.prepare('DELETE FROM friend_requests WHERE request_id = ?').run(requestId);
      if (accept) {
        this.db.prepare(`
          INSERT OR IGNORE INTO friendships (account_id, friend_account_id, created_at)
          VALUES (?, ?, ?), (?, ?, ?)
        `).run(from.id, to.id, request.createdAt, to.id, from.id, request.createdAt);
      }
    });
    this.friendRequests.delete(requestId);
    if (accept) {
      this.friendships.get(from.handle)?.add(to.handle);
      this.friendships.get(to.handle)?.add(from.handle);
    }
    return {
      request: { ...request, accepted: accept },
      from,
      to,
      accepted: accept,
    };
  }

  friendList(account) {
    const resolvedAccount = account?.id
      ? this.accountById(account.id)
      : this.accountByHandle(account?.handle);
    if (!resolvedAccount) return { friends: [], incomingRequests: [], outgoingRequests: [] };
    const friends = this.db.prepare(`
      SELECT a.id, a.handle, a.display_name, a.password_salt, a.password_hash,
        a.accepted_fair_play_terms
      FROM friendships f
      JOIN accounts a ON a.id = f.friend_account_id
      WHERE f.account_id = ?
      ORDER BY a.handle ASC
    `).all(resolvedAccount.id).map((row) => publicAccount(this.accountFromDatabase(row)));
    const incomingRequests = [];
    const outgoingRequests = [];
    for (const row of this.db.prepare(`
      SELECT r.request_id, r.created_at, a.handle, a.display_name
      FROM friend_requests r
      JOIN accounts a ON a.id = r.from_account_id
      WHERE r.to_account_id = ?
      ORDER BY r.created_at ASC, r.request_id ASC
    `).all(resolvedAccount.id)) {
      incomingRequests.push({
        requestId: row.request_id,
        handle: row.handle,
        displayName: row.display_name,
        createdAt: row.created_at,
      });
    }
    for (const row of this.db.prepare(`
      SELECT r.request_id, r.created_at, a.handle, a.display_name
      FROM friend_requests r
      JOIN accounts a ON a.id = r.to_account_id
      WHERE r.from_account_id = ?
      ORDER BY r.created_at ASC, r.request_id ASC
    `).all(resolvedAccount.id)) {
      outgoingRequests.push({
        requestId: row.request_id,
        handle: row.handle,
        displayName: row.display_name,
        createdAt: row.created_at,
      });
    }
    return { friends, incomingRequests, outgoingRequests };
  }

  ratingStorageKey(handle, categoryKey) {
    return `${handle}:${categoryKey}`;
  }

  getRating(handle, variantOrOptions = undefined, timeControlOrSpeed = undefined) {
    const category = ratingCategory(variantOrOptions, timeControlOrSpeed);
    const ratingHandle = String(handle);
    const storageKey = this.ratingStorageKey(ratingHandle, category.key);
    const row = this.db.prepare(`
      SELECT rating
      FROM ratings
      WHERE handle = ? AND variant = ? AND speed = ?
    `).get(ratingHandle, category.variant, category.speed);
    const rating = row ? Number(row.rating) : DEFAULT_RATING;
    if (!row) {
      this.db.prepare(`
        INSERT OR IGNORE INTO ratings (handle, variant, speed, rating)
        VALUES (?, ?, ?, ?)
      `).run(ratingHandle, category.variant, category.speed, rating);
    }
    this.ratings.set(storageKey, rating);
    return rating;
  }

  getCategoryRating(handle, options = {}) {
    const category = ratingCategory(options);
    return this.getRating(handle, category.variant, category.speed);
  }

  recordGameResult(
    whiteHandle,
    blackHandle,
    outcome,
    variantOrOptions = undefined,
    timeControlOrSpeed = undefined,
  ) {
    const category = ratingCategory(variantOrOptions, timeControlOrSpeed);
    const whiteRating = this.getRating(whiteHandle, category.variant, category.speed);
    const blackRating = this.getRating(blackHandle, category.variant, category.speed);
    const whiteScore = outcome === 'white' ? 1 : outcome === 'black' ? 0 : 0.5;
    const blackScore = 1 - whiteScore;
    const nextWhite = Math.max(0, updateElo(whiteRating, blackRating, whiteScore, category.speed));
    const nextBlack = Math.max(0, updateElo(blackRating, whiteRating, blackScore, category.speed));
    transaction(this.db, () => {
      this.db.prepare(`
        INSERT INTO ratings (handle, variant, speed, rating)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(handle, variant, speed) DO UPDATE SET rating = excluded.rating
      `).run(String(whiteHandle), category.variant, category.speed, nextWhite);
      this.db.prepare(`
        INSERT INTO ratings (handle, variant, speed, rating)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(handle, variant, speed) DO UPDATE SET rating = excluded.rating
      `).run(String(blackHandle), category.variant, category.speed, nextBlack);
    });
    this.ratings.set(this.ratingStorageKey(String(whiteHandle), category.key), nextWhite);
    this.ratings.set(this.ratingStorageKey(String(blackHandle), category.key), nextBlack);
    return {
      white: nextWhite,
      black: nextBlack,
      before: {
        white: whiteRating,
        black: blackRating,
      },
      after: {
        white: nextWhite,
        black: nextBlack,
      },
      variant: category.variant,
      speed: category.speed,
      category: category.speed,
      ratingKey: category.key,
    };
  }
}

export function createAuthStore(options = {}) {
  return new AuthStore(options);
}
