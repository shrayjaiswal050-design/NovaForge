import {
  BLACK,
  BISHOP,
  CASTLE_BLACK_KING,
  CASTLE_BLACK_QUEEN,
  CASTLE_WHITE_KING,
  CASTLE_WHITE_QUEEN,
  FILES,
  KING,
  KNIGHT,
  PAWN,
  PIECE_GLYPHS,
  PIECE_NAMES,
  QUEEN,
  ROOK,
  WHITE,
  applyMove,
  createStateForVariant,
  fileOf,
  getLegalMoves,
  getGameStatus,
  kingSquare,
  moveToUci,
  parseSquare,
  positionKey,
  rankOf,
  squareName,
  stateFromFEN,
  toFEN,
  typeOf,
  uciToMove,
} from './chess.js';
import { previewPremoveState, resolvePremove } from './premove.js';
import { isStaticDemoMode } from './static-mode.js';

const STATIC_DEMO_MODE = isStaticDemoMode();
const STATIC_DEMO_ACCOUNT = Object.freeze({
  handle: 'demo_guest',
  displayName: 'Demo Guest',
  acceptedFairPlayTerms: true,
  acceptedPrivacyPolicy: true,
});

const boardElement = document.querySelector('#board');
const boardFrameElement = document.querySelector('.board-frame');
const boardFooterElement = document.querySelector('.board-footer');
const matchStripElement = document.querySelector('.match-strip');
const premoveStatusElement = document.querySelector('#premove-status');
const clearPremovesButton = document.querySelector('#clear-premoves');
const statusElement = document.querySelector('#game-status');
const humanNameElement = document.querySelector('#human-name');
const humanStateElement = document.querySelector('#human-state');
const engineStateElement = document.querySelector('#engine-state');
const engineEvalElement = document.querySelector('#engine-eval');
const engineDepthElement = document.querySelector('#engine-depth');
const engineNodesElement = document.querySelector('#engine-nodes');
const engineTimeElement = document.querySelector('#engine-time');
const engineLineElement = document.querySelector('#engine-line');
const evalFillElement = document.querySelector('#eval-fill');
const thinkingCopyElement = document.querySelector('#thinking-copy');
const matchClockElement = document.querySelector('#match-clock');
const positionElement = document.querySelector('#position-label');
const moveCountElement = document.querySelector('#move-count');
const moveHistoryElement = document.querySelector('#move-history');
const previousMoveButton = document.querySelector('#previous-move');
const nextMoveButton = document.querySelector('#next-move');
const livePositionButton = document.querySelector('#live-position');
const moveViewStatusElement = document.querySelector('#move-view-status');
const analysisPreviousButton = document.querySelector('#analysis-previous');
const analysisNextButton = document.querySelector('#analysis-next');
const analysisLiveButton = document.querySelector('#analysis-live');
const analysisViewStatusElement = document.querySelector('#analysis-view-status');
const colorSelect = document.querySelector('#color-select');
const difficultySelect = document.querySelector('#difficulty-select');
const adaptiveLevelElement = document.querySelector('#adaptive-level');
const newGameButton = document.querySelector('#new-game');
const undoButton = document.querySelector('#undo-move');
const flipButton = document.querySelector('#flip-board');
const promotionModal = document.querySelector('#promotion-modal');
const promotionOptions = document.querySelector('#promotion-options');
const toastElement = document.querySelector('#toast');
const modeSelect = document.querySelector('#mode-select');
const timeControlSelect = document.querySelector('#time-control-select');
const aiSettings = document.querySelector('#ai-settings');
const onlineSettings = document.querySelector('#online-settings');
const onlineRoomStatus = document.querySelector('#online-room-status');
const onlineActions = document.querySelector('#online-actions');
const onlineActionStatus = document.querySelector('#online-action-status');
const offerDrawButton = document.querySelector('#offer-draw');
const acceptDrawButton = document.querySelector('#accept-draw');
const resignButton = document.querySelector('#resign-game');
const claimableDrawsElement = document.querySelector('#claimable-draws');
const rematchPanel = document.querySelector('#rematch-panel');
const rematchVotesElement = document.querySelector('#rematch-votes');
const rematchButton = document.querySelector('#rematch-game');
const humanClockElement = document.querySelector('#human-clock');
const opponentClockElement = document.querySelector('#opponent-clock');
const opponentNameElement = document.querySelector('#opponent-name');
const opponentHeadingElement = document.querySelector('#opponent-heading-name');
const onlinePillElement = document.querySelector('.online-pill');
const accountStatusElement = document.querySelector('#account-status');
const signoutButton = document.querySelector('#signout-button');
const soundToggle = document.querySelector('#sound-toggle');

const lobbyScreen = document.querySelector('#lobby-screen');
const gameScreen = document.querySelector('#game-screen');
const termsPage = document.querySelector('#terms-page');
const privacyPage = document.querySelector('#privacy-page');
const termsPageContinueButton = document.querySelector('#terms-page-continue');
const privacyPageBackButton = document.querySelector('#privacy-page-back');
const authModal = document.querySelector('#auth-modal');
const welcomeScreen = document.querySelector('#welcome-screen');
const welcomeContinueButton = document.querySelector('#welcome-continue');
const welcomeSignInButton = document.querySelector('#welcome-signin');
const welcomeStatusElement = document.querySelector('#welcome-status');
const onboardingScreen = document.querySelector('#onboarding-screen');
const lobbyForm = document.querySelector('#lobby-form');
const gameChoice = document.querySelector('#game-choice');
const variantChoice = document.querySelector('#variant-choice');
const lobbyColorChoice = document.querySelector('#color-choice');
const lobbyTimeControl = document.querySelector('#lobby-time-control');
const lobbyDifficultySelect = document.querySelector('#lobby-difficulty');
const lobbyAdaptiveLevelElement = document.querySelector('#lobby-adaptive-level');
const staticDemoNoticeElement = document.querySelector('#static-demo-notice');
const welcomeChoiceButtons = [...document.querySelectorAll('[data-welcome-choice]')];
const lobbyStartButton = document.querySelector('#lobby-start');
const friendsPanel = document.querySelector('#friends-panel');
const friendHandleInput = document.querySelector('#friend-handle');
const friendRequestForm = document.querySelector('.friend-request-form');
const friendRequestButton = document.querySelector('#friend-request');
const friendStatusElement = document.querySelector('#friend-status');
const friendsListElement = document.querySelector('#friends-list');
const friendInvitesElement = document.querySelector('#friend-invites');
const friendActionsElement = document.querySelector('#friend-actions');
const resignLocalButton = document.querySelector('#resign-local');
const resignAiButton = document.querySelector('#resign-ai');

const authForm = document.querySelector('#auth-form');
const authModeSelect = document.querySelector('#auth-mode');
const profileNameInput = document.querySelector('#profile-name');
const profileHandleInput = document.querySelector('#profile-handle');
const profilePasswordInput = document.querySelector('#profile-password');
const termsCheckbox = document.querySelector('#terms-accept');
const termsAcknowledgeButton = document.querySelector('#terms-acknowledge');
const privacyCheckbox = document.querySelector('#privacy-accept');
const privacySignupLink = document.querySelector('#privacy-signup-link');
const termsScreen = document.querySelector('#terms-screen');
const authSubmitButton = authForm?.querySelector('button[type="submit"]');

const lobbySummaryOpponent = document.querySelector('.match-summary strong');
const lobbySummaryDetails = document.querySelector('.match-summary span:last-child');
const lobbySummaryLabel = document.querySelector('.match-summary .summary-label');
const analysisPanel = document.querySelector('#analysis-panel');
const analysisTitleElement = document.querySelector('#analysis-title');
const analysisBoard = document.querySelector('#analysis-board');
const analysisSummary = document.querySelector('#analysis-summary');
const analysisCloseButton = document.querySelector('#analysis-close');

const DIFFICULTIES = {
  pulse: { timeMs: 700, maxDepth: 12, variationMargin: 18 },
  forge: { timeMs: 1800, maxDepth: 18, variationMargin: 18 },
  overdrive: { timeMs: 3500, maxDepth: 24, variationMargin: 18 },
  apex: { timeMs: 8000, maxDepth: 32, variationMargin: 0 },
};

const ADAPTIVE_ELO_KEY = 'nova-chess-adaptive-elo';
const ADAPTIVE_ELO_DEFAULT = 1000;
const ADAPTIVE_ELO_MIN = 700;
const ADAPTIVE_ELO_MAX = 1800;
const ADAPTIVE_ELO_K = 32;
const ADAPTIVE_NOVAFORGE_ELO = 1200;

const TIME_CONTROLS = {
  '1+0': { initialMs: 60_000, incrementMs: 0 },
  '2+1': { initialMs: 120_000, incrementMs: 1_000 },
  '3+2': { initialMs: 180_000, incrementMs: 2_000 },
  '5+3': { initialMs: 300_000, incrementMs: 3_000 },
  '10+0': { initialMs: 600_000, incrementMs: 0 },
  '15+10': { initialMs: 900_000, incrementMs: 10_000 },
};

const MODE_VALUES = new Set(['ai', 'local', 'online', 'quick']);
const NETWORK_MODES = new Set(['online', 'quick']);
const VARIANT_VALUES = new Set(['standard', 'chess960']);
const FINISHED_PHASES = new Set(['checkmate', 'draw', 'timeout', 'resigned']);
const ONLINE_ACTION_TYPES = new Set([
  'friendInvite',
  'friendInviteRespond',
  'friendMove',
  'friendResign',
  'friendDrawOffer',
  'friendDrawAccept',
  'friendRematch',
  'friendReconnect',
]);
const QUICK_ACTION_TYPES = new Set(['quickMatch', 'cancelQuickMatch']);

const promotionOrder = [QUEEN, ROOK, BISHOP, KNIGHT];
const AUTHORITATIVE_TIME_CONTROL_VALUE = '__authoritative_time_control__';

let game = createStateForVariant({ variant: 'standard' });
let currentVariant = 'standard';
let currentChess960Seed = null;
let humanColor = WHITE;
let orientation = WHITE;
let viewedPly = null;
let selectedSquare = -1;
let pendingPromotion = null;
let pendingPromotionType = 'live';
let promotionReturnFocus = null;
let premoveQueue = [];
let premoveInFlight = null;
let previousStates = [];
let thinking = false;
let worker = null;
let requestCounter = 0;
let toastTimer = null;
let mode = 'ai';
let selectedTimeControl = '5+3';
let selectedColorChoice = 'random';
let welcomeChoice = 'practice';
let requestedColor = WHITE;
let clocks = { white: 300_000, black: 300_000 };
let clockStamp = performance.now();
let localResult = null;
let adaptiveElo = ADAPTIVE_ELO_DEFAULT;
let adaptiveResultRecorded = false;
let engineVariationSeed = 0;
let engineData = {
  score: { cp: 20 },
  depth: 0,
  nodes: 0,
  elapsedMs: 0,
  pv: [],
};

let account = null;
let fairPlayAccepted = false;
let authenticated = false;
let infoReturnView = 'welcome';
let authStatusElement = null;
let friends = {
  friends: [],
  incomingRequests: [],
  outgoingRequests: [],
};
let selectedFriendHandle = null;
const pendingFriendInvites = new Map();

let socket = null;
let socketGeneration = 0;
let socketConnected = false;
let pendingSocketActions = [];
let reconnectTimer = null;
let onlineGameId = null;
let onlineColor = null;
let onlineToken = null;
let onlineReady = false;
let onlineStatus = null;
let onlinePlayers = [];
let onlineTimeControl = null;
let onlineRevision = -1;
let lastOnlineHistoryLength = 0;
let lastOnlinePhase = 'playing';
let quickMatchRequest = null;
let quickMatchId = null;

let soundEnabled = false;
let audioContext = null;
let lastMoveSoundAt = 0;
let audioFailureReported = false;

let analysisWorker = null;
let analysisRequestCounter = 0;
let analysisForKey = null;
let analysisSnapshot = null;
let analysisStatus = null;
let analysisEvaluation = null;
let analysisWasVisible = false;
let lastRenderedHistoryLength = 0;

const enginePanel = document.querySelector('.engine-panel');
const ratingSummaryElement = document.createElement('div');
ratingSummaryElement.className = 'server-rating-summary';
ratingSummaryElement.hidden = true;
enginePanel?.append(ratingSummaryElement);

class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function safeText(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .slice(0, 240);
}

function safeMessage(value, fallback = 'The request could not be completed.') {
  const message = safeText(value, '');
  return message || fallback;
}

function setText(element, value, fallback = '') {
  if (element) element.textContent = safeText(value, fallback);
}

function sanitizeHandle(value) {
  if (typeof value !== 'string') return null;
  let normalized;
  try {
    normalized = value.normalize('NFKC').trim().toLowerCase();
  } catch {
    return null;
  }
  if (normalized.length < 3 || normalized.length > 24 || !/^[a-z0-9](?:[a-z0-9_]{2,23})$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function sanitizeDisplayName(value) {
  if (typeof value !== 'string') return null;
  let normalized;
  try {
    normalized = value
      .normalize('NFKC')
      .replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}]/gu, '')
      .replace(/[^\p{L}\p{M}\p{N} _.-]/gu, '')
      .replace(/\s+/gu, ' ')
      .trim();
  } catch {
    return null;
  }
  if (!normalized || normalized.length > 40) return null;
  return normalized;
}

function normalizeColorName(color) {
  if (color === WHITE || color === 'white' || color === 'w') return 'white';
  if (color === BLACK || color === 'black' || color === 'b') return 'black';
  return null;
}

function chessColor(color) {
  const normalized = normalizeColorName(color);
  return normalized === 'white' ? WHITE : normalized === 'black' ? BLACK : null;
}

function colorsMatch(first, second) {
  const firstName = normalizeColorName(first);
  const secondName = normalizeColorName(second);
  return firstName !== null && firstName === secondName;
}

function normalizeColorList(colors) {
  if (!Array.isArray(colors)) return [];
  return [...new Set(colors.map(normalizeColorName).filter(Boolean))];
}

function normalizeClocks(value, fallback = clocks) {
  const white = Number(value?.white);
  const black = Number(value?.black);
  return {
    white: Number.isFinite(white) ? Math.max(0, white) : fallback.white,
    black: Number.isFinite(black) ? Math.max(0, black) : fallback.black,
  };
}

function normalizeVariant(value) {
  return VARIANT_VALUES.has(value) ? value : null;
}

function isNetworkMode(value = mode) {
  return NETWORK_MODES.has(value);
}

function normalizeColorChoice(value) {
  if (value === 'white' || value === 'black' || value === 'random') return value;
  return 'random';
}

function resolveColorChoice(value) {
  const choice = normalizeColorChoice(value);
  if (choice === 'black') return BLACK;
  if (choice === 'white') return WHITE;
  return Math.random() < 0.5 ? WHITE : BLACK;
}

function colorChoiceLabel(value) {
  const choice = normalizeColorChoice(value);
  return choice === 'random' ? 'Random side' : `${choice[0].toUpperCase()}${choice.slice(1)} side`;
}

function normalizePhase(value) {
  if (value === 'playing' || FINISHED_PHASES.has(value)) return value;
  return 'playing';
}

function timeControlDetails(value) {
  if (typeof value === 'string') return TIME_CONTROLS[value] || null;
  if (!value || typeof value !== 'object') return null;
  const initialMs = Number(value.initialMs);
  const incrementMs = Number(value.incrementMs);
  if (!Number.isFinite(initialMs) || !Number.isFinite(incrementMs)) return null;
  return { initialMs: Math.max(0, initialMs), incrementMs: Math.max(0, incrementMs) };
}

function timeControlLabel(value) {
  const control = timeControlDetails(value);
  if (!control) return 'Unknown time';
  const totalSeconds = Math.max(0, Math.round(control.initialMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const base = seconds ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${minutes}:00`;
  return `${base} + ${Math.round(control.incrementMs / 1000)}s`;
}

function variantLabel(value) {
  return value === 'chess960' ? 'Chess960' : 'Standard Chess';
}

function colorText(color) {
  const normalized = normalizeColorName(color);
  return normalized ? normalized.toUpperCase() : 'PLAYER';
}

function winnerText(status) {
  const winner = colorText(status?.winner);
  return winner === 'PLAYER' ? '' : winner;
}

function oppositeColor(color) {
  return color === WHITE ? BLACK : WHITE;
}

function randomChess960Seed() {
  return Math.floor(Math.random() * 960);
}

function randomEngineVariationSeed() {
  if (window.crypto?.getRandomValues) {
    const values = new Uint32Array(1);
    window.crypto.getRandomValues(values);
    return values[0];
  }
  return Math.floor(Math.random() * 0x1_0000_0000) >>> 0;
}

function createVariantState(variant = 'standard', seed = null) {
  const normalizedVariant = normalizeVariant(variant) || 'standard';
  try {
    const options = { variant: normalizedVariant };
    if (normalizedVariant === 'chess960') {
      options.chess960Seed = Number.isSafeInteger(seed) && seed >= 0 && seed <= 959
        ? seed
        : randomChess960Seed();
    }
    const state = createStateForVariant(options);
    if (!state || !Array.isArray(state.board) || state.board.length !== 64 || !(state.positionCounts instanceof Map)) {
      throw new Error('The selected variant could not be initialized.');
    }
    return state;
  } catch (error) {
    showToast(normalizedVariant === 'chess960'
      ? 'Chess960 could not be initialized on this client.'
      : 'The selected game could not be initialized.');
    return null;
  }
}

function parseCastlingRights(value) {
  if (value === '-') return 0;
  if (typeof value !== 'string' || !/^[KQkq]+$/.test(value)) throw new Error('Invalid server castling state.');
  let rights = 0;
  if (value.includes('K')) rights |= CASTLE_WHITE_KING;
  if (value.includes('Q')) rights |= CASTLE_WHITE_QUEEN;
  if (value.includes('k')) rights |= CASTLE_BLACK_KING;
  if (value.includes('q')) rights |= CASTLE_BLACK_QUEEN;
  return rights;
}

function normalizeMove(value) {
  if (!value || typeof value !== 'object') return null;
  const from = Number(value.from);
  const to = Number(value.to);
  const flags = Number(value.flags);
  const promotion = Number(value.promotion || 0);
  if (!Number.isInteger(from) || from < 0 || from > 63 || !Number.isInteger(to) || to < 0 || to > 63) return null;
  return {
    from,
    to,
    flags: Number.isInteger(flags) && flags >= 0 ? flags : 0,
    promotion: Number.isInteger(promotion) && promotion >= 0 ? promotion : 0,
  };
}

function normalizeHistory(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const move = normalizeMove(entry);
    if (!move) return null;
    return { ...move, notation: safeText(entry.notation, '') };
  }).filter(Boolean);
}

function stateFromServerMessage(message) {
  if (typeof message?.fen !== 'string') throw new Error('The server did not provide a position.');
  const variant = normalizeVariant(message.variant) || 'standard';
  if (variant === 'standard') {
    const state = stateFromFEN(message.fen);
    state.history = normalizeHistory(message.history);
    state.lastMove = normalizeMove(message.lastMove);
    return state;
  }

  const fields = message.fen.trim().split(/\s+/);
  if (fields.length !== 6) throw new Error('The server provided an invalid Chess960 position.');
  const seed = Number.isSafeInteger(message.chess960Seed) && message.chess960Seed >= 0 && message.chess960Seed <= 959
    ? message.chess960Seed
    : 518;
  const variantState = createVariantState('chess960', seed);
  if (!variantState) throw new Error('Chess960 is not available on this client.');

  // The rules core deliberately validates standard FEN castling placement.
  // Parse the board and clocks without standard castling rights, then restore
  // the Chess960 homes and rights from the authoritative message.
  const parseableFen = [fields[0], fields[1], '-', fields[3], fields[4], fields[5]].join(' ');
  const state = stateFromFEN(parseableFen);
  state.variant = 'chess960';
  state.chess960Seed = seed;
  state.chess960Homes = variantState.chess960Homes;
  state.castling = parseCastlingRights(fields[2]);
  state.history = normalizeHistory(message.history);
  state.lastMove = normalizeMove(message.lastMove);
  state.positionCounts = new Map([[positionKey(state), 1]]);
  return state;
}

function normalizeAccount(value) {
  if (!value || typeof value !== 'object') return null;
  const handle = sanitizeHandle(value.handle);
  const displayName = sanitizeDisplayName(value.displayName);
  if (!handle || !displayName) return null;
  return {
    handle,
    displayName,
    acceptedFairPlayTerms: value.acceptedFairPlayTerms === true,
    acceptedPrivacyPolicy: value.acceptedPrivacyPolicy !== false,
  };
}

function normalizeFriend(value) {
  const handle = sanitizeHandle(value?.handle);
  if (!handle) return null;
  const displayName = sanitizeDisplayName(value?.displayName) || handle;
  return { handle, displayName, online: Boolean(value?.online) };
}

function normalizeFriendRequest(value) {
  if (!value || typeof value !== 'object' || typeof value.requestId !== 'string') return null;
  const requestId = value.requestId.trim().slice(0, 80);
  const handle = sanitizeHandle(value.handle);
  if (!requestId || !handle) return null;
  return {
    requestId,
    handle,
    displayName: sanitizeDisplayName(value.displayName) || handle,
  };
}

function normalizeFriendLists(value) {
  return {
    friends: Array.isArray(value?.friends) ? value.friends.map(normalizeFriend).filter(Boolean) : [],
    incomingRequests: Array.isArray(value?.incomingRequests)
      ? value.incomingRequests.map(normalizeFriendRequest).filter(Boolean)
      : [],
    outgoingRequests: Array.isArray(value?.outgoingRequests)
      ? value.outgoingRequests.map(normalizeFriendRequest).filter(Boolean)
      : [],
  };
}

function normalizeOnlinePlayer(value) {
  const color = normalizeColorName(value?.color);
  if (!color) return null;
  const handle = sanitizeHandle(value.handle) || '';
  const displayName = sanitizeDisplayName(value.displayName) || handle || color;
  return { color, handle, displayName, connected: Boolean(value.connected) };
}

function normalizeRatings(value) {
  if (!value || typeof value !== 'object') return null;
  const ratingNumber = (candidate) => {
    return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
  };
  const playerRating = (candidate) => {
    if (candidate && typeof candidate === 'object') {
      for (const key of ['after', 'rating', 'afterRating', 'end']) {
        const number = ratingNumber(candidate[key]);
        if (number !== null) return number;
      }
    }
    return ratingNumber(candidate);
  };
  const white = playerRating(value.white) ?? playerRating(value.after?.white) ?? playerRating(value.before?.white);
  const black = playerRating(value.black) ?? playerRating(value.after?.black) ?? playerRating(value.before?.black);
  if (white === null || black === null) return null;
  return {
    white,
    black,
    category: safeText(value.category || value.ratingCategory || value.speed, 'friend game'),
  };
}

function normalizeFinishedResult(value, phase) {
  if (!value || typeof value !== 'object' || !FINISHED_PHASES.has(phase)) return null;
  const ratings = normalizeRatings(value.ratings);
  if (!ratings) return null;
  return {
    phase,
    winner: normalizeColorName(value.winner),
    drawReason: safeText(value.drawReason, ''),
    reason: safeText(value.reason, ''),
    ratings,
    category: ratings.category,
  };
}

function ensureAuthStatusElement() {
  if (authStatusElement || !authForm) return authStatusElement;
  authStatusElement = document.createElement('p');
  authStatusElement.id = 'auth-status';
  authStatusElement.className = 'inline-status';
  authStatusElement.setAttribute('role', 'status');
  authForm.after(authStatusElement);
  return authStatusElement;
}

function setAuthStatus(message) {
  setText(ensureAuthStatusElement(), message);
}

function setWelcomeStatus(message) {
  setText(welcomeStatusElement, message, 'Practice selected · Choose a NovaForge strength before starting.');
}

function selectWelcomeChoice(choice) {
  const descriptions = {
    practice: 'Practice selected · Choose a NovaForge strength before starting.',
    online: 'Compete selected · Friends and exact time-control matches are available after sign in.',
    review: 'Review selected · Every finished game keeps a navigable move record.',
  };
  if (!descriptions[choice]) return;
  welcomeChoice = choice;
  for (const button of welcomeChoiceButtons) {
    const active = button.dataset.welcomeChoice === choice;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  setWelcomeStatus(descriptions[choice]);
}

function normalizeAdaptiveElo(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return ADAPTIVE_ELO_DEFAULT;
  return Math.max(ADAPTIVE_ELO_MIN, Math.min(ADAPTIVE_ELO_MAX, Math.round(parsed)));
}

function loadAdaptiveElo() {
  try {
    const stored = window.localStorage?.getItem(ADAPTIVE_ELO_KEY);
    return stored === null ? ADAPTIVE_ELO_DEFAULT : normalizeAdaptiveElo(stored);
  } catch {
    return ADAPTIVE_ELO_DEFAULT;
  }
}

function saveAdaptiveElo() {
  try {
    window.localStorage?.setItem(ADAPTIVE_ELO_KEY, String(adaptiveElo));
  } catch {
    // The adjustment still works for the current session if storage is unavailable.
  }
}

function adaptiveDifficultyKey(rating = adaptiveElo) {
  if (rating < 950) return 'pulse';
  if (rating < 1_150) return 'forge';
  if (rating < 1_400) return 'overdrive';
  return 'apex';
}

function adaptiveDifficultyLabel(rating = adaptiveElo) {
  const key = adaptiveDifficultyKey(rating);
  return key[0].toUpperCase() + key.slice(1);
}

function normalizeDifficulty(value) {
  return value === 'adaptive' || Object.hasOwn(DIFFICULTIES, value) ? value : null;
}

function selectedDifficultyValue() {
  return normalizeDifficulty(difficultySelect?.value || lobbyDifficultySelect?.value);
}

function syncDifficultySelectors(value) {
  const selected = normalizeDifficulty(value);
  if (difficultySelect) difficultySelect.value = selected || '';
  if (lobbyDifficultySelect) lobbyDifficultySelect.value = selected || '';
  return selected;
}

function updateAdaptiveLevelDisplay() {
  const selected = selectedDifficultyValue();
  const adaptiveText = `Adaptive Elo · ${adaptiveElo} · ${adaptiveDifficultyLabel(adaptiveElo)}`;
  const fixedLabel = selected ? selected[0].toUpperCase() + selected.slice(1) : null;
  const fixedText = fixedLabel ? `Fixed search · ${fixedLabel}` : 'Choose a NovaForge level before starting';
  if (adaptiveLevelElement) {
    adaptiveLevelElement.hidden = mode !== 'ai' || selected !== 'adaptive';
    setText(adaptiveLevelElement, selected === 'adaptive' ? adaptiveText : fixedText);
  }
  if (lobbyAdaptiveLevelElement) {
    const lobbyAi = gameChoice?.value === 'ai';
    lobbyAdaptiveLevelElement.hidden = !lobbyAi;
    setText(lobbyAdaptiveLevelElement, selected === 'adaptive' ? adaptiveText : fixedText);
  }
}

function selectedEngineDifficulty() {
  const selected = selectedDifficultyValue();
  if (!selected) return null;
  const key = selected === 'adaptive'
    ? adaptiveDifficultyKey()
    : selected;
  return DIFFICULTIES[key] || DIFFICULTIES.forge;
}

function recordAdaptiveResult(result) {
  if (mode !== 'ai' || selectedDifficultyValue() !== 'adaptive' || !result || adaptiveResultRecorded) return;
  adaptiveResultRecorded = true;
  const userScore = result.winner === null
    ? 0.5
    : colorsMatch(result.winner, humanColor) ? 1 : 0;
  const expectedScore = 1 / (1 + (10 ** ((ADAPTIVE_NOVAFORGE_ELO - adaptiveElo) / 400)));
  const before = adaptiveElo;
  adaptiveElo = normalizeAdaptiveElo(adaptiveElo + ADAPTIVE_ELO_K * (userScore - expectedScore));
  saveAdaptiveElo();
  updateAdaptiveLevelDisplay();
  updateLobbySummary();
  const delta = adaptiveElo - before;
  const sign = delta >= 0 ? '+' : '';
  showToast(`Adaptive NovaForge · ${adaptiveDifficultyLabel(adaptiveElo)} · Elo ${adaptiveElo} (${sign}${delta})`);
}

function setFriendStatus(message) {
  setText(friendStatusElement, message, 'No friend requests in this session.');
}

function showToast(message) {
  if (!toastElement) return;
  window.clearTimeout(toastTimer);
  toastElement.textContent = safeMessage(message, 'Something went wrong.');
  toastElement.classList.add('show');
  toastTimer = window.setTimeout(() => toastElement.classList.remove('show'), 2800);
}

// fixmyslop-ignore[ui/fake-feature]: Static demo mode truthfully reports unavailable online capabilities.
function setStaticDemoNotice(message = 'Demo mode: local AI and local two-player games are available. Online modes need a server.') {
  if (!STATIC_DEMO_MODE || !staticDemoNoticeElement) return;
  staticDemoNoticeElement.hidden = false;
  setText(staticDemoNoticeElement, message);
}

function markStaticNetworkOptions(selectElement) {
  if (!STATIC_DEMO_MODE || !selectElement) return;
  for (const option of selectElement.options || []) {
    if (!NETWORK_MODES.has(option.value)) continue;
    option.disabled = true;
    if (option.dataset.staticLabelApplied !== 'true') {
      option.dataset.staticLabelApplied = 'true';
      option.textContent = `${option.textContent} · server only`;
    }
  }
}

function applyStaticDemoUi() {
  if (!STATIC_DEMO_MODE) return;
  setStaticDemoNotice();
  markStaticNetworkOptions(gameChoice);
  markStaticNetworkOptions(modeSelect);
  if (friendsPanel) friendsPanel.hidden = true;
  if (friendActionsElement) friendActionsElement.hidden = true;
}

function rejectStaticNetworkMode() {
  if (!STATIC_DEMO_MODE) return false;
  // fixmyslop-ignore[ui/fake-feature]: Static demo mode truthfully reports unavailable online capabilities.
  setStaticDemoNotice('Demo mode: friend and random online modes are unavailable because no server is connected.');
  // fixmyslop-ignore[ui/fake-feature]: Static demo mode truthfully reports unavailable online capabilities.
  setText(onlineRoomStatus, 'Online modes are unavailable in demo mode because no server is connected.');
  // fixmyslop-ignore[ui/fake-feature]: Static demo mode truthfully reports unavailable online capabilities.
  showToast('Friend and random online modes are unavailable in demo mode.');
  return true;
}

function setAccountStatus(message) {
  setText(accountStatusElement, message, STATIC_DEMO_MODE ? 'Demo guest · local only' : 'Account session');
}

function setAuthModalVisible(visible, { focus = false, screen = 'auth' } = {}) {
  const welcomeVisible = visible && screen === 'welcome';
  const authVisible = visible && screen === 'auth';
  if (welcomeScreen) welcomeScreen.hidden = !welcomeVisible;
  if (onboardingScreen) onboardingScreen.hidden = !authVisible;
  if (authModal) {
    authModal.setAttribute('aria-hidden', String(!visible));
    authModal.setAttribute('aria-labelledby', welcomeVisible ? 'welcome-title' : 'onboarding-title');
    authModal.setAttribute('aria-describedby', welcomeVisible ? 'welcome-status' : 'password-warning');
    if (visible) authModal.removeAttribute('hidden');
    else authModal.setAttribute('hidden', '');
  }
  if (visible && focus) {
    const focusTarget = welcomeVisible
      ? welcomeContinueButton
      : authModeSelect || profileHandleInput || profileNameInput;
    const focusLater = () => focusTarget?.focus();
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(focusLater);
    else window.setTimeout(focusLater, 0);
  }
}

function loadSoundPreference() {
  try {
    const stored = window.localStorage?.getItem('nova-chess-sound');
    return stored === null ? true : stored === 'on';
  } catch {
    return true;
  }
}

function saveSoundPreference() {
  try {
    window.localStorage?.setItem('nova-chess-sound', soundEnabled ? 'on' : 'off');
  } catch {
    // Some privacy modes expose localStorage but reject writes.
  }
}

function updateSoundToggle() {
  if (!soundToggle) return;
  soundToggle.setAttribute('aria-pressed', String(soundEnabled));
  soundToggle.setAttribute('aria-label', soundEnabled ? 'Turn move sounds off' : 'Turn move sounds on');
  const label = soundToggle.querySelector('span:last-child');
  setText(label, soundEnabled ? 'Move sound on' : 'Move sound off');
}

function reportAudioFailure(error, message = 'Move sounds are unavailable. Check your browser audio permissions and try again.') {
  soundEnabled = false;
  audioContext = null;
  saveSoundPreference();
  updateSoundToggle();
  const detail = error instanceof Error ? error.message : String(error);
  console.warn('Nova Chess move sound is unavailable.', { detail });
  if (!audioFailureReported) {
    audioFailureReported = true;
    showToast(message);
  }
}

function getAudioContext() {
  if (!soundEnabled || audioContext) return audioContext;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  try {
    audioContext = new AudioContextClass();
    return audioContext;
  } catch {
    audioContext = null;
    return null;
  }
}

function playMoveSound() {
  if (!soundEnabled) return;
  const context = getAudioContext();
  if (!context) return;
  const now = performance.now();
  if (now - lastMoveSoundAt < 55) return;
  lastMoveSoundAt = now;
  const emit = () => {
    if (!soundEnabled || context.state === 'closed') return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    const start = context.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(275, start);
    oscillator.frequency.exponentialRampToValueAtTime(215, start + 0.14);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(720, start);
    filter.Q.setValueAtTime(0.35, start);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.018, start + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.2);
  };
  const run = () => {
    try {
      emit();
    } catch (error) {
      reportAudioFailure(error);
    }
  };
  if (context.state === 'suspended') {
    void context.resume().then(run).catch((error) => reportAudioFailure(error));
  }
  else run();
}

function closePromotion() {
  pendingPromotion = null;
  pendingPromotionType = 'live';
  if (promotionModal) promotionModal.hidden = true;
  promotionOptions?.replaceChildren();
  if (promotionReturnFocus && typeof promotionReturnFocus.focus === 'function') {
    promotionReturnFocus.focus();
  }
  promotionReturnFocus = null;
}

function setHash(hash) {
  try {
    window.history.replaceState(null, '', hash);
  } catch {
    // The board remains usable when history is unavailable in a test harness.
  }
}

function hideInfoPages() {
  if (termsPage) termsPage.hidden = true;
  if (privacyPage) privacyPage.hidden = true;
}

function showInfoPage(page, returnView = authenticated ? 'lobby' : 'welcome') {
  const pageElement = page === 'privacy' ? privacyPage : termsPage;
  if (!pageElement) return;
  infoReturnView = ['auth', 'lobby'].includes(returnView) ? returnView : 'welcome';
  setAuthModalVisible(false);
  if (lobbyScreen) lobbyScreen.hidden = true;
  if (gameScreen) gameScreen.hidden = true;
  hideInfoPages();
  pageElement.hidden = false;
  setHash(page === 'privacy' ? '#privacy-page' : '#terms-page');
  updateViewportLayout();
}

function returnFromInfoPage() {
  if (infoReturnView === 'lobby') {
    showAuthenticatedLobby();
    return;
  }
  if (infoReturnView === 'auth') {
    const fairPlayWasChecked = Boolean(termsCheckbox?.checked);
    const privacyWasChecked = Boolean(privacyCheckbox?.checked);
    showAuthScreen();
    if (termsCheckbox) termsCheckbox.checked = fairPlayWasChecked;
    if (privacyCheckbox) privacyCheckbox.checked = privacyWasChecked;
    fairPlayAccepted = fairPlayWasChecked;
    if (termsScreen) termsScreen.open = true;
    updateAuthMode();
    return;
  }
  showWelcomeScreen();
}

function updateViewportLayout() {
  const visualViewport = window.visualViewport;
  const width = Math.max(320, Math.round(visualViewport?.width || window.innerWidth || 320));
  const height = Math.max(240, Math.round(visualViewport?.height || window.innerHeight || 240));
  const root = document.documentElement;
  root?.style.setProperty('--viewport-width', `${width}px`);
  root?.style.setProperty('--viewport-height', `${height}px`);
  document.body?.classList.toggle('viewport-compact', width <= 860 || height <= 680);

  if (onboardingScreen) onboardingScreen.style.maxHeight = `${Math.max(200, height - 32)}px`;
  const gameVisible = Boolean(gameScreen && !gameScreen.hidden && gameScreen.style.display !== 'none');
  if (!gameVisible) {
    for (const element of [matchStripElement, boardFrameElement, boardFooterElement]) {
      element?.style.removeProperty('width');
    }
  } else {
    const boardColumnWidth = boardFrameElement?.parentElement?.clientWidth || width;
    const horizontalLimit = width <= 860 ? width - 36 : width - 430;
    const verticalLimit = height - (width <= 860 ? 300 : 260);
    const size = Math.floor(Math.min(boardColumnWidth, horizontalLimit, height * 0.68, verticalLimit));
    if (size > 0) {
      const boardWidth = `${Math.max(190, size)}px`;
      for (const element of [matchStripElement, boardFrameElement, boardFooterElement]) {
        element?.style.setProperty('width', boardWidth);
      }
    } else {
      for (const element of [matchStripElement, boardFrameElement, boardFooterElement]) {
        element?.style.removeProperty('width');
      }
    }
  }
  if (analysisPanel && !analysisPanel.hidden) renderAnalysisBoard();
}

function showLobbyScreen() {
  hideInfoPages();
  if (lobbyScreen) {
    lobbyScreen.hidden = false;
    lobbyScreen.style.display = '';
  }
  if (gameScreen) {
    gameScreen.hidden = true;
    gameScreen.style.display = 'none';
  }
  setHash('#lobby-screen');
  updateViewportLayout();
}

function showGameScreen() {
  if (!authenticated) {
    showLobbyScreen();
    return false;
  }
  if (lobbyScreen) lobbyScreen.hidden = true;
  hideInfoPages();
  if (gameScreen) {
    gameScreen.hidden = false;
    gameScreen.style.display = 'block';
  }
  setHash('#game-screen');
  updateViewportLayout();
  return true;
}

function setAuthenticatedAccount(nextAccount) {
  account = normalizeAccount(nextAccount);
  authenticated = Boolean(account);
  fairPlayAccepted = Boolean(account?.acceptedFairPlayTerms);
  if (termsCheckbox) termsCheckbox.checked = fairPlayAccepted;
  if (privacyCheckbox) privacyCheckbox.checked = Boolean(account?.acceptedPrivacyPolicy);
  if (termsScreen) termsScreen.open = authenticated ? !fairPlayAccepted : true;
  setAccountStatus(authenticated
    ? STATIC_DEMO_MODE ? 'Demo guest · local only' : `Signed in · ${account.handle}`
    : 'Sign in required');
  if (signoutButton) signoutButton.hidden = STATIC_DEMO_MODE || !authenticated;
}

function activateStaticDemo() {
  if (!STATIC_DEMO_MODE) return;
  disconnectSocket(true);
  if (gameChoice && NETWORK_MODES.has(gameChoice.value)) gameChoice.value = 'ai';
  if (modeSelect && NETWORK_MODES.has(modeSelect.value)) modeSelect.value = 'ai';
  friends = { friends: [], incomingRequests: [], outgoingRequests: [] };
  selectedFriendHandle = null;
  setAuthenticatedAccount(STATIC_DEMO_ACCOUNT);
  applyStaticDemoUi();
  showAuthenticatedLobby();
  setText(matchClockElement, 'Local demo');
}

function disconnectSocket(clearGame = false) {
  socketGeneration += 1;
  const previousSocket = socket;
  socket = null;
  socketConnected = false;
  pendingSocketActions = [];
  if (reconnectTimer) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (previousSocket) {
    try {
      previousSocket.close();
    } catch {
      previousSocket.terminate?.();
    }
  }
  onlineReady = false;
  if (clearGame) {
    onlineGameId = null;
    onlineColor = null;
    onlineToken = null;
    onlineStatus = null;
    onlinePlayers = [];
    onlineTimeControl = null;
    onlineRevision = -1;
    lastOnlineHistoryLength = 0;
    lastOnlinePhase = 'playing';
    quickMatchRequest = null;
    quickMatchId = null;
  }
}

function showAuthScreen(message = '') {
  if (STATIC_DEMO_MODE) {
    activateStaticDemo();
    return;
  }
  setAuthenticatedAccount(null);
  disconnectSocket(true);
  showLobbyScreen();
  setAuthModalVisible(true, { focus: true, screen: 'auth' });
  if (lobbyForm) lobbyForm.hidden = true;
  if (friendsPanel) friendsPanel.hidden = true;
  if (friendActionsElement) friendActionsElement.hidden = true;
  if (termsScreen) termsScreen.open = true;
  updateAuthMode();
  setWelcomeStatus('');
  setAuthStatus(message);
  setText(matchClockElement, 'Sign in required');
  setAccountStatus('Sign in required');
  clearAnalysis();
  render();
}

function showWelcomeScreen(message = '') {
  if (STATIC_DEMO_MODE) {
    activateStaticDemo();
    return;
  }
  setAuthenticatedAccount(null);
  disconnectSocket(true);
  showLobbyScreen();
  setAuthModalVisible(true, { focus: true, screen: 'welcome' });
  if (lobbyForm) lobbyForm.hidden = true;
  if (friendsPanel) friendsPanel.hidden = true;
  if (friendActionsElement) friendActionsElement.hidden = true;
  if (termsScreen) termsScreen.open = false;
  setAuthStatus('');
  setWelcomeStatus(message);
  setText(matchClockElement, 'Sign in required');
  setAccountStatus('Sign in required');
  clearAnalysis();
  render();
}

function showAuthenticatedLobby() {
  authenticated = Boolean(account);
  if (!authenticated) {
    showWelcomeScreen();
    return;
  }
  showLobbyScreen();
  setAuthModalVisible(false);
  if (lobbyForm) lobbyForm.hidden = false;
  if (friendsPanel) friendsPanel.hidden = STATIC_DEMO_MODE;
  if (friendActionsElement) friendActionsElement.hidden = STATIC_DEMO_MODE;
  setAuthStatus('');
  setWelcomeStatus('');
  if (termsScreen && fairPlayAccepted) termsScreen.open = false;
  applyStaticDemoUi();
  updateLobbySummary();
  renderFriends();
  render();
}

function hasFairPlayConsent() {
  return Boolean(authenticated && account?.acceptedFairPlayTerms && fairPlayAccepted && termsCheckbox?.checked);
}

function updateAuthMode() {
  const signup = authModeSelect?.value !== 'login';
  if (profileNameInput) {
    profileNameInput.required = signup;
    const label = profileNameInput.closest('label');
    if (label) label.hidden = !signup;
  }
  if (termsCheckbox) termsCheckbox.required = signup;
  if (privacyCheckbox) privacyCheckbox.required = signup;
  if (profilePasswordInput) profilePasswordInput.autocomplete = signup ? 'new-password' : 'current-password';
  setText(authSubmitButton, signup ? 'Create account' : 'Sign in');
}

function updateLobbySummary() {
  const selectedMode = MODE_VALUES.has(gameChoice?.value) ? gameChoice.value : 'ai';
  const selectedVariant = normalizeVariant(variantChoice?.value) || 'standard';
  const timeControl = Object.hasOwn(TIME_CONTROLS, lobbyTimeControl?.value)
    ? lobbyTimeControl.value
    : selectedTimeControl;
  const opponent = selectedMode === 'ai'
    ? 'Human vs NovaForge'
    : selectedMode === 'local'
      ? 'Local two-player'
      : selectedMode === 'quick'
        ? 'Random online opponent'
      : selectedFriendHandle
        ? `Friend match · ${selectedFriendHandle}`
        : 'Select a friend';
  setText(lobbySummaryLabel, selectedMode === 'online' && !selectedFriendHandle ? 'Select a friend' : 'Ready to start');
  setText(lobbySummaryOpponent, opponent);
  const difficulty = normalizeDifficulty(lobbyDifficultySelect?.value || difficultySelect?.value);
  if (lobbyDifficultySelect && lobbyDifficultySelect.value !== (difficulty || '')) lobbyDifficultySelect.value = difficulty || '';
  if (lobbyDifficultySelect) {
    lobbyDifficultySelect.disabled = selectedMode !== 'ai';
    lobbyDifficultySelect.required = selectedMode === 'ai';
  }
  const difficultySummary = difficulty
    ? difficulty === 'adaptive' ? `Adaptive ${adaptiveElo}` : difficulty.toUpperCase()
    : 'Choose strength';
  setText(lobbySummaryDetails, `${variantLabel(selectedVariant)} · ${colorChoiceLabel(lobbyColorChoice?.value)} · ${timeControlLabel(timeControl)}${selectedMode === 'ai' ? ` · ${difficultySummary}` : ''}`);
  updateAdaptiveLevelDisplay();
}

function removeAuthoritativeTimeControlOption(selectElement) {
  selectElement?.querySelector(`option[value="${AUTHORITATIVE_TIME_CONTROL_VALUE}"]`)?.remove();
}

function syncTimeControlSelector(value) {
  if (value === undefined || value === null) return;
  onlineTimeControl = value;
  const preset = typeof value === 'string' && Object.hasOwn(TIME_CONTROLS, value) ? value : null;
  if (preset) {
    removeAuthoritativeTimeControlOption(timeControlSelect);
    if (timeControlSelect) timeControlSelect.value = preset;
    if (Object.hasOwn(TIME_CONTROLS, preset) && lobbyTimeControl) lobbyTimeControl.value = preset;
    selectedTimeControl = preset;
    return;
  }

  const controls = [timeControlSelect];
  for (const selectElement of controls) {
    if (!selectElement) continue;
    let option = selectElement.querySelector(`option[value="${AUTHORITATIVE_TIME_CONTROL_VALUE}"]`);
    if (!option) {
      option = document.createElement('option');
      option.value = AUTHORITATIVE_TIME_CONTROL_VALUE;
      selectElement.append(option);
    }
    option.textContent = `Server · ${timeControlLabel(value)}`;
    selectElement.value = AUTHORITATIVE_TIME_CONTROL_VALUE;
  }
}

function restorePresetTimeControl() {
  if (timeControlSelect?.value === AUTHORITATIVE_TIME_CONTROL_VALUE) {
    removeAuthoritativeTimeControlOption(timeControlSelect);
    timeControlSelect.value = selectedTimeControl in TIME_CONTROLS ? selectedTimeControl : '5+3';
  }
}

function controlForTime(value = timeControlSelect?.value || selectedTimeControl) {
  return TIME_CONTROLS[value] || (isNetworkMode() ? timeControlDetails(onlineTimeControl) : null) || TIME_CONTROLS['5+3'];
}

function saveSnapshot() {
  return {
    game,
    clocks: { ...clocks },
    localResult,
  };
}

function restoreSnapshot(snapshot) {
  game = snapshot.game;
  clocks = { ...snapshot.clocks };
  localResult = snapshot.localResult;
  clockStamp = performance.now();
}

function setModeControls() {
  if (STATIC_DEMO_MODE && NETWORK_MODES.has(mode)) mode = 'ai';
  applyStaticDemoUi();
  if (modeSelect && MODE_VALUES.has(mode)) modeSelect.value = mode;
  if (timeControlSelect && !isNetworkMode() && Object.hasOwn(TIME_CONTROLS, selectedTimeControl)) {
    timeControlSelect.value = selectedTimeControl;
  }
  if (aiSettings) aiSettings.hidden = mode !== 'ai';
  if (enginePanel) enginePanel.hidden = mode !== 'ai';
  if (onlineSettings) {
    const showOnlinePanel = isNetworkMode()
      && (Boolean(onlineGameId) || (mode === 'quick' && Boolean(quickMatchRequest)))
      && !gameScreen?.hidden;
    onlineSettings.hidden = !showOnlinePanel;
    onlineSettings.setAttribute('aria-hidden', String(!showOnlinePanel));
    onlineSettings.style.setProperty('display', showOnlinePanel ? 'block' : 'none', 'important');
    for (const child of onlineSettings.children) {
      if (child === onlineActions || child === onlineRoomStatus) continue;
      child.hidden = true;
    }
  }
  if (colorSelect) colorSelect.disabled = mode !== 'ai';
  if (difficultySelect) difficultySelect.disabled = mode !== 'ai';
  if (lobbyDifficultySelect) lobbyDifficultySelect.disabled = gameChoice?.value !== 'ai';
  updateAdaptiveLevelDisplay();
  if (timeControlSelect) timeControlSelect.disabled = isNetworkMode() && Boolean(onlineGameId);
  if (opponentHeadingElement) {
    const opponent = onlinePlayers.find((player) => player.color && !colorsMatch(player.color, onlineColor));
    opponentHeadingElement.textContent = mode === 'ai'
      ? 'NovaForge'
      : mode === 'local'
        ? 'Local opponent'
        : mode === 'quick'
          ? opponent?.displayName || 'Random opponent'
        : opponent?.displayName || 'Friend match';
  }
  if (onlineRoomStatus) {
    onlineRoomStatus.hidden = !isNetworkMode() || (!onlineGameId && mode !== 'quick');
    if (!isNetworkMode() || (!onlineGameId && mode !== 'quick')) {
      onlineRoomStatus.textContent = 'Friend game connection is ready when both players connect.';
    }
  }
  if (resignLocalButton) resignLocalButton.hidden = mode !== 'local';
  if (resignAiButton) resignAiButton.hidden = mode !== 'ai';
  if (resignButton) resignButton.hidden = !isNetworkMode() || !onlineGameId;
  if (newGameButton) newGameButton.disabled = isNetworkMode() && Boolean(onlineGameId);
}

function formatClock(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function renderClocks() {
  const firstColor = mode === 'local' ? WHITE : isNetworkMode() ? onlineColor ?? requestedColor : humanColor;
  const firstKey = chessColor(firstColor) === WHITE ? 'white' : 'black';
  const secondKey = firstKey === 'white' ? 'black' : 'white';
  setText(humanClockElement, formatClock(clocks[firstKey]));
  setText(opponentClockElement, formatClock(clocks[secondKey]));
  humanClockElement?.classList.toggle('low-time', clocks[firstKey] < 20_000);
  opponentClockElement?.classList.toggle('low-time', clocks[secondKey] < 20_000);
}

function tickClocks() {
  const now = performance.now();
  const elapsed = Math.max(0, now - clockStamp);
  clockStamp = now;
  const active = isNetworkMode()
    ? onlineReady && onlineStatus?.phase === 'playing'
    : !localResult && getGameStatus(game).phase === 'playing';
  if (!active) {
    renderClocks();
    return;
  }
  if (isNetworkMode()) {
    // The server sends authoritative clock snapshots. Locally interpolating
    // only the display keeps the board responsive between those snapshots.
    const color = normalizeColorName(game.turn);
    if (color) clocks[color] = Math.max(0, clocks[color] - elapsed);
  } else {
    const color = normalizeColorName(game.turn);
    if (color) clocks[color] = Math.max(0, clocks[color] - elapsed);
    if (color && clocks[color] === 0) {
      localResult = {
        phase: 'timeout',
        winner: oppositeColor(game.turn),
        drawReason: `${color} ran out of time`,
      };
      recordAdaptiveResult(localResult);
      cancelEngine();
      closePromotion();
      render();
    }
  }
  renderClocks();
}

function visibleFiles() {
  return orientation === WHITE ? [...Array(8).keys()] : [...Array(8).keys()].reverse();
}

function visibleRanks() {
  return orientation === WHITE ? [...Array(8).keys()].reverse() : [...Array(8).keys()];
}

function pieceLabel(piece) {
  if (!piece) return 'empty';
  return `${piece > 0 ? 'white' : 'black'} ${PIECE_NAMES[typeOf(piece)]}`;
}

function isViewingHistory() {
  return Number.isInteger(viewedPly) && viewedPly >= 0 && viewedPly < game.history.length;
}

function currentViewPly() {
  return isViewingHistory() ? viewedPly : game.history.length;
}

function replayStateAtPly(sourceState, ply) {
  const history = Array.isArray(sourceState?.history) ? sourceState.history : [];
  const targetPly = Math.max(0, Math.min(history.length, Math.trunc(Number(ply) || 0)));
  if (targetPly >= history.length) return sourceState;
  const sourceVariant = normalizeVariant(sourceState?.variant) || currentVariant;
  const sourceSeed = Number.isSafeInteger(sourceState?.chess960Seed)
    ? sourceState.chess960Seed
    : currentChess960Seed;
  const initial = createVariantState(sourceVariant, sourceSeed);
  if (!initial) return null;
  let state = initial;
  try {
    for (const historyMove of history.slice(0, targetPly)) {
      const move = uciToMove(state, moveToUci(historyMove));
      if (!move) return null;
      state = applyMove(state, move, { record: true });
    }
    return state;
  } catch {
    return null;
  }
}

function viewedGameState() {
  if (!isViewingHistory()) return game;
  return replayStateAtPly(game, viewedPly) || game;
}

function setMoveViewPly(ply) {
  const total = game.history.length;
  if (!total || ply === null || ply >= total) viewedPly = null;
  else viewedPly = Math.max(0, Math.trunc(ply));
  selectedSquare = -1;
  closePromotion();
  render();
  if (analysisPanel && !analysisPanel.hidden) {
    renderAnalysisBoard();
    renderAnalysisSummary();
  }
}

function renderMoveNavigation() {
  if (!previousMoveButton || !nextMoveButton || !livePositionButton || !moveViewStatusElement) return;
  const total = game.history.length;
  const current = currentViewPly();
  previousMoveButton.disabled = current <= 0;
  nextMoveButton.disabled = current >= total;
  livePositionButton.disabled = viewedPly === null;
  setText(moveViewStatusElement, viewedPly === null
    ? 'LIVE POSITION'
    : current === 0
      ? `START POSITION · 0/${total}`
      : `PLY ${current}/${total}`);
}

function renderBoard(status, boardState = viewedGameState()) {
  if (!boardElement) return;
  boardElement.replaceChildren();
  const viewing = isViewingHistory();
  const premoving = !viewing && canQueuePremoves();
  if (premoving) boardState = premovePreviewState();
  const viewStatus = viewing || premoving ? getGameStatus(boardState) : status;
  const legalMoves = viewing
    ? []
    : premoving
      ? getLegalMoves(boardState)
      : Array.isArray(status?.legalMoves) ? status.legalMoves : [];
  const legalTargets = new Set(legalMoves.filter((move) => move.from === selectedSquare).map((move) => move.to));
  const checkedKing = viewStatus?.inCheck ? kingSquare(boardState, boardState.turn) : -1;
  const lastMove = boardState.lastMove;
  const files = visibleFiles();
  const ranks = visibleRanks();

  for (const rank of ranks) {
    for (const file of files) {
      const square = rank * 8 + file;
      const button = document.createElement('button');
      button.type = 'button';
       button.disabled = viewing;
      button.className = `square ${(file + rank) % 2 ? 'light' : 'dark'}`;
      button.dataset.square = String(square);
      button.setAttribute('role', 'gridcell');
      button.setAttribute('aria-label', `${squareName(square)}: ${pieceLabel(boardState.board[square])}`);
      if (lastMove && (lastMove.from === square || lastMove.to === square)) button.classList.add('last-move');
      if (selectedSquare === square) button.classList.add('selected');
      if (legalTargets.has(square)) {
        button.classList.add('legal-target');
        if (boardState.board[square]) button.classList.add('capture-target');
      }
      if (checkedKing === square) button.classList.add('in-check');
      if (boardState.board[square]) {
        const piece = document.createElement('span');
        piece.className = `piece ${boardState.board[square] > 0 ? 'white' : 'black'}`;
        piece.textContent = PIECE_GLYPHS[typeOf(boardState.board[square])];
        button.append(piece);
      }
      if ((orientation === WHITE && file === 0) || (orientation === BLACK && file === 7)) {
        const rankLabel = document.createElement('span');
        rankLabel.className = 'coord rank';
        rankLabel.textContent = String(rank + 1);
        button.append(rankLabel);
      }
      if ((orientation === WHITE && rank === 0) || (orientation === BLACK && rank === 7)) {
        const fileLabel = document.createElement('span');
        fileLabel.className = 'coord file';
        fileLabel.textContent = FILES[file];
        button.append(fileLabel);
      }
      button.addEventListener('click', () => onSquareClick(square));
      boardElement.append(button);
    }
  }
}

function renderHistory() {
  if (!moveCountElement || !moveHistoryElement) return;
  moveCountElement.textContent = `${game.history.length} ${game.history.length === 1 ? 'ply' : 'plies'}`;
  moveHistoryElement.replaceChildren();
  if (!game.history.length) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = 'Your first move will live here.';
    moveHistoryElement.append(empty);
    lastRenderedHistoryLength = 0;
    return;
  }
  const current = currentViewPly();
  for (let index = 0; index < game.history.length; index += 2) {
    const row = document.createElement('div');
    row.className = 'history-row';
    const number = document.createElement('span');
    number.className = 'move-number';
    number.textContent = `${Math.floor(index / 2) + 1}.`;
    row.append(number);
    for (let offset = 0; offset < 2; offset += 1) {
      const move = game.history[index + offset];
      const moveElement = move ? document.createElement('button') : document.createElement('span');
      moveElement.className = `history-move ${move && index + offset === game.history.length - 1 ? 'last' : ''}`;
      moveElement.textContent = safeText(move?.notation, '·');
      if (move) {
        moveElement.type = 'button';
        moveElement.classList.toggle('viewed', current === index + offset + 1);
        moveElement.addEventListener('click', () => setMoveViewPly(index + offset + 1));
      }
      row.append(moveElement);
    }
    moveHistoryElement.append(row);
  }
  if (game.history.length > lastRenderedHistoryLength && viewedPly === null) {
    moveHistoryElement.scrollTop = moveHistoryElement.scrollHeight;
  }
  lastRenderedHistoryLength = game.history.length;
}

function cancelAnalysisEvaluation() {
  analysisRequestCounter += 1;
  if (analysisWorker) analysisWorker.terminate();
  analysisWorker = null;
}

function clearAnalysis({ hide = true } = {}) {
  cancelAnalysisEvaluation();
  analysisForKey = null;
  analysisSnapshot = null;
  analysisStatus = null;
  analysisEvaluation = null;
  analysisWasVisible = false;
  setText(analysisTitleElement, 'Review the finished position');
  if (analysisPanel && hide) {
    analysisPanel.hidden = true;
    analysisPanel.setAttribute('aria-hidden', 'true');
  }
}

function analysisResultText(status) {
  if (!status) return 'Game finished';
  const playerColor = mode === 'local'
    ? WHITE
    : isNetworkMode()
      ? chessColor(onlineColor) ?? requestedColor
      : humanColor;
  const playerWon = status.winner !== null && colorsMatch(status.winner, playerColor);
  if (playerWon) {
    if (status.phase === 'checkmate') return 'Congratulations, you won by checkmate.';
    if (status.phase === 'timeout') return 'Congratulations, you won on time.';
    if (status.phase === 'resigned') return 'Congratulations, you won by resignation.';
  }
  if (status.phase === 'checkmate') return `${winnerText(status) || 'Player'} wins by checkmate`;
  if (status.phase === 'draw') return `Draw · ${safeText(status.drawReason || status.reason, 'agreement')}`;
  if (status.phase === 'timeout') return `${winnerText(status) || 'Game finished'}${winnerText(status) ? ' wins' : ''} on time`;
  if (status.phase === 'resigned') return `${winnerText(status) || 'Game finished'}${winnerText(status) ? ' wins' : ''} by resignation`;
  return 'Game finished';
}

function analysisGameKey(status) {
  let fen = '';
  try {
    fen = toFEN(game);
  } catch {
    fen = `${game.history.length}:${game.turn}`;
  }
  return [onlineGameId || 'local', currentVariant, game.history.length, status.phase, status.winner || '', fen].join('|');
}

function analysisViewPly() {
  const total = Array.isArray(analysisSnapshot?.history) ? analysisSnapshot.history.length : 0;
  return Number.isInteger(viewedPly) && viewedPly >= 0 ? Math.min(viewedPly, total) : total;
}

function renderAnalysisNavigation(total, current) {
  if (!analysisPreviousButton || !analysisNextButton || !analysisLiveButton || !analysisViewStatusElement) return;
  analysisPreviousButton.disabled = current <= 0;
  analysisNextButton.disabled = current >= total;
  analysisLiveButton.disabled = current >= total;
  setText(analysisViewStatusElement, current >= total ? 'FINAL POSITION' : `PLY ${current}/${total}`);
}

function renderAnalysisBoard() {
  if (!analysisBoard || !analysisSnapshot) return;
  const history = Array.isArray(analysisSnapshot.history) ? analysisSnapshot.history : [];
  const current = analysisViewPly();
  const state = current >= history.length ? analysisSnapshot : replayStateAtPly(analysisSnapshot, current);
  analysisBoard.classList.add('board');
  analysisBoard.replaceChildren();
  renderAnalysisNavigation(history.length, current);
  if (!state) {
    const error = document.createElement('p');
    error.className = 'analysis-board-error';
    error.textContent = 'This earlier position could not be reconstructed.';
    analysisBoard.append(error);
    return;
  }
  analysisBoard.style.width = '100%';
  analysisBoard.style.aspectRatio = '1';
  analysisBoard.style.height = 'auto';
  const viewStatus = getGameStatus(state);
  const checkedKing = viewStatus.inCheck ? kingSquare(state, state.turn) : -1;
  const lastMove = state.lastMove;
  const files = visibleFiles();
  const ranks = visibleRanks();

  for (const rank of ranks) {
    for (const file of files) {
      const square = rank * 8 + file;
      const cell = document.createElement('div');
      cell.className = `square ${(file + rank) % 2 ? 'light' : 'dark'}`;
      cell.dataset.square = String(square);
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('aria-label', `${squareName(square)}: ${pieceLabel(state.board[square])}`);
      if (lastMove && (lastMove.from === square || lastMove.to === square)) cell.classList.add('last-move');
      if (checkedKing === square) cell.classList.add('in-check');
      if (state.board[square]) {
        const piece = document.createElement('span');
        piece.className = `piece ${state.board[square] > 0 ? 'white' : 'black'}`;
        piece.textContent = PIECE_GLYPHS[typeOf(state.board[square])];
        cell.append(piece);
      }
      if ((orientation === WHITE && file === 0) || (orientation === BLACK && file === 7)) {
        const rankLabel = document.createElement('span');
        rankLabel.className = 'coord rank';
        rankLabel.textContent = String(rank + 1);
        cell.append(rankLabel);
      }
      if ((orientation === WHITE && rank === 0) || (orientation === BLACK && rank === 7)) {
        const fileLabel = document.createElement('span');
        fileLabel.className = 'coord file';
        fileLabel.textContent = FILES[file];
        cell.append(fileLabel);
      }
      analysisBoard.append(cell);
    }
  }
}

function appendAnalysisMoveList(parent) {
  const heading = document.createElement('strong');
  heading.textContent = 'MOVE LIST';
  parent.append(heading);
  const history = Array.isArray(analysisSnapshot?.history) ? analysisSnapshot.history : [];
  if (!history.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No moves were played.';
    parent.append(empty);
    return;
  }
  const list = document.createElement('div');
  list.className = 'analysis-moves';
  for (let index = 0; index < history.length; index += 2) {
    const row = document.createElement('div');
    row.className = 'history-row';
    const number = document.createElement('span');
    number.className = 'move-number';
    number.textContent = `${Math.floor(index / 2) + 1}.`;
    row.append(number);
    for (let offset = 0; offset < 2; offset += 1) {
      const move = history[index + offset];
      const moveElement = move ? document.createElement('button') : document.createElement('span');
      moveElement.className = `history-move ${move && index + offset === history.length - 1 ? 'last' : ''}`;
      moveElement.textContent = safeText(move?.notation, '·');
      if (move) {
        moveElement.type = 'button';
        moveElement.classList.toggle('viewed', analysisViewPly() === index + offset + 1);
        moveElement.addEventListener('click', () => setMoveViewPly(index + offset + 1));
      }
      row.append(moveElement);
    }
    list.append(row);
  }
  parent.append(list);
}

function renderAnalysisSummary() {
  if (!analysisSummary || !analysisStatus) return;
  analysisSummary.replaceChildren();
  const result = document.createElement('p');
  result.className = 'analysis-result';
  result.textContent = analysisResultText(analysisStatus);
  analysisSummary.append(result);

  const details = document.createElement('p');
  const control = onlineTimeControl || selectedTimeControl;
  const history = Array.isArray(analysisSnapshot?.history) ? analysisSnapshot.history : [];
  const current = analysisViewPly();
  details.textContent = `${variantLabel(currentVariant)} · ${timeControlLabel(control)} · ${history.length} ${history.length === 1 ? 'ply' : 'plies'} · viewing ${current}/${history.length}`;
  analysisSummary.append(details);

  const evaluation = document.createElement('p');
  evaluation.className = 'analysis-evaluation';
  if (analysisEvaluation?.error) {
    evaluation.textContent = `FINAL EVALUATION · ${analysisEvaluation.error}`;
  } else if (analysisEvaluation?.score) {
    evaluation.textContent = `FINAL EVALUATION · ${formatEngineScore(analysisEvaluation.score)} · depth ${analysisEvaluation.depth || 0}`;
  } else {
    evaluation.textContent = 'FINAL EVALUATION · calculating…';
  }
  analysisSummary.append(evaluation);
  appendAnalysisMoveList(analysisSummary);
  if (analysisEvaluation?.pv?.length) {
    const line = document.createElement('p');
    line.textContent = `BEST LINE · ${formatPV(analysisEvaluation.pv)}`;
    analysisSummary.append(line);
  }
  analysisSummary.setAttribute('aria-busy', String(!analysisEvaluation?.score && !analysisEvaluation?.error));
}

function startAnalysisEvaluation() {
  cancelAnalysisEvaluation();
  analysisEvaluation = { score: null, depth: 0, nodes: 0, elapsedMs: 0, pv: [] };
  renderAnalysisSummary();
  if (!analysisSnapshot || typeof Worker === 'undefined') {
    analysisEvaluation = {
      score: mode === 'ai' ? engineData.score : null,
      depth: mode === 'ai' ? engineData.depth : 0,
      nodes: mode === 'ai' ? engineData.nodes : 0,
      elapsedMs: mode === 'ai' ? engineData.elapsedMs : 0,
      pv: mode === 'ai' ? engineData.pv : [],
      ...(mode === 'ai' ? {} : { error: 'Unavailable in this browser' }),
    };
    renderAnalysisSummary();
    return;
  }

  const requestId = analysisRequestCounter;
  try {
    analysisWorker = new Worker(new URL('./engine-worker.js', import.meta.url), { type: 'module' });
  } catch {
    analysisEvaluation = { error: 'Unavailable in this browser' };
    renderAnalysisSummary();
    return;
  }
  analysisWorker.onmessage = (event) => {
    const message = event.data || {};
    if (requestId !== analysisRequestCounter) return;
    if (message.type === 'info' || message.type === 'bestmove') {
      analysisEvaluation = {
        score: message.score || analysisEvaluation?.score || { cp: 0 },
        depth: message.depth || 0,
        nodes: message.nodes || 0,
        elapsedMs: message.elapsedMs || 0,
        pv: Array.isArray(message.pv) ? message.pv : analysisEvaluation?.pv || [],
      };
      renderAnalysisSummary();
      if (message.type === 'bestmove') {
        analysisWorker?.terminate();
        analysisWorker = null;
      }
      return;
    }
    if (message.type === 'error') {
      analysisEvaluation = { error: safeMessage(message.message, 'Search failed') };
      analysisWorker?.terminate();
      analysisWorker = null;
      renderAnalysisSummary();
    }
  };
  analysisWorker.onerror = () => {
    if (requestId !== analysisRequestCounter) return;
    analysisEvaluation = { error: 'Unavailable in this browser' };
    analysisWorker = null;
    renderAnalysisSummary();
  };
  analysisWorker.postMessage({
    type: 'search',
    requestId,
    fen: engineFEN(analysisSnapshot),
    repetitionCounts: [...(analysisSnapshot.positionCounts || new Map()).entries()],
    limits: { timeMs: 600, maxDepth: 10 },
  });
}

function maybeOpenAnalysis(status) {
  if (!analysisPanel || !FINISHED_PHASES.has(status?.phase)) return;
  const key = analysisGameKey(status);
  if (analysisForKey === key) return;
  analysisForKey = key;
  analysisSnapshot = game;
  analysisStatus = { ...status };
  if (analysisTitleElement) {
    const playerColor = mode === 'local'
      ? WHITE
      : isNetworkMode()
        ? chessColor(onlineColor) ?? requestedColor
        : humanColor;
    analysisTitleElement.textContent = status.winner !== null && colorsMatch(status.winner, playerColor)
      ? 'Congratulations, you won!'
      : status.winner === null
        ? 'Game complete · review the position'
        : 'Game over · review the position';
  }
  analysisWasVisible = true;
  analysisPanel.hidden = false;
  analysisPanel.setAttribute('aria-hidden', 'false');
  renderAnalysisBoard();
  renderAnalysisSummary();
  startAnalysisEvaluation();
  analysisPanel.focus?.();
}

function closeAnalysis() {
  if (!analysisPanel) return;
  analysisWasVisible = false;
  analysisPanel.hidden = true;
  analysisPanel.setAttribute('aria-hidden', 'true');
}

function formatEngineScore(score) {
  if (!score) return '+0.00';
  if (typeof score.mate === 'number') return `${score.mate > 0 ? '+' : '-'}M${Math.abs(score.mate)}`;
  const pawns = (score.cp || 0) / 100;
  if (Math.abs(pawns) < 0.005) return '0.00';
  return `${pawns > 0 ? '+' : '-'}${Math.abs(pawns).toFixed(2)}`;
}

function formatPV(pv) {
  if (!Array.isArray(pv) || !pv.length) return 'Awaiting your first move';
  return pv
    .filter((uci) => typeof uci === 'string')
    .map((uci) => `${uci.slice(0, 2)}-${uci.slice(2, 4)}${uci[4] ? `=${uci[4].toUpperCase()}` : ''}`)
    .join('  ');
}

function renderEnginePanel() {
  const score = engineData.score || { cp: 0 };
  setText(engineEvalElement, formatEngineScore(score));
  setText(engineDepthElement, `DEPTH ${engineData.depth || 0}`);
  setText(engineNodesElement, `${(engineData.nodes || 0).toLocaleString()} NODES`);
  setText(engineTimeElement, `${((engineData.elapsedMs || 0) / 1000).toFixed(1)}S`);
  setText(engineLineElement, formatPV(engineData.pv));
  const numericScore = typeof score.cp === 'number' ? score.cp : (score.mate > 0 ? 1600 : -1600);
  const width = Math.max(5, Math.min(95, 50 + numericScore / 32));
  if (evalFillElement) evalFillElement.style.width = `${width}%`;
  setText(
    thinkingCopyElement,
    thinking
      ? 'NovaForge is calculating...'
      : mode === 'ai'
        ? 'Waiting for your next idea'
      : mode === 'local'
        ? 'Local board · both sides enabled'
        : mode === 'quick'
          ? onlineReady
            ? 'Live quick match · server authoritative'
            : 'Searching for a random opponent'
          : onlineReady
            ? 'Live friend game · server authoritative'
            : 'Waiting for the friend game connection',
  );
}

function renderStatus(status) {
  const displayHumanColor = mode === 'local' ? WHITE : isNetworkMode() ? onlineColor ?? requestedColor : humanColor;
  const humanPlayer = onlinePlayers.find((player) => colorsMatch(player.color, onlineColor));
  const opponentPlayer = onlinePlayers.find((player) => player.color && !colorsMatch(player.color, onlineColor));
  const accountName = account?.displayName?.toUpperCase() || colorText(displayHumanColor);
  setText(humanNameElement, isNetworkMode() ? humanPlayer?.displayName?.toUpperCase() || accountName : accountName);
  setText(opponentNameElement, isNetworkMode()
    ? opponentPlayer?.displayName?.toUpperCase() || 'WAITING'
    : mode === 'local' ? 'BLACK' : 'NOVAFORGE');
  setText(opponentHeadingElement, mode === 'ai'
    ? 'NovaForge'
    : mode === 'local'
      ? 'Local opponent'
      : mode === 'quick'
        ? opponentPlayer?.displayName || 'Random opponent'
      : opponentPlayer?.displayName || 'Friend match');
  if (onlinePillElement) onlinePillElement.textContent = mode === 'online' ? 'FRIEND' : mode === 'quick' ? 'QUICK' : 'LOCAL';
  setText(matchClockElement, authenticated ? `Move ${String(Math.floor(game.history.length / 2) + 1).padStart(2, '0')}` : 'Sign in required');
  setText(positionElement, game.history.length ? `MOVE ${game.history.length}` : 'STARTING');

  const humanWon = colorsMatch(status?.winner, displayHumanColor);
  if (isNetworkMode() && !onlineReady && status.phase === 'playing') {
    setText(statusElement, onlineGameId ? 'Waiting for both players' : 'Waiting for a friend game');
    if (statusElement) statusElement.style.color = 'var(--gold)';
    setText(humanStateElement, onlineColor ? `${colorText(onlineColor)} SEAT` : 'NOT CONNECTED');
    setText(engineStateElement, mode === 'quick' ? 'QUICK MATCH' : 'FRIEND GAME');
  } else if (status.phase === 'checkmate') {
    setText(statusElement, mode === 'local'
      ? `${winnerText(status)} wins by checkmate`
      : humanWon ? 'You found mate' : isNetworkMode() ? `${winnerText(status)} wins by checkmate` : 'NovaForge found mate');
    if (statusElement) statusElement.style.color = humanWon ? 'var(--gold)' : 'var(--coral)';
    setText(humanStateElement, humanWon ? 'VICTORY' : 'CHECKMATED');
    setText(engineStateElement, humanWon ? 'OUT OF MOVES' : 'VICTORY');
  } else if (status.phase === 'draw') {
    setText(statusElement, `Draw · ${safeText(status.drawReason || status.reason, 'agreement')}`);
    if (statusElement) statusElement.style.color = 'var(--gold)';
    setText(humanStateElement, 'DRAWN GAME');
    setText(engineStateElement, 'DRAWN GAME');
  } else if (status.phase === 'timeout' || status.phase === 'resigned') {
    const winner = winnerText(status);
    setText(statusElement, winner ? `${winner} wins · ${status.phase === 'timeout' ? 'on time' : 'resignation'}` : 'Game finished');
    if (statusElement) statusElement.style.color = humanWon ? 'var(--gold)' : 'var(--coral)';
    setText(humanStateElement, humanWon ? 'VICTORY' : 'DEFEATED');
    setText(engineStateElement, humanWon ? 'GAME OVER' : 'VICTORY');
  } else if (thinking) {
    setText(statusElement, 'NovaForge is thinking');
    if (statusElement) statusElement.style.color = 'var(--mint)';
    setText(humanStateElement, 'HOLD YOUR LINE');
    setText(engineStateElement, 'CALCULATING');
  } else if (mode === 'local') {
    setText(statusElement, status.inCheck ? `Check · ${colorText(game.turn)} to respond` : `${colorText(game.turn)} to move`);
    if (statusElement) statusElement.style.color = status.inCheck ? 'var(--coral)' : 'var(--mint)';
    setText(humanStateElement, game.turn === WHITE ? 'WHITE TO MOVE' : 'BLACK TO MOVE');
    setText(engineStateElement, 'LOCAL MATCH');
  } else if (isNetworkMode() && game.turn === chessColor(onlineColor)) {
    setText(statusElement, status.inCheck ? 'Check · your response' : 'Your move');
    if (statusElement) statusElement.style.color = status.inCheck ? 'var(--coral)' : 'var(--mint)';
    setText(humanStateElement, status.inCheck ? 'IN CHECK' : 'YOUR MOVE');
    setText(engineStateElement, 'OPPONENT WAITING');
  } else if (isNetworkMode()) {
    setText(statusElement, 'Opponent to move');
    if (statusElement) statusElement.style.color = 'var(--mint)';
    setText(humanStateElement, 'STAY READY');
    setText(engineStateElement, 'YOUR TURN NEXT');
  } else if (game.turn === humanColor) {
    setText(statusElement, status.inCheck ? 'Check · your response' : 'Your move');
    if (statusElement) statusElement.style.color = status.inCheck ? 'var(--coral)' : 'var(--mint)';
    setText(humanStateElement, status.inCheck ? 'IN CHECK' : 'YOUR MOVE');
    setText(engineStateElement, 'WATCHING CLOSELY');
  } else {
    setText(statusElement, 'NovaForge to move');
    if (statusElement) statusElement.style.color = 'var(--mint)';
    setText(humanStateElement, 'STAY READY');
    setText(engineStateElement, 'YOUR TURN NEXT');
  }
  if (isViewingHistory()) {
    setText(statusElement, `Viewing ply ${viewedPly} of ${game.history.length}`);
    if (statusElement) statusElement.style.color = 'var(--ink-soft)';
    setText(humanStateElement, 'HISTORY VIEW');
    setText(engineStateElement, 'LIVE GAME PAUSED');
  }
  if (resignLocalButton) resignLocalButton.disabled = status?.phase !== 'playing' || isViewingHistory();
  if (resignAiButton) resignAiButton.disabled = status?.phase !== 'playing' || isViewingHistory();
  if (undoButton) undoButton.disabled = isNetworkMode()
    || previousStates.length === 0
    || thinking
    || FINISHED_PHASES.has(status?.phase)
    || isViewingHistory();
  renderClocks();
}

function renderRatings(status) {
  if (!ratingSummaryElement) return;
  ratingSummaryElement.replaceChildren();
  const result = isNetworkMode() && FINISHED_PHASES.has(status?.phase) ? status?.result : null;
  const ratings = result?.ratings;
  if (!ratings || !onlineColor) {
    ratingSummaryElement.hidden = true;
    return;
  }
  const heading = document.createElement('div');
  heading.className = 'rating-summary-heading';
  heading.textContent = `SERVER RATING · ${safeText(result.category || ratings.category, 'FRIEND GAME').toUpperCase()} · FINISHED`;
  ratingSummaryElement.append(heading);
  const ownRow = document.createElement('div');
  ownRow.className = 'rating-summary-row';
  const ownLabel = document.createElement('span');
  ownLabel.textContent = 'YOUR RATING';
  const ownValue = document.createElement('strong');
  ownValue.textContent = String(Math.round(ratings[onlineColor]));
  ownRow.append(ownLabel, ownValue);
  const opponentRow = document.createElement('div');
  opponentRow.className = 'rating-summary-row';
  const opponentLabel = document.createElement('span');
  opponentLabel.textContent = 'OPPONENT RATING';
  const opponentValue = document.createElement('strong');
  opponentValue.textContent = String(Math.round(ratings[onlineColor === 'white' ? 'black' : 'white']));
  opponentRow.append(opponentLabel, opponentValue);
  ratingSummaryElement.append(ownRow, opponentRow);
  ratingSummaryElement.hidden = false;
}

function renderOnlineControls(status) {
  if (!onlineActions) return;
  const active = isNetworkMode() && Boolean(onlineGameId) && !gameScreen?.hidden;
  onlineActions.hidden = !active;
  if (!active) {
    if (onlineSettings) {
      const showQuickStatus = mode === 'quick' && Boolean(quickMatchRequest) && !gameScreen?.hidden;
      onlineSettings.style.setProperty('display', showQuickStatus ? 'block' : 'none', 'important');
    }
    return;
  }
  const phase = normalizePhase(status?.phase);
  const drawOffer = normalizeColorName(status?.drawOffer);
  const opponentOfferedDraw = Boolean(drawOffer && !colorsMatch(drawOffer, onlineColor));
  const canAct = onlineReady && socketConnected && socket?.readyState === WebSocket.OPEN && phase === 'playing';
  const rematchVotes = normalizeColorList(status?.rematchVotes);

  if (!onlineReady) {
    setText(onlineActionStatus, 'WAITING FOR BOTH PLAYERS TO CONNECT');
  } else if (phase !== 'playing') {
    setText(onlineActionStatus, `GAME FINISHED · ${rematchVotes.length}/2 REMATCH VOTES`);
  } else if (opponentOfferedDraw) {
    setText(onlineActionStatus, `${colorText(drawOffer)} OFFERED A DRAW`);
  } else if (drawOffer && colorsMatch(drawOffer, onlineColor)) {
    setText(onlineActionStatus, 'DRAW OFFER SENT · WAITING FOR RESPONSE');
  } else {
    setText(onlineActionStatus, mode === 'quick' ? 'QUICK MATCH · SERVER AUTHORITATIVE' : 'FRIEND GAME · SERVER AUTHORITATIVE');
  }

  if (offerDrawButton) {
    offerDrawButton.hidden = opponentOfferedDraw;
    offerDrawButton.disabled = !canAct || Boolean(drawOffer);
  }
  if (acceptDrawButton) {
    acceptDrawButton.hidden = !opponentOfferedDraw;
    acceptDrawButton.disabled = !canAct;
  }
  if (resignButton) resignButton.disabled = !canAct;

  // The current server protocol has no separate claim-draw action. Keep the
  // legacy container quiet instead of sending an unsupported message type.
  if (claimableDrawsElement) {
    claimableDrawsElement.replaceChildren();
    claimableDrawsElement.hidden = true;
  }

  const finished = FINISHED_PHASES.has(phase);
  if (rematchPanel) rematchPanel.hidden = !finished;
  if (finished) {
    const voteLabel = rematchVotes.length ? rematchVotes.map(colorText).join(' + ') : 'NONE';
    setText(rematchVotesElement, `${rematchVotes.length}/2 · ${voteLabel}`);
    const voted = rematchVotes.some((color) => colorsMatch(color, onlineColor));
    if (rematchButton) {
      rematchButton.disabled = !onlineReady || !socketConnected || socket?.readyState !== WebSocket.OPEN || voted;
      rematchButton.textContent = voted ? 'REMATCH VOTE SENT' : 'REQUEST REMATCH';
    }
  }
}

function currentStatus() {
  const rules = getGameStatus(game);
  if (isNetworkMode() && onlineStatus) {
    return {
      ...rules,
      ...onlineStatus,
      legalMoves: onlineStatus.phase === 'playing' ? rules.legalMoves : [],
    };
  }
  if (localResult) return { ...rules, ...localResult, legalMoves: [] };
  return rules;
}

function premoveInputColor() {
  if (mode === 'ai') return humanColor;
  if (isNetworkMode()) return chessColor(onlineColor);
  return null;
}

function canQueuePremoves() {
  const inputColor = premoveInputColor();
  if (inputColor === null || isViewingHistory() || gameScreen?.hidden || currentStatus().phase !== 'playing') return false;
  if (mode === 'ai') return game.turn !== inputColor;
  return onlineReady
    && socketConnected
    && socket?.readyState === WebSocket.OPEN
    && game.turn !== inputColor;
}

function premovePreviewState() {
  const inputColor = premoveInputColor();
  if (inputColor === null) return game;
  return previewPremoveState(game, premoveQueue, inputColor);
}

function renderPremoveControls() {
  const queued = premoveQueue.length;
  const active = canQueuePremoves() || queued > 0 || Boolean(premoveInFlight);
  if (!premoveStatusElement || !clearPremovesButton) return;
  setText(
    premoveStatusElement,
    premoveInFlight
      ? `PREMOVE SENT · ${queued} QUEUED`
      : active
        ? queued ? `PREMOVES · ${queued} QUEUED` : 'PREMOVE READY'
        : 'PREMOVES OFF',
  );
  premoveStatusElement.classList.toggle('active', active);
  clearPremovesButton.disabled = queued === 0;
}

function resetPremoves() {
  premoveQueue = [];
  premoveInFlight = null;
  if (pendingPromotionType === 'premove') closePromotion();
  selectedSquare = -1;
}

function clearPremoves() {
  premoveQueue = [];
  selectedSquare = -1;
  if (pendingPromotionType === 'premove') {
    closePromotion();
  }
  render();
}

function queuePremove(move) {
  if (!move || !canQueuePremoves()) return false;
  premoveQueue.push({ uci: moveToUci(move) });
  selectedSquare = -1;
  closePromotion();
  render();
  return true;
}

function drainPremoves() {
  if (!premoveQueue.length || isViewingHistory() || currentStatus().phase !== 'playing') return;
  if (mode === 'ai') {
    if (game.turn !== humanColor || thinking) return;
    const result = resolvePremove(game, premoveQueue);
    if (result.stale) {
      premoveQueue = [];
      showToast('The queued premove is no longer legal.');
      render();
      return;
    }
    premoveQueue = result.queue;
    commitMove(result.move);
    return;
  }
  if (!isNetworkMode() || premoveInFlight || !inputEnabled()) return;
  const planned = premoveQueue[0];
  const result = resolvePremove(game, premoveQueue);
  if (result.stale || !planned) {
    premoveQueue = result.queue;
    showToast('The queued premove is no longer legal.');
    render();
    return;
  }
  const sent = sendOnlineAction({ type: 'friendMove', uci: moveToUci(result.move) });
  if (!sent) {
    render();
    return;
  }
  premoveQueue = result.queue;
  premoveInFlight = planned.uci;
  selectedSquare = -1;
  render();
}

function render() {
  const status = currentStatus();
  setModeControls();
  renderBoard(status);
  renderPremoveControls();
  renderHistory();
  renderMoveNavigation();
  renderEnginePanel();
  renderStatus(status);
  renderRatings(status);
  renderOnlineControls(status);
  maybeOpenAnalysis(status);
}

function isHumanPiece(square) {
  const inputColor = mode === 'local' ? game.turn : isNetworkMode() ? chessColor(onlineColor) : humanColor;
  return game.board[square] && (game.board[square] > 0 ? WHITE : BLACK) === inputColor;
}

function inputEnabled() {
  if (isViewingHistory() || thinking || premoveInFlight || currentStatus().phase !== 'playing') return false;
  if (mode === 'local') return true;
  if (isNetworkMode()) {
    return onlineReady
      && socketConnected
      && socket?.readyState === WebSocket.OPEN
      && game.turn === chessColor(onlineColor);
  }
  return game.turn === humanColor;
}

function turnColor() {
  return normalizeColorName(game.turn);
}

function onPremoveSquareClick(square) {
  if (!canQueuePremoves() || pendingPromotion) return;
  const preview = premovePreviewState();
  const legalMoves = getLegalMoves(preview);
  const clickedPiece = preview.board[square];
  const clickedPieceIsMine = clickedPiece && (clickedPiece > 0 ? WHITE : BLACK) === premoveInputColor();
  if (selectedSquare >= 0) {
    const candidates = legalMoves.filter((move) => move.from === selectedSquare && move.to === square);
    if (candidates.length > 1) {
      openPromotion(candidates, { premove: true });
      return;
    }
    if (candidates.length === 1) {
      queuePremove(candidates[0]);
      return;
    }
    if (clickedPieceIsMine) {
      selectedSquare = square;
      render();
      return;
    }
    selectedSquare = -1;
    render();
    return;
  }
  if (clickedPieceIsMine && legalMoves.some((move) => move.from === square)) {
    selectedSquare = square;
    render();
  }
}

function openPromotion(moves, { premove = false } = {}) {
  promotionReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  pendingPromotion = moves;
  pendingPromotionType = premove ? 'premove' : 'live';
  promotionOptions?.replaceChildren();
  const colorClass = (premove ? premoveInputColor() : game.turn) === WHITE ? 'white' : 'black';
  for (const promotion of promotionOrder) {
    const selected = moves.find((move) => move.promotion === promotion);
    if (!selected) continue;
    const choice = document.createElement('button');
    choice.type = 'button';
    choice.className = 'promotion-choice';
    const piece = document.createElement('span');
    piece.className = `piece ${colorClass}`;
    piece.textContent = PIECE_GLYPHS[promotion];
    const label = document.createElement('span');
    label.textContent = PIECE_NAMES[promotion].toUpperCase();
    choice.append(piece, label);
    choice.addEventListener('click', () => {
      const promotionMove = selected;
      closePromotion();
      if (premove) queuePremove(promotionMove);
      else commitMove(promotionMove);
    });
    promotionOptions?.append(choice);
  }
  if (promotionModal) promotionModal.hidden = false;
  promotionOptions?.querySelector('button')?.focus();
}

function sendOnlineAction(action, { queue = false } = {}) {
  if (STATIC_DEMO_MODE) {
    rejectStaticNetworkMode();
    return false;
  }
  if (!action || (!ONLINE_ACTION_TYPES.has(action.type) && !QUICK_ACTION_TYPES.has(action.type))) return false;
  if (socket && socket.readyState === WebSocket.OPEN) {
    try {
      socket.send(JSON.stringify(action));
      return true;
    } catch {
      return false;
    }
  }
  if (!queue || !authenticated) return false;
  pendingSocketActions.push(action);
  if (!connectOnline()) {
    pendingSocketActions.pop();
    return false;
  }
  return true;
}

function connectOnline() {
  if (STATIC_DEMO_MODE) return false;
  if (!authenticated || typeof WebSocket === 'undefined') return false;
  if (!window.location.host) {
    setText(onlineRoomStatus, 'Serve Nova Chess over HTTP to connect online games.');
    return false;
  }
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return true;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}`;
  const generation = socketGeneration + 1;
  socketGeneration = generation;
  let connection;
  try {
    connection = new WebSocket(url);
  } catch {
    setText(onlineRoomStatus, 'Online game connection could not start.');
    return false;
  }
  socket = connection;
  setText(onlineRoomStatus, 'CONNECTING TO ONLINE GAMES...');

  connection.addEventListener('open', () => {
    if (socket !== connection || socketGeneration !== generation) return;
    socketConnected = true;
    setText(onlineRoomStatus, 'CONNECTED · waiting for online game updates');
    const queued = pendingSocketActions;
    pendingSocketActions = [];
    for (const action of queued) sendOnlineAction(action, { queue: false });
    render();
  });
  connection.addEventListener('message', (event) => {
    if (socket !== connection || socketGeneration !== generation) return;
    let message;
    try {
      message = JSON.parse(typeof event.data === 'string' ? event.data : '');
    } catch {
      showToast('The online game server sent an invalid message.');
      return;
    }
    handleOnlineMessage(message, connection, generation);
  });
  connection.addEventListener('error', () => {
    if (socket !== connection || socketGeneration !== generation) return;
    setText(onlineRoomStatus, 'ONLINE GAME CONNECTION ERROR');
    showToast('Could not connect to online games.');
  });
  connection.addEventListener('close', () => {
    if (socket !== connection || socketGeneration !== generation) return;
    socket = null;
    socketConnected = false;
    onlineReady = false;
    if (authenticated) {
      setText(onlineRoomStatus, onlineGameId ? 'ONLINE GAME DISCONNECTED' : 'ONLINE GAME UPDATES DISCONNECTED');
      render();
      if (!reconnectTimer) {
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = null;
          connectOnline();
        }, 1000);
      }
    }
  });
  return true;
}

function validOpaqueId(value) {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return id && id.length <= 128 ? id : null;
}

function normalizeInvite(value) {
  const inviteId = validOpaqueId(value?.inviteId);
  const fromHandle = sanitizeHandle(value?.from?.handle);
  if (!inviteId || !fromHandle) return null;
  const variant = normalizeVariant(value.variant) || 'standard';
  return {
    inviteId,
    from: {
      handle: fromHandle,
      displayName: sanitizeDisplayName(value.from.displayName) || fromHandle,
    },
    variant,
    chess960Seed: Number.isSafeInteger(value.chess960Seed) ? value.chess960Seed : null,
    color: normalizeColorChoice(value.color),
    timeControl: Object.hasOwn(TIME_CONTROLS, value.timeControl) ? value.timeControl : timeControlDetails(value.timeControl),
  };
}

function renderFriendActions() {
  if (!friendActionsElement) return;
  friendActionsElement.replaceChildren();
  const heading = document.createElement('span');
  heading.textContent = 'Friend actions';
  friendActionsElement.append(heading);
  if (!selectedFriendHandle) {
    const note = document.createElement('span');
    note.textContent = 'Select a friend for the next lobby match.';
    friendActionsElement.append(note);
    return;
  }
  const selected = document.createElement('span');
  selected.textContent = `Selected friend: ${selectedFriendHandle}`;
  friendActionsElement.append(selected);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'text-button';
  button.textContent = 'Use selected friend';
  button.addEventListener('click', () => {
    if (gameChoice) gameChoice.value = 'online';
    updateLobbySummary();
    setFriendStatus(`Ready to invite ${selectedFriendHandle} from the lobby.`);
    lobbyForm?.scrollIntoView({ block: 'nearest' });
  });
  friendActionsElement.append(button);
}

function appendActionButton(parent, label, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'text-button';
  button.textContent = label;
  button.addEventListener('click', handler);
  parent.append(button);
  return button;
}

function renderFriends() {
  if (!friendsListElement || !friendInvitesElement) return;
  friendsListElement.replaceChildren();
  if (!friends.friends.length) {
    const empty = document.createElement('li');
    empty.className = 'empty-list';
    empty.textContent = 'No friends added yet.';
    friendsListElement.append(empty);
  }
  for (const friend of friends.friends) {
    const item = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `${friend.displayName} (@${friend.handle}) · ${friend.online ? 'ONLINE' : 'OFFLINE'}`;
    item.append(label);
    const selected = friend.handle === selectedFriendHandle;
    const button = appendActionButton(item, selected ? 'Selected' : 'Select', () => {
      selectedFriendHandle = friend.handle;
      if (gameChoice) gameChoice.value = 'online';
      updateLobbySummary();
      renderFriends();
      setFriendStatus(`Selected ${friend.displayName} for a friend game.`);
    });
    button.setAttribute('aria-pressed', String(selected));
    friendsListElement.append(item);
  }

  friendInvitesElement.replaceChildren();
  for (const request of friends.incomingRequests) {
    const item = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `Friend request from ${request.displayName} (@${request.handle})`;
    item.append(label);
    appendActionButton(item, 'Accept', () => respondToFriendRequest(request.requestId, true));
    appendActionButton(item, 'Decline', () => respondToFriendRequest(request.requestId, false));
    friendInvitesElement.append(item);
  }
  for (const invite of pendingFriendInvites.values()) {
    const item = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `Game invite from ${invite.from.displayName} · ${variantLabel(invite.variant)} · ${timeControlLabel(invite.timeControl)} · ${colorChoiceLabel(invite.color)}`;
    item.append(label);
    appendActionButton(item, 'Accept', () => respondToFriendInvite(invite, true));
    appendActionButton(item, 'Decline', () => respondToFriendInvite(invite, false));
    friendInvitesElement.append(item);
  }
  if (!friends.incomingRequests.length && !pendingFriendInvites.size) {
    const empty = document.createElement('li');
    empty.className = 'empty-list';
    empty.textContent = 'No pending invites.';
    friendInvitesElement.append(empty);
  }
  if (friends.outgoingRequests.length) {
    setFriendStatus(`${friends.outgoingRequests.length} friend request${friends.outgoingRequests.length === 1 ? '' : 's'} pending.`);
  }
  renderFriendActions();
}

function selectFriendIfAvailable(handle) {
  const normalized = sanitizeHandle(handle);
  if (!normalized || !friends.friends.some((friend) => friend.handle === normalized)) return false;
  selectedFriendHandle = normalized;
  if (gameChoice) gameChoice.value = 'online';
  updateLobbySummary();
  renderFriends();
  return true;
}

async function requestJson(url, options = {}) {
  // fixmyslop-ignore[ui/fake-feature]: Static demo mode truthfully rejects unsupported online requests.
  if (STATIC_DEMO_MODE) { throw new ApiError('Online account and friend features are unavailable in demo mode.'); }
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  const requestOptions = {
    ...options,
    credentials: 'same-origin',
    headers,
  };
  if (options.body !== undefined && options.body !== null && !headers['content-type']) {
    headers['content-type'] = 'application/json';
  }
  let response;
  try {
    response = await fetch(url, requestOptions);
  } catch {
    throw new ApiError('The server could not be reached.');
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message;
    throw new ApiError(safeMessage(message), response.status);
  }
  return payload || {};
}

async function loadFriends() {
  if (STATIC_DEMO_MODE || !authenticated) return;
  try {
    const payload = await requestJson('/api/friends', { method: 'GET' });
    friends = normalizeFriendLists(payload);
    if (selectedFriendHandle && !friends.friends.some((friend) => friend.handle === selectedFriendHandle)) {
      selectedFriendHandle = null;
    }
    renderFriends();
    updateLobbySummary();
  } catch (error) {
    if (error.status === 401) {
      showAuthScreen('Your session has expired. Sign in again.');
      return;
    }
    setFriendStatus(error.message);
  }
}

async function sendFriendRequest() {
  if (STATIC_DEMO_MODE) {
    rejectStaticNetworkMode();
    return;
  }
  if (!authenticated) return;
  const handle = sanitizeHandle(friendHandleInput?.value);
  if (!handle) {
    setFriendStatus('Use a 3-24 character lowercase handle with letters, numbers, or underscores.');
    return;
  }
  if (friendRequestButton) friendRequestButton.disabled = true;
  try {
    await requestJson('/api/friends/request', {
      method: 'POST',
      body: JSON.stringify({ handle }),
    });
    if (friendHandleInput) friendHandleInput.value = '';
    setFriendStatus(`Friend request sent to ${handle}.`);
    await loadFriends();
  } catch (error) {
    setFriendStatus(error.message);
  } finally {
    if (friendRequestButton) friendRequestButton.disabled = false;
  }
}

async function respondToFriendRequest(requestId, accept) {
  if (STATIC_DEMO_MODE) {
    rejectStaticNetworkMode();
    return;
  }
  const safeRequestId = validOpaqueId(requestId);
  if (!safeRequestId) return;
  try {
    await requestJson('/api/friends/respond', {
      method: 'POST',
      body: JSON.stringify({ requestId: safeRequestId, accept: Boolean(accept) }),
    });
    setFriendStatus(accept ? 'Friend request accepted.' : 'Friend request declined.');
    await loadFriends();
  } catch (error) {
    setFriendStatus(error.message);
  }
}

function sendFriendInviteFor(handle, variant, timeControl, colorChoice) {
  if (STATIC_DEMO_MODE) {
    rejectStaticNetworkMode();
    return false;
  }
  if (!hasFairPlayConsent()) {
    if (termsScreen) termsScreen.open = true;
    setFriendStatus('Accept fair-play terms before starting a rated friend game.');
    return false;
  }
  const toHandle = sanitizeHandle(handle);
  const selectedVariant = normalizeVariant(variant);
  const selectedTime = typeof timeControl === 'string' && Object.hasOwn(TIME_CONTROLS, timeControl) ? timeControl : null;
  const selectedColor = normalizeColorChoice(colorChoice);
  if (!toHandle || !selectedVariant || !selectedTime) {
    setFriendStatus('Choose a valid friend, variant, and time control first.');
    return false;
  }
  const action = {
    type: 'friendInvite',
    toHandle,
    variant: selectedVariant,
    timeControl: selectedTime,
    color: selectedColor,
  };
  if (selectedVariant === 'chess960') action.chess960Seed = randomChess960Seed();
  if (!sendOnlineAction(action, { queue: true })) {
    setFriendStatus('Friend game connection is unavailable.');
    return false;
  }
  mode = 'online';
  currentVariant = selectedVariant;
  selectedTimeControl = selectedTime;
  setText(onlineRoomStatus, 'FRIEND INVITE SENT · waiting for acceptance');
  setFriendStatus(`Friend invite sent to ${toHandle}.`);
  return true;
}

function respondToFriendInvite(invite, accept) {
  if (STATIC_DEMO_MODE) {
    rejectStaticNetworkMode();
    return;
  }
  if (!invite || !validOpaqueId(invite.inviteId)) return;
  if (accept && !hasFairPlayConsent()) {
    if (termsScreen) termsScreen.open = true;
    setFriendStatus('Accept fair-play terms before starting a rated friend game.');
    return;
  }
  const action = {
    type: 'friendInviteRespond',
    inviteId: invite.inviteId,
    accept: Boolean(accept),
  };
  if (!sendOnlineAction(action, { queue: true })) {
    setFriendStatus('Friend game connection is unavailable.');
    return;
  }
  pendingFriendInvites.delete(invite.inviteId);
  renderFriends();
  if (accept) {
    mode = 'online';
    currentVariant = invite.variant;
    if (typeof invite.timeControl === 'string') selectedTimeControl = invite.timeControl;
    onlineGameId = null;
    setText(onlineRoomStatus, 'FRIEND INVITE ACCEPTED · waiting for game state');
  } else {
    setFriendStatus('Friend invite declined.');
  }
}

function startQuickMatch(variant, timeControl, colorChoice) {
  if (STATIC_DEMO_MODE) {
    rejectStaticNetworkMode();
    return false;
  }
  if (!hasFairPlayConsent()) {
    if (termsScreen) termsScreen.open = true;
    setFriendStatus('Accept fair-play terms before starting a rated quick match.');
    return false;
  }
  const selectedVariant = normalizeVariant(variant) || 'standard';
  const selectedTime = typeof timeControl === 'string' && Object.hasOwn(TIME_CONTROLS, timeControl)
    ? timeControl
    : '5+3';
  selectedColorChoice = normalizeColorChoice(colorChoice);
  requestedColor = resolveColorChoice(selectedColorChoice);
  humanColor = requestedColor;
  orientation = requestedColor;
  mode = 'quick';
  currentVariant = selectedVariant;
  currentChess960Seed = null;
  selectedTimeControl = selectedTime;
  onlineGameId = null;
  onlineColor = null;
  onlineToken = null;
  onlineStatus = null;
  onlinePlayers = [];
  onlineTimeControl = null;
  onlineRevision = -1;
  lastOnlineHistoryLength = 0;
  lastRenderedHistoryLength = 0;
  lastOnlinePhase = 'playing';
  onlineReady = false;
  quickMatchId = null;
  quickMatchRequest = {
    variant: selectedVariant,
    timeControl: selectedTime,
    color: selectedColorChoice,
  };
  if (modeSelect) modeSelect.value = 'quick';
  if (timeControlSelect) timeControlSelect.value = selectedTime;
  const started = resetLocalGameState(selectedVariant, null);
  if (!started) return false;
  const sent = sendOnlineAction({
    type: 'quickMatch',
    variant: selectedVariant,
    timeControl: selectedTime,
    color: selectedColorChoice,
  }, { queue: true });
  if (!sent) {
    showToast('Online matching needs the Nova Chess server.');
    return false;
  }
  setText(onlineRoomStatus, 'SEARCHING FOR A RANDOM OPPONENT…');
  showGameScreen();
  render();
  return true;
}

function startSelectedGame(event) {
  event?.preventDefault();
  if (!authenticated) {
    if (STATIC_DEMO_MODE) {
      activateStaticDemo();
      return;
    }
    showAuthScreen('Sign in or create an account before starting a game.');
    return;
  }
  const selectedMode = MODE_VALUES.has(gameChoice?.value) ? gameChoice.value : 'ai';
  if (STATIC_DEMO_MODE && NETWORK_MODES.has(selectedMode)) {
    if (gameChoice) gameChoice.value = 'ai';
    updateLobbySummary();
    rejectStaticNetworkMode();
    return;
  }
  const selectedVariant = normalizeVariant(variantChoice?.value) || 'standard';
  const selectedTime = Object.hasOwn(TIME_CONTROLS, lobbyTimeControl?.value) ? lobbyTimeControl.value : '5+3';
  const selectedDifficulty = normalizeDifficulty(lobbyDifficultySelect?.value);
  if (selectedMode === 'ai' && !selectedDifficulty) {
    updateLobbySummary();
    lobbyDifficultySelect?.focus();
    lobbyDifficultySelect?.reportValidity?.();
    showToast('Choose a NovaForge strength before opening the game board.');
    return;
  }
  syncDifficultySelectors(selectedDifficulty);
  selectedColorChoice = normalizeColorChoice(lobbyColorChoice?.value);
  requestedColor = resolveColorChoice(selectedColorChoice);
  orientation = requestedColor;
  selectedTimeControl = selectedTime;
  if (isNetworkMode() && onlineStatus?.phase === 'playing' && onlineGameId) {
    showToast('Finish the active online game before starting another game.');
    return;
  }
  if (selectedMode === 'quick') {
    startQuickMatch(selectedVariant, selectedTime, selectedColorChoice);
    return;
  }
  if (selectedMode === 'online') {
    if (!selectedFriendHandle) {
      setFriendStatus('Select an accepted friend before sending a game invite.');
      updateLobbySummary();
      return;
    }
    clearAnalysis();
    mode = 'online';
    currentVariant = selectedVariant;
    humanColor = requestedColor;
    onlineGameId = null;
    onlineColor = null;
    onlineToken = null;
    onlineStatus = null;
    onlinePlayers = [];
    onlineReady = false;
    onlineTimeControl = null;
    onlineRevision = -1;
    lastOnlineHistoryLength = 0;
    lastOnlinePhase = 'playing';
    quickMatchRequest = null;
    quickMatchId = null;
   if (sendFriendInviteFor(selectedFriendHandle, selectedVariant, selectedTime, selectedColorChoice)) {
      showLobbyScreen();
      render();
    }
    return;
  }

  clearAnalysis();
  mode = selectedMode;
  humanColor = requestedColor;
  currentVariant = selectedVariant;
  currentChess960Seed = null;
  onlineStatus = null;
  onlineGameId = null;
  onlineColor = null;
  onlineToken = null;
  onlinePlayers = [];
  onlineReady = false;
  onlineTimeControl = null;
  onlineRevision = -1;
  lastOnlineHistoryLength = 0;
  lastOnlinePhase = 'playing';
  quickMatchRequest = null;
  quickMatchId = null;
  if (modeSelect) modeSelect.value = mode;
  if (timeControlSelect) timeControlSelect.value = selectedTime;
  if (colorSelect) colorSelect.value = selectedColorChoice === 'random' ? (humanColor === BLACK ? 'black' : 'white') : selectedColorChoice;
  const started = resetLocalGameState(selectedVariant, null);
  if (!started) return;
  showGameScreen();
  render();
}

function currentOnlineConnection(connection = socket, generation = socketGeneration) {
  return socket === connection && socketGeneration === generation;
}

function handleOnlineState(message, connection, generation) {
  const gameId = validOpaqueId(message.gameId);
  if (onlineGameId && gameId && onlineGameId !== gameId) return;
  const previousOnlineGameId = onlineGameId;
  const wasQuickMatch = mode === 'quick' || Boolean(quickMatchRequest);
  const previousHistoryLength = lastOnlineHistoryLength;
  const previousPhase = lastOnlinePhase;
  try {
    game = stateFromServerMessage(message);
  } catch (error) {
    showToast(safeMessage(error.message, 'The server position was rejected.'));
    return;
  }
  if (gameId) onlineGameId = gameId;
  const gameChanged = Boolean(previousOnlineGameId && gameId && previousOnlineGameId !== gameId);
  const historyRewound = game.history.length < previousHistoryLength;
  if (!game.history.length || gameChanged || historyRewound) {
    viewedPly = null;
    resetPremoves();
  }
  currentVariant = normalizeVariant(message.variant) || 'standard';
  currentChess960Seed = Number.isSafeInteger(message.chess960Seed) ? message.chess960Seed : null;
  const messageColor = normalizeColorName(message.you);
  if (messageColor) {
    onlineColor = messageColor;
    requestedColor = chessColor(messageColor);
    orientation = requestedColor;
  }
  if (typeof message.token === 'string' && message.token.length <= 128) onlineToken = message.token;
  onlineStatus = {
    phase: normalizePhase(message.phase),
    winner: normalizeColorName(message.winner),
    drawReason: safeText(message.drawReason, ''),
    reason: safeText(message.reason, ''),
    inCheck: Boolean(message.inCheck),
    claimableDraws: Array.isArray(message.claimableDraws)
      ? message.claimableDraws.filter((reason) => typeof reason === 'string').map((reason) => safeText(reason)).filter(Boolean)
      : [],
    drawOffer: normalizeColorName(message.drawOffer),
    rematchVotes: normalizeColorList(message.rematchVotes),
    gameState: safeText(message.gameState, ''),
    turn: normalizeColorName(message.turn),
    result: normalizeFinishedResult(message.result, normalizePhase(message.phase)),
    revision: Number.isSafeInteger(message.revision) ? message.revision : null,
  };
  onlinePlayers = Array.isArray(message.players) ? message.players.map(normalizeOnlinePlayer).filter(Boolean) : [];
  onlineReady = Boolean(
    message.ready
      && messageColor
      && connection?.readyState === WebSocket.OPEN
      && onlinePlayers.length === 2
      && onlinePlayers.every((player) => player.connected),
  );
  const latestMove = game.history[game.history.length - 1];
  if (premoveInFlight && latestMove && moveToUci(latestMove) === premoveInFlight) premoveInFlight = null;
  if (message.clocks) clocks = normalizeClocks(message.clocks);
  clockStamp = performance.now();
  if (Number.isSafeInteger(message.revision)) onlineRevision = message.revision;
  syncTimeControlSelector(message.timeControl);
  if (variantChoice && VARIANT_VALUES.has(currentVariant)) variantChoice.value = currentVariant;
  if (gameChoice) gameChoice.value = wasQuickMatch ? 'quick' : 'online';
  selectedSquare = -1;
  closePromotion();
  mode = wasQuickMatch ? 'quick' : 'online';
  lastOnlineHistoryLength = game.history.length;
  lastOnlinePhase = onlineStatus.phase;
  if (FINISHED_PHASES.has(onlineStatus.phase)) resetPremoves();
  if (onlineStatus.phase === 'playing' && FINISHED_PHASES.has(previousPhase)) clearAnalysis();
  if (game.history.length > previousHistoryLength && previousHistoryLength >= 0) {
    playMoveSound();
  }
  if (onlineRoomStatus) onlineRoomStatus.textContent = onlineReady
    ? `${mode === 'quick' ? 'QUICK MATCH' : 'FRIEND GAME'} · ${colorText(onlineColor)} · ${onlineStatus.phase === 'playing' ? 'LIVE' : 'FINISHED'}`
    : `${mode === 'quick' ? 'QUICK MATCH' : 'FRIEND GAME'} · waiting for both players`;
  if (currentOnlineConnection(connection, generation)) {
    showGameScreen();
    render();
    drainPremoves();
  }
}

function handleOnlineMessage(message, connection = socket, generation = socketGeneration) {
  if (!currentOnlineConnection(connection, generation) || !message || typeof message !== 'object') return;
  if (message.type === 'ready') {
    const serverAccount = normalizeAccount(message.account);
    if (serverAccount && account?.handle === serverAccount.handle) {
      account = serverAccount;
      fairPlayAccepted = serverAccount.acceptedFairPlayTerms;
      if (termsCheckbox) termsCheckbox.checked = fairPlayAccepted;
    }
    void loadFriends();
    render();
    return;
  }
  if (message.type === 'friendRequest') {
    setFriendStatus('New friend request received.');
    void loadFriends();
    return;
  }
  if (message.type === 'friendRequestResponded') {
    setFriendStatus(message.accepted ? 'A friend request was accepted.' : 'A friend request was declined.');
    void loadFriends();
    return;
  }
  if (message.type === 'friendInvite') {
    const invite = normalizeInvite(message);
    if (!invite) return;
    pendingFriendInvites.set(invite.inviteId, invite);
    renderFriends();
    showToast(`Friend game invite from ${invite.from.displayName}.`);
    return;
  }
  if (message.type === 'friendInviteSent') {
    setFriendStatus(mode === 'quick' ? 'Quick match invite sent.' : 'Friend game invite sent.');
    return;
  }
  if (message.type === 'quickMatchQueued') {
    quickMatchId = validOpaqueId(message.matchId);
    setText(onlineRoomStatus, `QUICK MATCH QUEUED · ${variantLabel(message.variant)} · ${timeControlLabel(message.timeControl)}`);
    showGameScreen();
    render();
    return;
  }
  if (message.type === 'quickMatchCancelled') {
    quickMatchId = null;
    quickMatchRequest = null;
    setText(onlineRoomStatus, 'QUICK MATCH CANCELLED');
    showLobbyScreen();
    render();
    return;
  }
  if (message.type === 'quickMatchFound' || message.type === 'quickMatched' || message.type === 'matchFound') {
    const gameId = validOpaqueId(message.gameId);
    quickMatchId = validOpaqueId(message.matchId) || quickMatchId;
    if (gameId) onlineGameId = gameId;
    const color = normalizeColorName(message.color || message.you);
    if (color) onlineColor = color;
    if (color) {
      requestedColor = chessColor(color);
      orientation = requestedColor;
    }
    if (typeof message.token === 'string' && message.token.length <= 128) onlineToken = message.token;
    mode = 'quick';
    if (message.fen) {
      handleOnlineState({ ...message, type: 'state', you: message.you || message.color }, connection, generation);
    } else if (onlineGameId && onlineToken) {
      sendOnlineAction({ type: 'friendReconnect', gameId: onlineGameId, token: onlineToken }, { queue: true });
      setText(onlineRoomStatus, 'QUICK MATCH FOUND · loading game state');
      render();
    } else {
      setText(onlineRoomStatus, 'QUICK MATCH FOUND · loading game state');
      render();
    }
    return;
  }
  if (message.type === 'friendInviteDeclined' || message.type === 'friendInviteExpired') {
    const inviteId = validOpaqueId(message.inviteId);
    if (inviteId) pendingFriendInvites.delete(inviteId);
    renderFriends();
    setFriendStatus(message.type === 'friendInviteDeclined' ? 'Friend game invite declined.' : 'Friend game invite expired.');
    return;
  }
  if (message.type === 'friendInviteAccepted') {
    const wasQuick = mode === 'quick' || Boolean(quickMatchRequest);
    const gameId = validOpaqueId(message.gameId);
    if (gameId) onlineGameId = gameId;
    const inviteId = validOpaqueId(message.inviteId);
    if (inviteId) pendingFriendInvites.delete(inviteId);
    mode = wasQuick ? 'quick' : 'online';
    setText(onlineRoomStatus, wasQuick
      ? 'QUICK MATCH INVITE ACCEPTED · waiting for game state'
      : 'FRIEND INVITE ACCEPTED · waiting for game state');
    renderFriends();
    return;
  }
  if (message.type === 'friendReconnected') {
    const wasQuick = mode === 'quick' || Boolean(quickMatchRequest);
    const gameId = validOpaqueId(message.gameId);
    if (gameId) onlineGameId = gameId;
    const color = normalizeColorName(message.color);
    if (color) onlineColor = color;
    if (typeof message.token === 'string' && message.token.length <= 128) onlineToken = message.token;
    mode = wasQuick ? 'quick' : 'online';
    setText(onlineRoomStatus, wasQuick
      ? 'QUICK MATCH RECONNECTED · waiting for state'
      : 'FRIEND GAME RECONNECTED · waiting for state');
    return;
  }
  if (message.type === 'friendGameAvailable') {
    const gameId = validOpaqueId(message.gameId);
    const token = typeof message.token === 'string' && message.token.length <= 128 ? message.token : null;
    if (!gameId || !token || (onlineGameId && onlineGameId !== gameId)) return;
    onlineGameId = gameId;
    onlineToken = token;
    mode = mode === 'quick' || quickMatchRequest ? 'quick' : 'online';
    sendOnlineAction({ type: 'friendReconnect', gameId, token }, { queue: true });
    return;
  }
  if (message.type === 'state') {
    handleOnlineState(message, connection, generation);
    return;
  }
  if (message.type === 'clock') {
    const gameId = validOpaqueId(message.gameId);
    if (gameId && onlineGameId && gameId !== onlineGameId) return;
    const messageRevision = Number.isSafeInteger(message.revision) ? message.revision : null;
    if (messageRevision !== null && onlineRevision >= 0 && messageRevision < onlineRevision) return;
    if (message.clocks) clocks = normalizeClocks(message.clocks);
    if (messageRevision !== null) onlineRevision = messageRevision;
    clockStamp = performance.now();
    renderClocks();
    return;
  }
  if (message.type === 'error') {
    const errorMessage = safeMessage(message.message);
    if (premoveInFlight) {
      premoveInFlight = null;
      premoveQueue = [];
    }
    setText(onlineRoomStatus, `ERROR · ${errorMessage}`);
    showToast(errorMessage);
    renderOnlineControls(currentStatus());
  }
}

function cancelEngine() {
  requestCounter += 1;
  if (worker) worker.terminate();
  worker = null;
  thinking = false;
}

function startEngine() {
  const status = currentStatus();
  if (mode !== 'ai' || status.phase !== 'playing' || game.turn === humanColor) return;
  if (typeof Worker === 'undefined') {
    cancelEngine();
    render();
    showToast('NovaForge needs Web Worker support in this browser. Try a current browser or choose Local two-player.');
    return;
  }
  const difficulty = selectedEngineDifficulty();
  if (!difficulty) {
    cancelEngine();
    render();
    showToast('Choose a NovaForge strength before the engine can play.');
    return;
  }
  cancelEngine();
  thinking = true;
  engineData = { score: { cp: 0 }, depth: 0, nodes: 0, elapsedMs: 0, pv: [] };
  render();
  const requestId = requestCounter;
  try {
    worker = new Worker(new URL('./engine-worker.js', import.meta.url), { type: 'module' });
  } catch {
    cancelEngine();
    render();
    showToast('NovaForge could not load. Serve this folder over localhost and try again.');
    return;
  }
  worker.onmessage = (event) => {
    const message = event.data || {};
    if (message.requestId !== requestId || requestId !== requestCounter) return;
    if (message.type === 'info') {
       engineData = {
        score: message.score,
        depth: message.depth,
        nodes: message.nodes,
        elapsedMs: message.elapsedMs,
        pv: message.pv,
      };
      renderEnginePanel();
      return;
    }
    if (message.type === 'error') {
      cancelEngine();
      render();
      showToast(`Engine error: ${safeMessage(message.message, 'search failed')}`);
      return;
    }
    if (message.type === 'bestmove') {
      thinking = false;
      worker?.terminate();
      worker = null;
      engineData = {
        score: message.score,
        depth: message.depth,
        nodes: message.nodes,
        elapsedMs: message.elapsedMs,
        pv: message.pv,
       };
       const engineMove = typeof message.move === 'string' ? uciToMove(game, message.move) : null;
       if (engineMove) {
         commitMove(engineMove);
         drainPremoves();
       }
       else render();
    }
  };
  worker.onerror = () => {
    if (requestId !== requestCounter) return;
    cancelEngine();
    render();
    showToast('NovaForge could not load. Serve this folder over localhost and try again.');
  };
  worker.postMessage({
    type: 'search',
    requestId,
    fen: engineFEN(),
    repetitionCounts: [...game.positionCounts.entries()],
    limits: {
      ...difficulty,
      variationSeed: engineVariationSeed,
    },
  });
}

function engineFEN(state = game) {
  const fen = toFEN(state);
  if (state.variant !== 'chess960') return fen;
  const fields = fen.split(/\s+/);
  // engine-worker.js parses standard FEN. Removing the standard castling
  // field lets the worker search the Chess960 board while the main thread
  // remains authoritative for Chess960 castling legality.
  fields[2] = '-';
  return fields.join(' ');
}

function resetLocalGameState(variant = currentVariant, seed = currentChess960Seed) {
  cancelEngine();
  clearAnalysis();
  closePromotion();
  resetPremoves();
  const nextState = createVariantState(variant, seed);
  if (!nextState) return false;
  game = nextState;
  currentVariant = normalizeVariant(variant) || 'standard';
  currentChess960Seed = game.chess960Seed ?? null;
  if (mode === 'ai') engineVariationSeed = randomEngineVariationSeed();
  viewedPly = null;
  selectedSquare = -1;
  previousStates = [];
  localResult = null;
  lastRenderedHistoryLength = 0;
  adaptiveResultRecorded = false;
  const control = controlForTime(selectedTimeControl);
  clocks = { white: control.initialMs, black: control.initialMs };
  clockStamp = performance.now();
  engineData = { score: { cp: 20 }, depth: 0, nodes: 0, elapsedMs: 0, pv: [] };
  render();
  if (mode === 'ai' && humanColor === BLACK) window.setTimeout(startEngine, 120);
  return true;
}

function commitMove(moveToCommit) {
  if (isNetworkMode()) {
    if (!inputEnabled()) return;
    const uci = moveToUci(moveToCommit);
    if (!sendOnlineAction({ type: 'friendMove', uci })) {
      showToast('Online game connection is unavailable.');
      return;
    }
    selectedSquare = -1;
    render();
    return;
  }
  const legal = currentStatus().legalMoves.find((candidate) => moveToUci(candidate) === moveToUci(moveToCommit));
  if (!legal) return;
  previousStates.push(saveSnapshot());
  const movingColor = game.turn;
  game = applyMove(game, legal, { record: true });
  const movingKey = movingColor === WHITE ? 'white' : 'black';
  clocks[movingKey] += controlForTime(selectedTimeControl).incrementMs;
  clockStamp = performance.now();
  selectedSquare = -1;
  const rules = getGameStatus(game);
  localResult = rules.phase === 'playing' ? null : {
    phase: rules.phase,
    winner: rules.winner,
    drawReason: rules.drawReason,
  };
  if (localResult) {
    recordAdaptiveResult(localResult);
    resetPremoves();
  }
  playMoveSound();
  render();
  if (mode === 'ai' && currentStatus().phase === 'playing' && game.turn !== humanColor) startEngine();
}

function onSquareClick(square) {
  if (pendingPromotion) return;
  if (!inputEnabled()) {
    onPremoveSquareClick(square);
    return;
  }
  const status = currentStatus();
  const clickedPieceIsHuman = isHumanPiece(square);
  if (selectedSquare >= 0) {
    const candidates = status.legalMoves.filter((move) => move.from === selectedSquare && move.to === square);
    if (candidates.length > 1) {
      openPromotion(candidates);
      return;
    }
    if (candidates.length === 1) {
      commitMove(candidates[0]);
      return;
    }
    if (clickedPieceIsHuman) {
      selectedSquare = square;
      render();
      return;
    }
    selectedSquare = -1;
    render();
    return;
  }
  if (clickedPieceIsHuman && status.legalMoves.some((move) => move.from === square)) {
    selectedSquare = square;
    render();
  }
}

function resignLocalGame(resigningColor) {
  if (mode !== 'local' && mode !== 'ai') return;
  if (currentStatus().phase !== 'playing') return;
  localResult = {
    phase: 'resigned',
    winner: oppositeColor(resigningColor),
    drawReason: null,
    reason: `${colorText(resigningColor)} resigned`,
  };
  recordAdaptiveResult(localResult);
  cancelEngine();
  resetPremoves();
  closePromotion();
  selectedSquare = -1;
  render();
}

function cancelPendingQuickMatch() {
  if (STATIC_DEMO_MODE) return false;
  if (mode !== 'quick' || onlineGameId || !quickMatchRequest) return false;
  sendOnlineAction({ type: 'cancelQuickMatch', ...(quickMatchId ? { matchId: quickMatchId } : {}) });
  quickMatchRequest = null;
  quickMatchId = null;
  return true;
}

function resetGame() {
  if (isNetworkMode()) {
    if (cancelPendingQuickMatch()) {
      showLobbyScreen();
      render();
      return;
    }
    showToast('Use rematch after the online game finishes.');
    return;
  }
  resetLocalGameState(currentVariant, null);
}

function undoMove() {
  if (isNetworkMode() || thinking || !previousStates.length) return;
  resetPremoves();
  closePromotion();
  cancelEngine();
  restoreSnapshot(previousStates.pop());
  while (mode === 'ai' && game.turn !== humanColor && previousStates.length) restoreSnapshot(previousStates.pop());
  selectedSquare = -1;
  render();
  if (mode === 'ai' && humanColor === BLACK && game.turn === WHITE && currentStatus().phase === 'playing') startEngine();
}

async function submitAuth(event) {
  event.preventDefault();
  if (STATIC_DEMO_MODE) {
    activateStaticDemo();
    return;
  }
  const authMode = authModeSelect?.value === 'login' ? 'login' : 'signup';
  const handle = sanitizeHandle(profileHandleInput?.value);
  const displayName = sanitizeDisplayName(profileNameInput?.value);
  const password = profilePasswordInput?.value || '';
  if (!handle) {
    setAuthStatus('Handle must be 3-24 lowercase letters, numbers, or underscores.');
    return;
  }
  if (password.length < 8 || password.length > 128) {
    setAuthStatus('Password must contain 8-128 characters.');
    return;
  }
  if (authMode === 'signup' && !displayName) {
    setAuthStatus('Display name must contain 1-40 safe characters.');
    return;
  }
  if (authMode === 'signup' && !termsCheckbox?.checked) {
    if (termsScreen) termsScreen.open = true;
    fairPlayAccepted = false;
    setAuthStatus('Accept the fair-play terms before creating an account.');
    return;
  }
  if (authMode === 'signup' && !privacyCheckbox?.checked) {
    setAuthStatus('Read and accept the privacy policy before creating an account.');
    return;
  }
  const body = authMode === 'signup'
    ? {
      handle,
      displayName,
      password,
      acceptedFairPlayTerms: true,
      acceptedPrivacyPolicy: true,
    }
    : { handle, password };
  if (authSubmitButton) authSubmitButton.disabled = true;
  setAuthStatus(authMode === 'signup' ? 'Creating account...' : 'Signing in...');
  try {
    const endpoint = authMode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
    const payload = await requestJson(endpoint, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const nextAccount = normalizeAccount(payload.account || payload.user);
    if (!nextAccount) throw new ApiError('The server returned an invalid account.');
    setAuthenticatedAccount(nextAccount);
    profilePasswordInput.value = '';
    showAuthenticatedLobby();
    connectOnline();
    void loadFriends();
  } catch (error) {
    profilePasswordInput.value = '';
    setAuthStatus(error.message);
  } finally {
    if (authSubmitButton) authSubmitButton.disabled = false;
  }
}

async function loadCurrentAccount() {
  if (STATIC_DEMO_MODE) {
    activateStaticDemo();
    return;
  }
  try {
    const payload = await requestJson('/api/me', { method: 'GET' });
    const nextAccount = normalizeAccount(payload.account || payload.user);
    if (!nextAccount) throw new ApiError('The server returned an invalid session.');
    setAuthenticatedAccount(nextAccount);
    showAuthenticatedLobby();
    connectOnline();
    void loadFriends();
  } catch (error) {
    if (error.status && error.status !== 401) {
      showWelcomeScreen(error.message);
    } else {
      showWelcomeScreen('Sign in or create an account to enter the lobby.');
    }
  }
}

async function signOut() {
  if (STATIC_DEMO_MODE) {
    setStaticDemoNotice();
    return;
  }
  try {
    await requestJson('/api/auth/logout', { method: 'POST', body: '{}' });
  } catch (error) {
    showToast(error.message);
  }
  setAuthenticatedAccount(null);
  disconnectSocket(true);
  showWelcomeScreen('Signed out. Sign in again to continue.');
}

for (const button of welcomeChoiceButtons) {
  button.addEventListener('click', () => selectWelcomeChoice(button.dataset.welcomeChoice));
}
welcomeContinueButton?.addEventListener('click', () => showAuthScreen());
welcomeSignInButton?.addEventListener('click', () => {
  showAuthScreen();
  if (authModeSelect) authModeSelect.value = 'login';
  updateAuthMode();
  profileHandleInput?.focus();
});
authModeSelect?.addEventListener('change', updateAuthMode);
authModeSelect?.addEventListener('input', updateAuthMode);
authForm?.addEventListener('submit', submitAuth);
authForm?.addEventListener('invalid', (event) => {
  if (authModeSelect?.value === 'login') return;
  if (event.target === termsCheckbox) {
    if (termsScreen) termsScreen.open = true;
    setAuthStatus('Accept the fair-play terms before creating an account.');
  } else if (event.target === privacyCheckbox) {
    setAuthStatus('Read and accept the privacy policy before creating an account.');
  }
}, true);
signoutButton?.addEventListener('click', () => { void signOut(); });
soundToggle?.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  saveSoundPreference();
  updateSoundToggle();
  if (soundEnabled) {
    const context = getAudioContext();
    if (context?.state === 'suspended') {
      void context.resume().catch((error) => reportAudioFailure(
        error,
        'Move sounds could not start. Check your browser audio permissions and try again.',
      ));
    }
  }
});
termsCheckbox?.addEventListener('change', () => {
  fairPlayAccepted = termsCheckbox.checked;
});
termsAcknowledgeButton?.addEventListener('click', () => showInfoPage('terms', 'auth'));
termsPageContinueButton?.addEventListener('click', () => {
  returnFromInfoPage();
});
privacySignupLink?.addEventListener('click', (event) => {
  event.preventDefault();
  showInfoPage('privacy', 'auth');
});
privacyPageBackButton?.addEventListener('click', () => {
  returnFromInfoPage();
});

lobbyForm?.addEventListener('submit', startSelectedGame);
gameChoice?.addEventListener('change', () => {
  if (STATIC_DEMO_MODE && NETWORK_MODES.has(gameChoice.value)) {
    gameChoice.value = 'ai';
    updateLobbySummary();
    rejectStaticNetworkMode();
    return;
  }
  if (gameChoice.value !== 'online') selectedFriendHandle = null;
  updateLobbySummary();
});
variantChoice?.addEventListener('change', updateLobbySummary);
lobbyColorChoice?.addEventListener('change', () => {
  selectedColorChoice = normalizeColorChoice(lobbyColorChoice.value);
  updateLobbySummary();
});
lobbyTimeControl?.addEventListener('change', () => {
  selectedTimeControl = Object.hasOwn(TIME_CONTROLS, lobbyTimeControl.value) ? lobbyTimeControl.value : '5+3';
  updateLobbySummary();
});
lobbyDifficultySelect?.addEventListener('change', () => {
  syncDifficultySelectors(lobbyDifficultySelect.value);
  updateLobbySummary();
});
friendRequestForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  void sendFriendRequest();
});

previousMoveButton?.addEventListener('click', () => setMoveViewPly(currentViewPly() - 1));
nextMoveButton?.addEventListener('click', () => setMoveViewPly(currentViewPly() + 1));
livePositionButton?.addEventListener('click', () => setMoveViewPly(null));
analysisPreviousButton?.addEventListener('click', () => setMoveViewPly(analysisViewPly() - 1));
analysisNextButton?.addEventListener('click', () => setMoveViewPly(analysisViewPly() + 1));
analysisLiveButton?.addEventListener('click', () => setMoveViewPly(null));
newGameButton?.addEventListener('click', resetGame);
undoButton?.addEventListener('click', undoMove);
flipButton?.addEventListener('click', () => {
  orientation = orientation === WHITE ? BLACK : WHITE;
  render();
  renderAnalysisBoard();
});
colorSelect?.addEventListener('change', () => {
  selectedColorChoice = normalizeColorChoice(colorSelect.value);
  humanColor = resolveColorChoice(selectedColorChoice);
  orientation = humanColor;
  if (mode === 'ai') resetLocalGameState(currentVariant, currentChess960Seed);
});
difficultySelect?.addEventListener('change', () => {
  syncDifficultySelectors(difficultySelect.value);
  updateAdaptiveLevelDisplay();
  updateLobbySummary();
  if (thinking) {
    cancelEngine();
    render();
    if (game.turn !== humanColor && currentStatus().phase === 'playing') startEngine();
  }
});
modeSelect?.addEventListener('change', () => {
  if (!MODE_VALUES.has(modeSelect.value)) return;
  if (STATIC_DEMO_MODE && NETWORK_MODES.has(modeSelect.value)) {
    rejectStaticNetworkMode();
    modeSelect.value = mode;
    return;
  }
  if (gameChoice) gameChoice.value = modeSelect.value;
  updateLobbySummary();
  if (authenticated) showAuthenticatedLobby();
});
timeControlSelect?.addEventListener('change', () => {
  if (isNetworkMode() && onlineGameId) {
    syncTimeControlSelector(onlineTimeControl);
    setText(onlineRoomStatus, 'Time control is locked after a friend game starts.');
    return;
  }
  if (Object.hasOwn(TIME_CONTROLS, timeControlSelect.value)) {
    selectedTimeControl = timeControlSelect.value;
    if (lobbyTimeControl) lobbyTimeControl.value = selectedTimeControl;
    updateLobbySummary();
    if (!isNetworkMode()) resetLocalGameState(currentVariant, currentChess960Seed);
  } else {
    restorePresetTimeControl();
  }
});
offerDrawButton?.addEventListener('click', () => {
  if (!sendOnlineAction({ type: 'friendDrawOffer' })) showToast('Both friend game seats must be connected before offering a draw.');
});
acceptDrawButton?.addEventListener('click', () => {
  if (!sendOnlineAction({ type: 'friendDrawAccept' })) showToast('The draw offer is no longer available.');
});
resignButton?.addEventListener('click', () => {
  if (!sendOnlineAction({ type: 'friendResign' })) showToast('Both online game seats must be connected before resigning.');
});
resignLocalButton?.addEventListener('click', () => resignLocalGame(game.turn));
resignAiButton?.addEventListener('click', () => resignLocalGame(humanColor));
rematchButton?.addEventListener('click', () => {
  if (!sendOnlineAction({ type: 'friendRematch' })) showToast('Reconnect before requesting a rematch.');
});
promotionModal?.addEventListener('click', (event) => {
  if (event.target === promotionModal) closePromotion();
});
analysisCloseButton?.addEventListener('click', closeAnalysis);
clearPremovesButton?.addEventListener('click', clearPremoves);
window.addEventListener('hashchange', () => {
  const hash = window.location.hash;
  if (hash === '#terms-page') showInfoPage('terms');
  else if (hash === '#privacy-page') showInfoPage('privacy');
  else if (hash === '#welcome-screen' && !authenticated) showWelcomeScreen();
  else if (hash === '#game-screen' && authenticated) showGameScreen();
  else if (authenticated && window.location.hash === '#terms-screen') {
    showAuthenticatedLobby();
    if (termsScreen) termsScreen.open = true;
  } else if (!authenticated && hash === '#terms-screen') {
    showAuthScreen();
    if (termsScreen) termsScreen.open = true;
  } else if (authenticated) showAuthenticatedLobby();
  else showWelcomeScreen();
});
window.addEventListener('resize', updateViewportLayout);
window.visualViewport?.addEventListener('resize', updateViewportLayout);
function isEditableKeyboardTarget(target) {
  const tagName = target?.tagName;
  return Boolean(target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(tagName));
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (pendingPromotion) closePromotion();
    else if (analysisPanel && !analysisPanel.hidden) closeAnalysis();
    else if (selectedSquare >= 0) {
      selectedSquare = -1;
      render();
    }
  }
  if (!isEditableKeyboardTarget(event.target)
    && (analysisPanel?.hidden === false || gameScreen?.hidden === false)
    && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    if (event.key === 'ArrowLeft') setMoveViewPly(currentViewPly() - 1);
    else if (event.key === 'ArrowRight') setMoveViewPly(currentViewPly() + 1);
    else if (event.key === 'Home') setMoveViewPly(0);
    else setMoveViewPly(null);
    return;
  }
  if (!isEditableKeyboardTarget(event.target)
    && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    undoMove();
  }
});

// Keep the existing useful test seam without exposing credentials or session
// capabilities through it.
window.novaChess = {
  getFEN: () => toFEN(game),
  loadFEN: (fen) => {
    cancelEngine();
    resetPremoves();
    game = stateFromFEN(fen);
    currentVariant = 'standard';
    currentChess960Seed = null;
    viewedPly = null;
    lastRenderedHistoryLength = 0;
    previousStates = [];
    selectedSquare = -1;
    localResult = null;
    adaptiveResultRecorded = false;
    clearAnalysis();
    render();
  },
  reset: resetGame,
  getStatus: () => currentStatus(),
  getMode: () => mode,
  startLobbyGame: () => lobbyForm?.requestSubmit(),
  selectFriend: (handle) => selectFriendIfAvailable(handle),
};

updateAuthMode();
adaptiveElo = loadAdaptiveElo();
soundEnabled = loadSoundPreference();
updateSoundToggle();
updateAdaptiveLevelDisplay();
if (gameChoice && !MODE_VALUES.has(gameChoice.value)) gameChoice.value = 'ai';
if (variantChoice && !VARIANT_VALUES.has(variantChoice.value)) variantChoice.value = 'standard';
if (lobbyColorChoice) selectedColorChoice = normalizeColorChoice(lobbyColorChoice.value);
if (lobbyTimeControl && Object.hasOwn(TIME_CONTROLS, lobbyTimeControl.value)) selectedTimeControl = lobbyTimeControl.value;
if (timeControlSelect && Object.hasOwn(TIME_CONTROLS, timeControlSelect.value)) selectedTimeControl = timeControlSelect.value;
syncDifficultySelectors(lobbyDifficultySelect?.value || difficultySelect?.value);
updateLobbySummary();
setAuthModalVisible(false);
if (lobbyScreen) {
  lobbyScreen.hidden = true;
  lobbyScreen.style.display = 'none';
}
if (gameScreen) {
  gameScreen.hidden = true;
  gameScreen.style.display = 'none';
}
if (STATIC_DEMO_MODE) {
  activateStaticDemo();
} else {
  setAccountStatus('RESTORING SESSION…');
  setText(matchClockElement, 'RESTORING SESSION…');
}
updateViewportLayout();
window.setInterval(tickClocks, 100);
if (!STATIC_DEMO_MODE) void loadCurrentAccount();
