import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const indexHtml = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
let appImportNumber = 0;

// Hydrate only the select controls from the real page markup. The rest of the
// shim is intentionally behavior-only: app.js still supplies all lobby logic.
function selectFixture(id) {
  const start = indexHtml.indexOf(`<select id="${id}"`);
  if (start < 0) return { options: [], required: false, value: '' };
  const end = indexHtml.indexOf('</select>', start);
  const markup = indexHtml.slice(start, end < 0 ? indexHtml.length : end);
  const openingEnd = markup.indexOf('>');
  const opening = markup.slice(0, openingEnd + 1);
  const options = [...markup.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map((match) => {
    const attributes = match[1];
    const valueMatch = attributes.match(/\bvalue\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i);
    const value = valueMatch ? valueMatch[1].replace(/^['"]|['"]$/g, '') : match[2].trim();
    return {
      value,
      text: match[2].trim(),
      disabled: /\bdisabled(?:\s|$)/i.test(attributes),
      selected: /\bselected(?:\s|$)/i.test(attributes),
    };
  });
  const selected = options.find((option) => option.selected) || options[0];
  return {
    options,
    required: /\brequired(?:\s|$)/i.test(opening),
    value: selected?.value || '',
  };
}

class StubElement {
  constructor(tagName = 'div', options = {}) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.handlers = new Map();
    this.attributes = new Map();
    this.dataset = {};
    this.className = options.className || '';
    this.classList = {
      add: (...names) => this.setClasses([...this.classes(), ...names]),
      remove: (...names) => this.setClasses(this.classes().filter((name) => !names.includes(name))),
      toggle: (name, force) => {
        const active = this.classes().includes(name);
        const next = force === undefined ? !active : Boolean(force);
        this.setClasses(next ? [...this.classes(), name] : this.classes().filter((item) => item !== name));
        return next;
      },
      contains: (name) => this.classes().includes(name),
    };
    this.style = {
      setProperty: (name, value) => { this.style[name] = String(value); },
      removeProperty: (name) => { delete this.style[name]; },
    };
    this.hidden = false;
    this.disabled = false;
    this.required = false;
    this.checked = false;
    this.open = false;
    this.textContent = '';
    this.type = options.type || '';
    this._value = options.value;
    this._initialValue = options.initialValue ?? options.value;
    this.options = options.options || [];
    this.options.forEach((option) => { option.parentElement = this; });
  }

  classes() {
    return this.className.split(/\s+/).filter(Boolean);
  }

  setClasses(values) {
    this.className = [...new Set(values)].join(' ');
  }

  get value() {
    return this._value ?? this.options.find((option) => option.selected)?.value ?? this.options[0]?.value ?? '';
  }

  set value(value) {
    this._value = String(value ?? '');
  }

  get selectedIndex() {
    return this.options.findIndex((option) => option.value === this.value);
  }

  get lastElementChild() {
    return this.children.at(-1) || null;
  }

  append(...nodes) {
    for (const node of nodes) {
      if (!(node instanceof StubElement)) continue;
      node.parentElement = this;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }

  after() {}

  remove() {
    const siblings = this.parentElement?.children;
    if (!siblings) return;
    const index = siblings.indexOf(this);
    if (index >= 0) siblings.splice(index, 1);
    this.parentElement = null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'hidden') this.hidden = true;
    if (name === 'disabled') this.disabled = true;
    if (name === 'required') this.required = true;
    if (name === 'checked') this.checked = true;
    if (name === 'open') this.open = true;
    if (name.startsWith('data-')) this.dataset[name.slice(5)] = String(value);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === 'hidden') this.hidden = false;
    if (name === 'disabled') this.disabled = false;
    if (name === 'required') this.required = false;
    if (name === 'checked') this.checked = false;
    if (name === 'open') this.open = false;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type, handler) {
    const handlers = this.handlers.get(type) || [];
    handlers.push(handler);
    this.handlers.set(type, handlers);
  }

  dispatchEvent(event) {
    event.target ||= this;
    event.currentTarget = this;
    for (const handler of this.handlers.get(event.type) || []) handler(event);
    return !event.defaultPrevented;
  }

  click() {
    if (!this.disabled) this.dispatchEvent(new TestEvent('click', { target: this }));
  }

  requestSubmit() {
    this.dispatchEvent(new TestEvent('submit', { target: this }));
  }

  reset() {
    if (this.tagName === 'SELECT') {
      this.resetControl();
      return;
    }
    for (const control of this.controls || []) control.reset();
  }

  checkValidity() {
    return true;
  }

  resetControl() {
    this._value = this._initialValue;
  }

  focus() {}

  scrollIntoView() {}

  closest() {
    return new StubElement('label');
  }

  querySelector(selector) {
    if (this.tagName === 'SELECT' && selector.startsWith('option')) {
      const valueMatch = selector.match(/value\s*=\s*["']([^"']*)["']/);
      return this.options.find((option) => !valueMatch || option.value === valueMatch[1]) || null;
    }
    return new StubElement('div');
  }

  querySelectorAll() {
    return [];
  }
}

class TestEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.defaultPrevented = false;
    this.target = init.target || null;
    this.currentTarget = null;
  }

  preventDefault() {
    this.defaultPrevented = true;
  }
}

function optionFromFixture(option) {
  const element = new StubElement('option', { value: option.value });
  element.textContent = option.text;
  element.disabled = option.disabled;
  element.selected = option.selected;
  return element;
}

class StubDocument {
  constructor() {
    this.elements = new Map();
    this.documentElement = new StubElement('html');
    this.body = new StubElement('body');
    this.register('html', this.documentElement);
    this.register('body', this.body);

    const ids = [
      'board', 'premove-status', 'clear-premoves', 'game-status', 'human-name', 'human-state',
      'engine-state', 'engine-eval', 'engine-depth', 'engine-nodes', 'engine-time', 'engine-line',
      'eval-fill', 'thinking-copy', 'match-clock', 'position-label', 'move-count', 'move-history',
      'previous-move', 'next-move', 'live-position', 'move-view-status', 'analysis-previous',
      'analysis-next', 'analysis-live', 'analysis-view-status', 'color-select', 'difficulty-select',
      'adaptive-level', 'new-game', 'undo-move', 'flip-board', 'promotion-modal', 'promotion-options',
      'toast', 'mode-select', 'time-control-select', 'ai-settings', 'online-settings', 'online-room-status',
      'online-actions', 'online-action-status', 'offer-draw', 'accept-draw', 'resign-game',
      'claimable-draws', 'rematch-panel', 'rematch-votes', 'rematch-game', 'human-clock',
      'opponent-clock', 'opponent-name', 'account-status', 'signout-button', 'sound-toggle',
      'lobby-screen', 'game-screen', 'terms-page', 'privacy-page', 'terms-page-continue',
      'privacy-page-back', 'auth-modal', 'welcome-screen', 'welcome-continue', 'welcome-signin',
      'welcome-status', 'onboarding-screen', 'lobby-form', 'game-choice', 'variant-choice',
      'color-choice', 'lobby-time-control', 'lobby-difficulty', 'lobby-adaptive-level', 'lobby-start',
      'friends-panel', 'friend-handle', 'friend-status', 'friends-list', 'friend-invites',
      'friend-actions', 'resign-local', 'resign-ai', 'auth-form', 'auth-mode', 'profile-name',
      'profile-handle', 'profile-password', 'terms-accept', 'terms-acknowledge', 'privacy-accept',
      'privacy-signup-link', 'terms-screen', 'analysis-panel', 'analysis-title', 'analysis-board',
      'analysis-summary', 'analysis-close',
    ];
    const selectIds = new Set([
      'color-select', 'difficulty-select', 'mode-select', 'time-control-select', 'auth-mode',
      'game-choice', 'variant-choice', 'color-choice', 'lobby-time-control', 'lobby-difficulty',
    ]);
    const formIds = new Set(['lobby-form', 'auth-form']);
    for (const id of ids) {
      const tagName = formIds.has(id) ? 'form' : selectIds.has(id) ? 'select' : 'div';
      this.register(`#${id}`, new StubElement(tagName));
    }

    const lobbyStrength = this.get('#lobby-difficulty');
    const strengthFixture = selectFixture('lobby-difficulty');
    lobbyStrength.options = strengthFixture.options.map(optionFromFixture);
    lobbyStrength.options.forEach((option) => { option.parentElement = lobbyStrength; });
    lobbyStrength._value = strengthFixture.value;
    lobbyStrength._initialValue = strengthFixture.value;
    lobbyStrength.required = strengthFixture.required;

    const gameStrength = this.get('#difficulty-select');
    const gameStrengthFixture = selectFixture('difficulty-select');
    gameStrength.options = gameStrengthFixture.options.map(optionFromFixture);
    gameStrength._value = gameStrengthFixture.value;
    gameStrength._initialValue = gameStrengthFixture.value;

    this.get('#game-choice').value = 'ai';
    this.get('#variant-choice').value = 'standard';
    this.get('#color-choice').value = 'random';
    this.get('#lobby-time-control').value = '5+3';
    this.get('#mode-select').value = 'ai';
    this.get('#time-control-select').value = '5+3';
    this.get('#color-select').value = 'random';
    this.get('#lobby-form').controls = [lobbyStrength, this.get('#game-choice'), this.get('#variant-choice'), this.get('#color-choice'), this.get('#lobby-time-control')];
    this.get('#terms-accept').checked = true;

    this.register('.board-frame', new StubElement());
    this.register('.board-footer', new StubElement());
    this.register('.match-strip', new StubElement());
    this.register('.engine-panel', new StubElement());
    this.register('.online-pill', new StubElement());
    this.register('.friend-request-form', new StubElement('form'));
    this.register('.match-summary strong', new StubElement('strong'));
    this.register('.match-summary span:last-child', new StubElement('span'));
    this.register('.match-summary .summary-label', new StubElement('span'));
  }

  register(selector, element) {
    this.elements.set(selector, element);
    return element;
  }

  get(selector) {
    return this.elements.get(selector);
  }

  querySelector(selector) {
    return this.elements.get(selector) || null;
  }

  querySelectorAll(selector) {
    return selector === '[data-welcome-choice]' ? [] : [];
  }

  createElement(tagName) {
    return new StubElement(tagName);
  }

  addEventListener() {}
}

class TestWorker {
  static instances = [];

  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.messages = [];
    this.terminated = false;
    TestWorker.instances.push(this);
  }

  postMessage(message) {
    this.messages.push(message);
  }

  terminate() {
    this.terminated = true;
  }
}

class TestWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = TestWebSocket.OPEN;
    this.sent = [];
    this.handlers = new Map();
    TestWebSocket.instances.push(this);
  }

  addEventListener(type, handler) {
    const handlers = this.handlers.get(type) || [];
    handlers.push(handler);
    this.handlers.set(type, handlers);
  }

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  close() {
    this.readyState = 3;
  }
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

function makeWindow(document) {
  const location = { hash: '#lobby-screen', host: '127.0.0.1:8787', protocol: 'http:' };
  return {
    document,
    location,
    history: { replaceState(_state, _title, hash) { location.hash = hash; } },
    localStorage: {
      values: new Map(),
      getItem(key) { return this.values.has(key) ? this.values.get(key) : null; },
      setItem(key, value) { this.values.set(key, String(value)); },
    },
    crypto: globalThis.crypto,
    innerWidth: 1280,
    innerHeight: 900,
    visualViewport: null,
    setTimeout,
    clearTimeout,
    setInterval() { return 0; },
    clearInterval() {},
    requestAnimationFrame(callback) { return setTimeout(callback, 0); },
    addEventListener() {},
  };
}

function installGlobal(name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  };
}

async function createHarness() {
  const document = new StubDocument();
  const window = makeWindow(document);
  TestWorker.instances = [];
  TestWebSocket.instances = [];
  const fetch = async (input) => {
    const path = String(input);
    if (path === '/api/me') {
      return jsonResponse({ account: {
        handle: 'tester',
        displayName: 'Test User',
        acceptedFairPlayTerms: true,
        acceptedPrivacyPolicy: true,
      } });
    }
    if (path === '/api/friends') {
      return jsonResponse({
        friends: [{ handle: 'rival', displayName: 'Rival', online: true }],
        incomingRequests: [],
        outgoingRequests: [],
      });
    }
    return jsonResponse({}, 404);
  };
  const restore = [
    installGlobal('document', document),
    installGlobal('window', window),
    installGlobal('Worker', TestWorker),
    installGlobal('WebSocket', TestWebSocket),
    installGlobal('fetch', fetch),
  ];
  try {
    await import(new URL(`./app.js?lobby-strength-test=${++appImportNumber}`, import.meta.url));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    return {
      window,
      document,
      elements: {
        lobby: document.get('#lobby-screen'),
        game: document.get('#game-screen'),
        form: document.get('#lobby-form'),
        mode: document.get('#game-choice'),
        color: document.get('#color-choice'),
        strength: document.get('#lobby-difficulty'),
        board: document.get('#board'),
        friendStatus: document.get('#friend-status'),
        newGame: document.get('#new-game'),
      },
      workers: TestWorker.instances,
      sockets: TestWebSocket.instances,
      async close() {
        for (const worker of TestWorker.instances) worker.terminate();
        for (const socket of TestWebSocket.instances) socket.close();
        for (const undo of restore.reverse()) undo();
      },
    };
  } catch (error) {
    for (const undo of restore.reverse()) undo();
    throw error;
  }
}

async function withHarness(callback) {
  const harness = await createHarness();
  try {
    return await callback(harness);
  } finally {
    await harness.close();
  }
}

function wait(milliseconds = 0) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function change(harness, element, value) {
  element.value = value;
  element.dispatchEvent(new TestEvent('change', { target: element }));
}

function startLobbyGame(harness) {
  harness.window.novaChess.startLobbyGame();
}

test('the authenticated lobby starts with an explicit strength placeholder', async () => {
  await withHarness(async (harness) => {
    const { strength, lobby } = harness.elements;
    assert.equal(lobby.hidden, false, 'the authenticated lobby is visible');
    assert.equal(strength.value, '', 'NovaForge strength has no silent default');
    assert.equal(strength.required, true, 'strength is required in the lobby');
    assert.equal(strength.options[0]?.value, '', 'the first strength option is the placeholder');
    assert.equal(strength.options[0]?.disabled, true, 'the placeholder cannot be submitted as a preset');
  });
});

test('missing or invalid AI strength keeps the lobby open and starts no worker', async () => {
  for (const selection of ['', 'not-a-strength']) {
    await withHarness(async (harness) => {
      change(harness, harness.elements.color, 'black');
      harness.elements.strength.value = selection;
      startLobbyGame(harness);
      await wait(150);

      assert.equal(harness.elements.lobby.hidden, false, `${selection || 'missing'} strength keeps the lobby visible`);
      assert.equal(harness.elements.game.hidden, true, `${selection || 'missing'} strength does not open the board`);
      assert.equal(harness.workers.length, 0, `${selection || 'missing'} strength starts no NovaForge worker`);
      assert.equal(harness.window.novaChess.getMode(), 'ai');
    });
  }
});

test('each explicit NovaForge strength opens a playable board and reaches the matching worker preset', async () => {
  const expectedLimits = {
    adaptive: { timeMs: 1800, maxDepth: 18, variationMargin: 18 },
    pulse: { timeMs: 700, maxDepth: 12, variationMargin: 18 },
    forge: { timeMs: 1800, maxDepth: 18, variationMargin: 18 },
    overdrive: { timeMs: 3500, maxDepth: 24, variationMargin: 18 },
    apex: { timeMs: 8000, maxDepth: 32, variationMargin: 0 },
  };

  for (const [strength, limits] of Object.entries(expectedLimits)) {
    await withHarness(async (harness) => {
      change(harness, harness.elements.color, 'black');
      change(harness, harness.elements.strength, strength);
      startLobbyGame(harness);
      await wait(150);

      assert.equal(harness.elements.lobby.hidden, true, `${strength} opens the game view`);
      assert.equal(harness.elements.game.hidden, false, `${strength} opens a visible board`);
      assert.equal(harness.window.novaChess.getStatus().phase, 'playing', `${strength} starts a playable game`);
      assert.equal(harness.elements.board.children.length, 64, `${strength} renders all board squares`);
      assert.equal(harness.workers.length, 1, `${strength} starts exactly one worker`);
      const search = harness.workers[0].messages.find((message) => message.type === 'search');
      assert.ok(search, `${strength} sends a search request`);
      assert.equal(search.limits.timeMs, limits.timeMs, `${strength} sends its search time`);
      assert.equal(search.limits.maxDepth, limits.maxDepth, `${strength} sends its search depth`);
      assert.equal(search.limits.variationMargin, limits.variationMargin, `${strength} sends its move variety policy`);
      assert.equal(typeof search.limits.variationSeed, 'number', `${strength} sends a game variation seed`);
    });
  }
});

test('local, friend, and quick modes start without a NovaForge strength', async () => {
  await withHarness(async (harness) => {
    change(harness, harness.elements.mode, 'local');
    change(harness, harness.elements.color, 'white');
    harness.elements.strength.value = '';
    startLobbyGame(harness);
    assert.equal(harness.window.novaChess.getMode(), 'local');
    assert.equal(harness.elements.game.hidden, false, 'local mode opens the board without strength');
    assert.equal(harness.elements.lobby.hidden, true);
    assert.equal(harness.workers.length, 0);
  });

  await withHarness(async (harness) => {
    change(harness, harness.elements.mode, 'online');
    assert.equal(harness.window.novaChess.selectFriend('rival'), true);
    harness.elements.strength.value = '';
    startLobbyGame(harness);
    assert.equal(harness.window.novaChess.getMode(), 'online');
    assert.equal(harness.elements.lobby.hidden, false, 'friend setup remains visible while the invite is sent');
    assert.match(harness.elements.friendStatus.textContent, /Friend invite sent/i);
    assert.equal(harness.workers.length, 0);
  });

  await withHarness(async (harness) => {
    change(harness, harness.elements.mode, 'quick');
    change(harness, harness.elements.color, 'white');
    harness.elements.strength.value = '';
    startLobbyGame(harness);
    assert.equal(harness.window.novaChess.getMode(), 'quick');
    assert.equal(harness.elements.game.hidden, false, 'quick mode opens the board without strength');
    assert.equal(harness.elements.lobby.hidden, true);
    assert.equal(harness.workers.length, 0);
  });
});
