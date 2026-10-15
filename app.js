import {
  BLACK,
  BISHOP,
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
  createInitialState,
  fileOf,
  getGameStatus,
  kingSquare,
  moveToUci,
  parseSquare,
  rankOf,
  squareName,
  stateFromFEN,
  toFEN,
  typeOf,
  uciToMove,
} from './chess.js';

const boardElement = document.querySelector('#board');
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
const colorSelect = document.querySelector('#color-select');
const difficultySelect = document.querySelector('#difficulty-select');
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
const onlineNameInput = document.querySelector('#online-name');
const roomCodeInput = document.querySelector('#room-code');
const createRoomButton = document.querySelector('#create-room');
const joinRoomButton = document.querySelector('#join-room');
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

const DIFFICULTIES = {
  pulse: { timeMs: 700, maxDepth: 12 },
  forge: { timeMs: 1800, maxDepth: 18 },
  overdrive: { timeMs: 3500, maxDepth: 24 },
  apex: { timeMs: 8000, maxDepth: 32 },
};
const TIME_CONTROLS = {
  '1+0': { initialMs: 60_000, incrementMs: 0 },
  '2+1': { initialMs: 120_000, incrementMs: 1_000 },
  '3+2': { initialMs: 180_000, incrementMs: 2_000 },
  '5+3': { initialMs: 300_000, incrementMs: 3_000 },
  '10+0': { initialMs: 600_000, incrementMs: 0 },
  '15+10': { initialMs: 900_000, incrementMs: 10_000 },
};

let game = createInitialState();
let humanColor = WHITE;
let orientation = WHITE;
let selectedSquare = -1;
let pendingPromotion = null;
let previousStates = [];
let thinking = false;
let worker = null;
let requestCounter = 0;
let toastTimer = null;
let mode = 'ai';
let clocks = { white: 300_000, black: 300_000 };
let clockStamp = performance.now();
let localResult = null;
let socket = null;
let onlineRoom = null;
let onlineColor = null;
let onlineToken = null;
let onlineReady = false;
let onlineStatus = null;
let onlinePlayers = [];
let onlineTimeControl = null;
let onlineConnectionGeneration = 0;
let onlineRevision = -1;
let engineData = {
  score: { cp: 20 },
  depth: 0,
  nodes: 0,
  elapsedMs: 0,
  pv: [],
};

const promotionOrder = [QUEEN, ROOK, BISHOP, KNIGHT];

const AUTHORITATIVE_TIME_CONTROL_VALUE = '__authoritative_time_control__';

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

function timeControlDetails(value) {
  if (typeof value === 'string') return TIME_CONTROLS[value] || null;
  if (!value || typeof value !== 'object') return null;
  const initialMs = Number(value.initialMs);
  const incrementMs = Number(value.incrementMs);
  if (!Number.isFinite(initialMs) || !Number.isFinite(incrementMs)) return null;
  return { initialMs, incrementMs };
}

function timeControlLabel(value) {
  const control = timeControlDetails(value);
  if (!control) return String(value || 'Unknown');
  const totalSeconds = Math.max(0, Math.round(control.initialMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const base = seconds ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${minutes}:00`;
  return `${base} + ${Math.round(control.incrementMs / 1000)}s`;
}

function removeAuthoritativeTimeControlOption() {
  timeControlSelect.querySelector(`option[value="${AUTHORITATIVE_TIME_CONTROL_VALUE}"]`)?.remove();
}

function syncTimeControlSelector(value) {
  if (value === undefined || value === null) return;
  onlineTimeControl = value;
  if (typeof value === 'string' && Object.hasOwn(TIME_CONTROLS, value)) {
    removeAuthoritativeTimeControlOption();
    timeControlSelect.value = value;
    return;
  }

  let option = timeControlSelect.querySelector(`option[value="${AUTHORITATIVE_TIME_CONTROL_VALUE}"]`);
  if (!option) {
    option = document.createElement('option');
    option.value = AUTHORITATIVE_TIME_CONTROL_VALUE;
    option.dataset.authoritative = 'true';
    timeControlSelect.append(option);
  }
  option.textContent = `Server · ${timeControlLabel(value)}`;
  timeControlSelect.value = AUTHORITATIVE_TIME_CONTROL_VALUE;
}

function restorePresetTimeControl() {
  if (timeControlSelect.value !== AUTHORITATIVE_TIME_CONTROL_VALUE) return;
  removeAuthoritativeTimeControlOption();
  timeControlSelect.value = '5+3';
}

function onlineRoomLabel() {
  if (!onlineRoom) return 'Start a room or enter an invite code.';
  const seat = onlineColor ? ` · ${colorText(onlineColor)}` : '';
  if (onlineReady) return `ROOM ${onlineRoom}${seat} · ${onlineStatus?.phase === 'playing' ? 'LIVE' : 'FINISHED'}`;
  if (socket?.readyState === WebSocket.CONNECTING) return `ROOM ${onlineRoom}${seat} · connecting…`;
  if (socket?.readyState === WebSocket.OPEN) return `ROOM ${onlineRoom}${seat} · waiting for opponent`;
  return `ROOM ${onlineRoom}${seat} · reconnect with JOIN ROOM`;
}

function pieceLabel(piece) {
  if (!piece) return 'empty';
  return `${piece > 0 ? 'white' : 'black'} ${PIECE_NAMES[typeOf(piece)]}`;
}

function currentStatus() {
  const rules = getGameStatus(game);
  if (mode === 'online' && onlineStatus) {
    return {
      ...rules,
      ...onlineStatus,
      legalMoves: onlineStatus.phase === 'playing' ? rules.legalMoves : [],
    };
  }
  if (localResult) return { ...rules, ...localResult, legalMoves: [] };
  return rules;
}

function isHumanPiece(square) {
  const inputColor = mode === 'local' ? game.turn : mode === 'online' ? chessColor(onlineColor) : humanColor;
  return game.board[square] && (game.board[square] > 0 ? WHITE : BLACK) === inputColor;
}

function turnColor() {
  return normalizeColorName(game.turn);
}

function inputEnabled() {
  if (thinking || currentStatus().phase !== 'playing') return false;
  if (mode === 'local') return true;
  if (mode === 'online') return onlineReady && socket?.readyState === WebSocket.OPEN && game.turn === chessColor(onlineColor);
  return game.turn === humanColor;
}

function controlForTime(value = timeControlSelect.value) {
  return TIME_CONTROLS[value] || (mode === 'online' ? timeControlDetails(onlineTimeControl) : null) || TIME_CONTROLS['5+3'];
}

function colorText(color) {
  const normalized = normalizeColorName(color);
  if (normalized) return normalized.toUpperCase();
  return 'PLAYER';
}

function winnerText(status) {
  return colorText(status?.winner) === 'PLAYER' ? '' : colorText(status?.winner);
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
  aiSettings.hidden = mode !== 'ai';
  onlineSettings.hidden = mode !== 'online';
  colorSelect.disabled = mode !== 'ai';
  difficultySelect.disabled = mode !== 'ai';
  timeControlSelect.disabled = mode === 'online' && Boolean(onlineRoom);
  createRoomButton.disabled = mode !== 'online';
  joinRoomButton.disabled = mode !== 'online';
  opponentHeadingElement.textContent = mode === 'ai' ? 'NovaForge' : mode === 'local' ? 'Local opponent' : 'Online opponent';
  if (mode !== 'online') {
    onlineRoomStatus.textContent = 'Start an online mode to create or join a room.';
  } else {
    onlineRoomStatus.textContent = onlineRoomLabel();
  }
}

function formatClock(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function renderClocks() {
  const firstColor = mode === 'local' ? WHITE : mode === 'online' ? onlineColor ?? WHITE : humanColor;
  const firstKey = chessColor(firstColor) === WHITE ? 'white' : 'black';
  const secondKey = firstKey === 'white' ? 'black' : 'white';
  humanClockElement.textContent = formatClock(clocks[firstKey]);
  opponentClockElement.textContent = formatClock(clocks[secondKey]);
  humanClockElement.classList.toggle('low-time', clocks[firstKey] < 20_000);
  opponentClockElement.classList.toggle('low-time', clocks[secondKey] < 20_000);
}

function tickClocks() {
  const elapsed = Math.max(0, performance.now() - clockStamp);
  clockStamp = performance.now();
  const active = mode === 'online' ? onlineReady && onlineStatus?.phase === 'playing' : !localResult && getGameStatus(game).phase === 'playing';
  if (!active) return renderClocks();
  const color = turnColor();
  clocks[color] = Math.max(0, clocks[color] - elapsed);
  if (clocks[color] === 0 && mode !== 'online') {
    localResult = { phase: 'timeout', winner: game.turn === WHITE ? BLACK : WHITE, drawReason: `${color} ran out of time` };
    cancelEngine();
    closePromotion();
    render();
  }
  renderClocks();
}

function visibleFiles() {
  return orientation === WHITE ? [...Array(8).keys()] : [...Array(8).keys()].reverse();
}

function visibleRanks() {
  return orientation === WHITE ? [...Array(8).keys()].reverse() : [...Array(8).keys()];
}

function renderBoard(status) {
  boardElement.replaceChildren();
  const legalTargets = new Set(status.legalMoves.filter((move) => move.from === selectedSquare).map((move) => move.to));
  const checkedKing = status.inCheck ? kingSquare(game, game.turn) : -1;
  const lastMove = game.lastMove;
  const files = visibleFiles();
  const ranks = visibleRanks();

  for (const rank of ranks) {
    for (const file of files) {
      const square = rank * 8 + file;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `square ${(file + rank) % 2 ? 'light' : 'dark'}`;
      button.dataset.square = square;
      button.setAttribute('role', 'gridcell');
      button.setAttribute('aria-label', `${squareName(square)}: ${pieceLabel(game.board[square])}`);
      if (lastMove && (lastMove.from === square || lastMove.to === square)) button.classList.add('last-move');
      if (selectedSquare === square) button.classList.add('selected');
      if (legalTargets.has(square)) {
        button.classList.add('legal-target');
        if (game.board[square]) button.classList.add('capture-target');
      }
      if (checkedKing === square) button.classList.add('in-check');
      if (game.board[square]) {
        const piece = document.createElement('span');
        piece.className = `piece ${game.board[square] > 0 ? 'white' : 'black'}`;
        piece.textContent = PIECE_GLYPHS[typeOf(game.board[square])];
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
  moveCountElement.textContent = `${game.history.length} ${game.history.length === 1 ? 'PLY' : 'PLIES'}`;
  if (!game.history.length) {
    moveHistoryElement.innerHTML = '<div class="history-empty">Your first move will live here.</div>';
    return;
  }
  moveHistoryElement.replaceChildren();
  for (let index = 0; index < game.history.length; index += 2) {
    const row = document.createElement('div');
    row.className = 'history-row';
    const number = document.createElement('span');
    number.className = 'move-number';
    number.textContent = `${Math.floor(index / 2) + 1}.`;
    row.append(number);
    for (let offset = 0; offset < 2; offset += 1) {
      const move = game.history[index + offset];
      const moveElement = document.createElement('span');
      moveElement.className = `history-move ${move && index + offset === game.history.length - 1 ? 'last' : ''}`;
      moveElement.textContent = move?.notation || '·';
      row.append(moveElement);
    }
    moveHistoryElement.append(row);
  }
  moveHistoryElement.scrollTop = moveHistoryElement.scrollHeight;
}

function formatEngineScore(score) {
  if (!score) return '+0.00';
  if (typeof score.mate === 'number') return `${score.mate > 0 ? '+' : '−'}M${Math.abs(score.mate)}`;
  const pawns = (score.cp || 0) / 100;
  if (Math.abs(pawns) < 0.005) return '0.00';
  return `${pawns > 0 ? '+' : '−'}${Math.abs(pawns).toFixed(2)}`;
}

function formatPV(pv) {
  if (!pv?.length) return 'Awaiting your first move';
  return pv.map((uci) => `${uci.slice(0, 2)}-${uci.slice(2, 4)}${uci[4] ? `=${uci[4].toUpperCase()}` : ''}`).join('  ');
}

function renderEnginePanel() {
  const score = engineData.score || { cp: 0 };
  engineEvalElement.textContent = formatEngineScore(score);
  engineDepthElement.textContent = `DEPTH ${engineData.depth || 0}`;
  engineNodesElement.textContent = `${(engineData.nodes || 0).toLocaleString()} NODES`;
  engineTimeElement.textContent = `${((engineData.elapsedMs || 0) / 1000).toFixed(1)}S`;
  engineLineElement.textContent = formatPV(engineData.pv);
  const numericScore = typeof score.cp === 'number' ? score.cp : (score.mate > 0 ? 1600 : -1600);
  const width = Math.max(5, Math.min(95, 50 + numericScore / 32));
  evalFillElement.style.width = `${width}%`;
  thinkingCopyElement.textContent = thinking ? 'NovaForge is calculating…' : mode === 'ai' ? 'Waiting for your next idea' : mode === 'local' ? 'Local board · both sides enabled' : onlineReady ? 'Live room · server authoritative' : 'Connect to a room to play';
}

function renderStatus(status) {
  const displayHumanColor = mode === 'local' ? WHITE : mode === 'online' ? onlineColor : humanColor;
  const humanPlayer = onlinePlayers.find((player) => colorsMatch(player.color, onlineColor));
  const opponentPlayer = onlinePlayers.find((player) => player.color && !colorsMatch(player.color, onlineColor));
  humanNameElement.textContent = mode === 'online'
    ? humanPlayer?.name?.toUpperCase() || (onlineColor ? colorText(onlineColor) : 'YOU')
    : mode === 'local' ? 'WHITE' : colorText(displayHumanColor);
  opponentNameElement.textContent = mode === 'online'
    ? opponentPlayer?.name?.toUpperCase() || 'WAITING'
    : mode === 'local' ? 'BLACK' : 'NOVAFORGE';
  opponentHeadingElement.textContent = mode === 'ai' ? 'NovaForge' : mode === 'local' ? 'Local opponent' : opponentPlayer?.name || 'Online opponent';
  matchClockElement.textContent = `MOVE ${String(Math.floor(game.history.length / 2) + 1).padStart(2, '0')}`;
  positionElement.textContent = game.history.length ? `MOVE ${game.history.length}` : 'STARTING';

  if (mode === 'online' && !onlineReady && status.phase === 'playing') {
    statusElement.textContent = onlineRoom ? 'Waiting for opponent' : 'Create or join a room';
    statusElement.style.color = 'var(--gold)';
    humanStateElement.textContent = onlineColor ? `${colorText(onlineColor)} SEAT` : 'NOT CONNECTED';
    engineStateElement.textContent = onlineRoom ? 'ROOM OPEN' : 'ONLINE MODE';
  } else if (status.phase === 'checkmate') {
    const humanWon = mode === 'local' ? false : colorsMatch(status.winner, displayHumanColor);
    statusElement.textContent = mode === 'local' ? `${winnerText(status)} wins by checkmate` : humanWon ? 'You found mate' : mode === 'online' ? `${winnerText(status)} wins by checkmate` : 'NovaForge found mate';
    statusElement.style.color = humanWon ? 'var(--gold)' : 'var(--coral)';
    humanStateElement.textContent = humanWon ? 'VICTORY' : 'CHECKMATED';
    engineStateElement.textContent = humanWon ? 'OUT OF MOVES' : 'VICTORY';
  } else if (status.phase === 'draw') {
    statusElement.textContent = `Draw · ${status.drawReason || status.reason || 'agreement'}`;
    statusElement.style.color = 'var(--gold)';
    humanStateElement.textContent = 'DRAWN GAME';
    engineStateElement.textContent = 'DRAWN GAME';
  } else if (status.phase === 'timeout' || status.phase === 'resigned') {
    const winner = winnerText(status);
    statusElement.textContent = status.phase === 'timeout' ? `${winner} wins on time` : `${winner} wins · resignation`;
    const humanWon = colorsMatch(status.winner, displayHumanColor);
    statusElement.style.color = humanWon ? 'var(--gold)' : 'var(--coral)';
    humanStateElement.textContent = humanWon ? 'VICTORY' : 'DEFEATED';
    engineStateElement.textContent = humanWon ? 'GAME OVER' : 'VICTORY';
  } else if (thinking) {
    statusElement.textContent = 'NovaForge is thinking';
    statusElement.style.color = 'var(--mint)';
    humanStateElement.textContent = 'HOLD YOUR LINE';
    engineStateElement.textContent = 'CALCULATING';
  } else if (mode === 'local') {
    statusElement.textContent = status.inCheck ? `Check · ${colorText(game.turn)} to respond` : `${colorText(game.turn)} to move`;
    statusElement.style.color = status.inCheck ? 'var(--coral)' : 'var(--mint)';
    humanStateElement.textContent = game.turn === WHITE ? 'WHITE TO MOVE' : 'BLACK TO MOVE';
    engineStateElement.textContent = 'LOCAL MATCH';
  } else if (mode === 'online' && game.turn === chessColor(onlineColor)) {
    statusElement.textContent = status.inCheck ? 'Check · your response' : 'Your move';
    statusElement.style.color = status.inCheck ? 'var(--coral)' : 'var(--mint)';
    humanStateElement.textContent = status.inCheck ? 'IN CHECK' : 'YOUR MOVE';
    engineStateElement.textContent = 'OPPONENT WAITING';
  } else if (mode === 'online') {
    statusElement.textContent = 'Opponent to move';
    statusElement.style.color = 'var(--mint)';
    humanStateElement.textContent = 'STAY READY';
    engineStateElement.textContent = 'YOUR TURN NEXT';
  } else if (game.turn === humanColor) {
    statusElement.textContent = status.inCheck ? 'Check · your response' : 'Your move';
    statusElement.style.color = status.inCheck ? 'var(--coral)' : 'var(--mint)';
    humanStateElement.textContent = status.inCheck ? 'IN CHECK' : 'YOUR MOVE';
    engineStateElement.textContent = 'WATCHING CLOSELY';
  } else {
    statusElement.textContent = 'NovaForge to move';
    statusElement.style.color = 'var(--mint)';
    humanStateElement.textContent = 'STAY READY';
    engineStateElement.textContent = 'YOUR TURN NEXT';
  }
  undoButton.disabled = mode === 'online' || previousStates.length === 0 || thinking;
  renderClocks();
}

function renderOnlineControls(status) {
  if (!onlineActions) return;
  const roomActive = mode === 'online' && Boolean(onlineRoom);
  onlineActions.hidden = !roomActive;
  if (!roomActive) return;

  const phase = status?.phase || 'playing';
  const drawOffer = normalizeColorName(status?.drawOffer);
  const opponentOfferedDraw = Boolean(drawOffer && !colorsMatch(drawOffer, onlineColor));
  const claimableDraws = Array.isArray(status?.claimableDraws)
    ? status.claimableDraws.filter((reason) => typeof reason === 'string' && reason.length)
    : [];
  const canAct = onlineReady && socket?.readyState === WebSocket.OPEN && phase === 'playing';
  const ownTurn = game.turn === chessColor(onlineColor);
  const rematchVotes = normalizeColorList(status?.rematchVotes);

  if (!onlineReady) {
    onlineActionStatus.textContent = 'WAITING FOR BOTH PLAYERS TO CONNECT';
  } else if (phase !== 'playing') {
    onlineActionStatus.textContent = `GAME FINISHED · ${rematchVotes.length}/2 REMATCH VOTES`;
  } else if (opponentOfferedDraw) {
    onlineActionStatus.textContent = `${colorText(drawOffer)} OFFERED A DRAW`;
  } else if (drawOffer && colorsMatch(drawOffer, onlineColor)) {
    onlineActionStatus.textContent = 'DRAW OFFER SENT · WAITING FOR RESPONSE';
  } else {
    onlineActionStatus.textContent = 'ROOM ACTIONS · SERVER AUTHORITATIVE';
  }

  offerDrawButton.hidden = opponentOfferedDraw;
  offerDrawButton.disabled = !canAct || Boolean(drawOffer);
  acceptDrawButton.hidden = !opponentOfferedDraw;
  acceptDrawButton.disabled = !canAct;
  resignButton.disabled = !canAct;

  claimableDrawsElement.replaceChildren();
  claimableDrawsElement.hidden = !claimableDraws.length || phase !== 'playing';
  if (claimableDraws.length && phase === 'playing') {
    const heading = document.createElement('div');
    heading.className = 'claimable-draw-heading';
    heading.textContent = ownTurn ? 'CLAIMABLE DRAWS' : 'CLAIMABLE DRAWS · YOUR TURN NEXT';
    claimableDrawsElement.append(heading);
    const buttons = document.createElement('div');
    buttons.className = 'claimable-draw-buttons';
    for (const reason of claimableDraws) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button button-secondary';
      button.textContent = `CLAIM ${reason.toUpperCase()}`;
      button.disabled = !canAct || !ownTurn;
      button.addEventListener('click', () => sendOnlineAction({ type: 'claimDraw', reason }));
      buttons.append(button);
    }
    claimableDrawsElement.append(buttons);
  }

  const finished = phase !== 'playing';
  rematchPanel.hidden = !finished;
  if (finished) {
    const voteLabel = rematchVotes.length
      ? rematchVotes.map(colorText).join(' + ')
      : 'NONE';
    rematchVotesElement.textContent = `${rematchVotes.length}/2 · ${voteLabel}`;
    const voted = rematchVotes.some((color) => colorsMatch(color, onlineColor));
    rematchButton.disabled = !onlineReady || socket?.readyState !== WebSocket.OPEN || voted;
    rematchButton.querySelector('span').textContent = voted ? 'REMATCH VOTE SENT' : 'REQUEST REMATCH';
  }
}

function render() {
  const status = currentStatus();
  setModeControls();
  renderBoard(status);
  renderHistory();
  renderEnginePanel();
  renderStatus(status);
  renderOnlineControls(status);
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  toastElement.textContent = message;
  toastElement.classList.add('show');
  toastTimer = window.setTimeout(() => toastElement.classList.remove('show'), 2800);
}

function closePromotion() {
  pendingPromotion = null;
  promotionModal.hidden = true;
  promotionOptions.replaceChildren();
}

function openPromotion(moves) {
  pendingPromotion = moves;
  promotionOptions.replaceChildren();
  const colorClass = game.turn === WHITE ? 'white' : 'black';
  for (const promotion of promotionOrder) {
    const selected = moves.find((move) => move.promotion === promotion);
    if (!selected) continue;
    const choice = document.createElement('button');
    choice.type = 'button';
    choice.className = 'promotion-choice';
    choice.innerHTML = `<span class="piece ${colorClass}">${PIECE_GLYPHS[promotion]}</span><span>${PIECE_NAMES[promotion].toUpperCase()}</span>`;
    choice.addEventListener('click', () => {
      closePromotion();
      commitMove(selected);
    });
    promotionOptions.append(choice);
  }
  promotionModal.hidden = false;
}

function commitMove(moveToCommit) {
  if (mode === 'online') {
    if (!inputEnabled() || !sendOnlineAction({ type: 'move', uci: moveToUci(moveToCommit) })) return;
    selectedSquare = -1;
    onlineRoomStatus.textContent = `ROOM ${onlineRoom || ''} · move sent…`;
    render();
    return;
  }
  const legal = currentStatus().legalMoves.find((candidate) => moveToUci(candidate) === moveToUci(moveToCommit));
  if (!legal) return;
  previousStates.push(saveSnapshot());
  const movingColor = game.turn;
  game = applyMove(game, legal, { record: true });
  const movingKey = movingColor === WHITE ? 'white' : 'black';
  clocks[movingKey] += controlForTime().incrementMs;
  clockStamp = performance.now();
  selectedSquare = -1;
  const rules = getGameStatus(game);
  localResult = rules.phase === 'playing' ? null : {
    phase: rules.phase,
    winner: rules.winner,
    drawReason: rules.drawReason,
  };
  render();
  const status = currentStatus();
  if (mode === 'ai' && status.phase === 'playing' && game.turn !== humanColor) startEngine();
}

function onSquareClick(square) {
  if (!inputEnabled()) return;
  if (pendingPromotion) return;
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

function cancelEngine() {
  requestCounter += 1;
  if (worker) worker.terminate();
  worker = null;
  thinking = false;
}

function startEngine() {
  const status = currentStatus();
  if (mode !== 'ai' || status.phase !== 'playing' || game.turn === humanColor) return;
  cancelEngine();
  thinking = true;
  engineData = { score: { cp: 0 }, depth: 0, nodes: 0, elapsedMs: 0, pv: [] };
  render();
  const requestId = requestCounter;
  const difficulty = DIFFICULTIES[difficultySelect.value] || DIFFICULTIES.forge;
  worker = new Worker(new URL('./engine-worker.js', import.meta.url), { type: 'module' });
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
      showToast(`Engine error: ${message.message}`);
      return;
    }
    if (message.type === 'bestmove') {
      thinking = false;
      worker.terminate();
      worker = null;
      engineData = {
        score: message.score,
        depth: message.depth,
        nodes: message.nodes,
        elapsedMs: message.elapsedMs,
        pv: message.pv,
      };
      const engineMove = message.move ? uciToMove(game, message.move) : null;
      if (engineMove) {
        commitMove(engineMove);
      } else {
        render();
      }
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
    fen: toFEN(game),
    repetitionCounts: [...game.positionCounts.entries()],
    limits: difficulty,
  });
}

function resetLocalGameState() {
  cancelEngine();
  closePromotion();
  game = createInitialState();
  selectedSquare = -1;
  previousStates = [];
  localResult = null;
  const control = controlForTime();
  clocks = { white: control.initialMs, black: control.initialMs };
  clockStamp = performance.now();
  engineData = { score: { cp: 20 }, depth: 0, nodes: 0, elapsedMs: 0, pv: [] };
  render();
  if (mode === 'ai' && humanColor === BLACK) window.setTimeout(startEngine, 120);
}

function isCurrentConnection(connection, generation) {
  return socket === connection && onlineConnectionGeneration === generation;
}

function disconnectOnline(preserveRoom = true) {
  onlineConnectionGeneration += 1;
  const previousSocket = socket;
  socket = null;
  onlinePendingAction = null;
  if (previousSocket) {
    try {
      previousSocket.close();
    } catch {
      previousSocket.terminate?.();
    }
  }
  onlineReady = false;
  onlineStatus = null;
  onlinePlayers = [];
  onlineRevision = -1;
  if (!preserveRoom) {
    onlineRoom = null;
    onlineColor = null;
    onlineToken = null;
    onlineTimeControl = null;
    restorePresetTimeControl();
  }
}

function onlineUrl() {
  if (!window.location.host) return null;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}`;
}

let onlinePendingAction = null;

function sendOnlineAction(action, connection = socket, generation = onlineConnectionGeneration) {
  if (!action || !isCurrentConnection(connection, generation) || connection.readyState !== WebSocket.OPEN) return false;
  try {
    connection.send(JSON.stringify(action));
    return true;
  } catch {
    return false;
  }
}

function connectOnline(action = null) {
  const url = onlineUrl();
  if (!url) {
    showToast('Online play needs the Nova Chess server. Run npm run start.');
    return;
  }
  if (action) onlinePendingAction = action;
  if (socket?.readyState === WebSocket.OPEN) {
    if (onlinePendingAction) {
      if (sendOnlineAction(onlinePendingAction)) onlinePendingAction = null;
    }
    return;
  }
  if (socket?.readyState === WebSocket.CONNECTING) return;
  const generation = onlineConnectionGeneration + 1;
  onlineConnectionGeneration = generation;
  const connection = new WebSocket(url);
  socket = connection;
  onlineRoomStatus.textContent = 'CONNECTING TO NOVA ROOMS…';
  connection.addEventListener('open', () => {
    if (!isCurrentConnection(connection, generation)) return;
    if (onlinePendingAction) {
      if (sendOnlineAction(onlinePendingAction, connection, generation)) onlinePendingAction = null;
    }
    onlineRoomStatus.textContent = 'CONNECTED · waiting for room response…';
    render();
  });
  connection.addEventListener('message', (event) => {
    if (!isCurrentConnection(connection, generation)) return;
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      showToast('The room server sent an invalid message.');
      return;
    }
    handleOnlineMessage(message, connection, generation);
  });
  connection.addEventListener('error', () => {
    if (!isCurrentConnection(connection, generation)) return;
    onlineRoomStatus.textContent = 'CONNECTION ERROR · start the Nova Chess server first.';
    showToast('Could not connect to the online room server.');
  });
  connection.addEventListener('close', () => {
    if (!isCurrentConnection(connection, generation)) return;
    socket = null;
    onlineReady = false;
    if (mode === 'online') {
      onlineRoomStatus.textContent = onlineRoom
        ? `ROOM ${onlineRoom} · disconnected · use JOIN ROOM to reconnect`
        : 'DISCONNECTED · create or join a room.';
      render();
    }
  });
}

function handleOnlineMessage(message, connection = socket, generation = onlineConnectionGeneration) {
  if (!isCurrentConnection(connection, generation)) return;
  if (message.type === 'created' || message.type === 'joined') {
    onlineRoom = message.room;
    onlineColor = normalizeColorName(message.color);
    onlineToken = message.token || onlineToken;
    roomCodeInput.value = onlineRoom;
    onlineReady = false;
    onlineRevision = Number.isSafeInteger(message.revision) ? message.revision : -1;
    syncTimeControlSelector(message.timeControl);
    onlineRoomStatus.textContent = `ROOM ${onlineRoom} · ${colorText(onlineColor)} · waiting for opponent`;
    resetLocalGameState();
    return;
  }
  if (message.type === 'state') {
    const messageRevision = Number.isSafeInteger(message.revision) ? message.revision : null;
    if (messageRevision !== null && onlineRevision >= 0 && messageRevision < onlineRevision) return;
    try {
      const next = stateFromFEN(message.fen);
      next.history = Array.isArray(message.history) ? message.history : [];
      next.lastMove = message.lastMove || null;
      game = next;
    } catch (error) {
      showToast(`Online position rejected: ${error.message}`);
      return;
    }
    const messageColor = normalizeColorName(message.you);
    if (messageColor) onlineColor = messageColor;
    if (message.token) onlineToken = message.token;
    onlineRoom = message.room || onlineRoom;
    onlineStatus = {
      phase: message.phase || 'playing',
      winner: normalizeColorName(message.winner),
      drawReason: message.drawReason || null,
      reason: message.reason || null,
      inCheck: Boolean(message.inCheck),
      claimableDraws: Array.isArray(message.claimableDraws)
        ? message.claimableDraws.filter((reason) => typeof reason === 'string')
        : [],
      drawOffer: normalizeColorName(message.drawOffer),
      rematchVotes: normalizeColorList(message.rematchVotes),
      roomState: message.roomState || null,
      turn: normalizeColorName(message.turn),
      revision: messageRevision,
    };
    onlinePlayers = Array.isArray(message.players)
      ? message.players
        .map((player) => ({ ...player, color: normalizeColorName(player?.color) }))
        .filter((player) => player.color)
      : [];
    onlineReady = Boolean(message.ready && onlineColor !== null && isCurrentConnection(connection, generation) && connection.readyState === WebSocket.OPEN);
    if (message.clocks) clocks = normalizeClocks(message.clocks);
    clockStamp = performance.now();
    if (messageRevision !== null) onlineRevision = messageRevision;
    syncTimeControlSelector(message.timeControl);
    selectedSquare = -1;
    closePromotion();
    onlineRoomStatus.textContent = onlineReady
      ? `ROOM ${onlineRoom} · ${colorText(onlineColor)} · ${onlineStatus.phase === 'playing' ? 'LIVE' : 'FINISHED'}`
      : `ROOM ${onlineRoom} · waiting for opponent`;
    render();
    return;
  }
  if (message.type === 'clock') {
    const messageRevision = Number.isSafeInteger(message.revision) ? message.revision : null;
    if (messageRevision !== null && onlineRevision >= 0 && messageRevision < onlineRevision) return;
    if (message.clocks) clocks = normalizeClocks(message.clocks);
    clockStamp = performance.now();
    renderClocks();
    return;
  }
  if (message.type === 'error') {
    setModeControls();
    onlineRoomStatus.textContent = `ERROR · ${message.message}`;
    showToast(message.message);
    renderOnlineControls(currentStatus());
    return;
  }
  if (message.type === 'pong') return;
}

function resetGame() {
  if (mode === 'online') {
    disconnectOnline(false);
    resetLocalGameState();
    return;
  }
  resetLocalGameState();
}

function undoMove() {
  if (mode === 'online' || thinking || !previousStates.length) return;
  closePromotion();
  cancelEngine();
  restoreSnapshot(previousStates.pop());
  // Against the engine, rewind the complete human/engine turn. Local mode uses
  // the natural one-ply undo so both people can correct the latest move.
  while (mode === 'ai' && game.turn !== humanColor && previousStates.length) restoreSnapshot(previousStates.pop());
  selectedSquare = -1;
  render();
  if (mode === 'ai' && humanColor === BLACK && game.turn === WHITE && currentStatus().phase === 'playing') startEngine();
}

newGameButton.addEventListener('click', resetGame);
undoButton.addEventListener('click', undoMove);
flipButton.addEventListener('click', () => {
  orientation = orientation === WHITE ? BLACK : WHITE;
  render();
});
colorSelect.addEventListener('change', () => {
  humanColor = colorSelect.value === 'black' ? BLACK : WHITE;
  if (mode === 'ai') resetLocalGameState();
});
difficultySelect.addEventListener('change', () => {
  if (thinking) {
    cancelEngine();
    render();
    if (game.turn !== humanColor && currentStatus().phase === 'playing') startEngine();
  }
});
modeSelect.addEventListener('change', () => {
  cancelEngine();
  if (mode === 'online' && modeSelect.value !== 'online') disconnectOnline(true);
  mode = modeSelect.value;
  onlineStatus = mode === 'online' ? onlineStatus : null;
  onlineReady = mode === 'online' ? onlineReady : false;
  if (mode !== 'online') {
    onlineColor = null;
    onlinePlayers = [];
    restorePresetTimeControl();
  }
  resetLocalGameState();
  if (mode === 'online') {
    onlineRoomStatus.textContent = onlineRoom ? `ROOM ${onlineRoom} · reconnect or create a room` : 'Start a room or enter an invite code.';
    render();
  }
});
timeControlSelect.addEventListener('change', () => {
  if (mode === 'online' && onlineRoom) {
    syncTimeControlSelector(onlineTimeControl);
    onlineRoomStatus.textContent = 'Time controls are locked after a room starts. Create a new room to change it.';
    return;
  }
  resetLocalGameState();
});
createRoomButton.addEventListener('click', () => {
  const name = onlineNameInput.value.trim() || 'Player';
  const timeControl = Object.hasOwn(TIME_CONTROLS, timeControlSelect.value) ? timeControlSelect.value : '5+3';
  disconnectOnline(false);
  setModeControls();
  connectOnline({ type: 'create', timeControl, name });
});
joinRoomButton.addEventListener('click', () => {
  const room = roomCodeInput.value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,8}$/.test(room)) {
    showToast('Enter a valid 4–8 character room code.');
    return;
  }
  const name = onlineNameInput.value.trim() || 'Player';
  const token = onlineRoom === room ? onlineToken : null;
  disconnectOnline(Boolean(token));
  setModeControls();
  connectOnline({ type: 'join', room, name, ...(token ? { token } : {}) });
});
offerDrawButton.addEventListener('click', () => {
  if (!sendOnlineAction({ type: 'drawOffer' })) showToast('Join both seats before offering a draw.');
});
acceptDrawButton.addEventListener('click', () => {
  if (!sendOnlineAction({ type: 'drawAccept' })) showToast('The draw offer is no longer available.');
});
resignButton.addEventListener('click', () => {
  if (!sendOnlineAction({ type: 'resign' })) showToast('Join both seats before resigning.');
});
rematchButton.addEventListener('click', () => {
  if (!sendOnlineAction({ type: 'rematch' })) showToast('Reconnect to request a rematch.');
});
promotionModal.addEventListener('click', (event) => {
  if (event.target === promotionModal) closePromotion();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (pendingPromotion) closePromotion();
    else if (selectedSquare >= 0) {
      selectedSquare = -1;
      render();
    }
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    undoMove();
  }
});

// Keep a small test seam in development without exposing internal state in the UI.
window.novaChess = {
  getFEN: () => toFEN(game),
  loadFEN: (fen) => {
    cancelEngine();
    game = stateFromFEN(fen);
    previousStates = [];
    selectedSquare = -1;
    render();
  },
  reset: resetGame,
  getStatus: () => currentStatus(),
  getMode: () => mode,
  createOnlineRoom: () => createRoomButton.click(),
  joinOnlineRoom: (room) => {
    roomCodeInput.value = room;
    joinRoomButton.click();
  },
};

setModeControls();
window.setInterval(tickClocks, 100);
render();
