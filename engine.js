import {
  BISHOP,
  BLACK,
  KING,
  KNIGHT,
  MOVE_CAPTURE,
  MOVE_EN_PASSANT,
  MOVE_PROMOTION,
  PAWN,
  QUEEN,
  ROOK,
  WHITE,
  applyMove,
  colorOf,
  fileOf,
  getLegalMoves,
  isInCheck,
  moveToUci,
  positionKey,
  rankOf,
  typeOf,
} from './chess.js';

const MATE_SCORE = 32000;
const MAX_PLY = 256;
const INFINITY = 40000;
const MAX_TABLE_SIZE = 240000;
const MAX_PV_LENGTH = 64;
const MAX_QUIET_DEPTH = 12;
const TIME_CHECK_MASK = 31;

const MATERIAL = {
  [PAWN]: { mg: 82, eg: 110, phase: 0 },
  [KNIGHT]: { mg: 337, eg: 281, phase: 1 },
  [BISHOP]: { mg: 365, eg: 297, phase: 1 },
  [ROOK]: { mg: 477, eg: 512, phase: 2 },
  [QUEEN]: { mg: 1025, eg: 936, phase: 4 },
  [KING]: { mg: 0, eg: 0, phase: 0 },
};
const MAX_PHASE = 24;

// Every table is indexed with a1 = 0 and runs from rank 1 to rank 8. Black
// pieces mirror the rank in tableSquare(), so a white pawn on a7 and a black
// pawn on a2 receive the same advancement bonus.
const PST_MG = {
  [PAWN]: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, -20, -20, 10, 10, 5,
    5, -5, -10, 0, 0, -10, -5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, 5, 10, 25, 25, 10, 5, 5,
    10, 10, 20, 30, 30, 20, 10, 10,
    50, 50, 50, 50, 50, 50, 50, 50,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  [KNIGHT]: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  [BISHOP]: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  [ROOK]: [
    0, 0, 0, 0, 0, 0, 0, 0,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    5, 10, 10, 10, 10, 10, 10, 5,
    0, 0, 0, 5, 5, 0, 0, 0,
  ],
  [QUEEN]: [
    -20, -10, -10, 0, 0, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    0, 0, 5, 5, 5, 5, 0, -5,
    -5, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, 0, 0, -10, -10, -20,
  ],
  [KING]: [
    20, 30, 10, 0, 0, 10, 30, 20,
    20, 20, 0, 0, 0, 0, 20, 20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
  ],
};

const PST_EG = {
  [PAWN]: [
    0, 0, 0, 0, 0, 0, 0, 0,
    12, 14, 16, 18, 18, 16, 14, 12,
    18, 20, 22, 24, 24, 22, 20, 18,
    28, 30, 34, 38, 38, 34, 30, 28,
    42, 44, 48, 52, 52, 48, 44, 42,
    62, 64, 68, 72, 72, 68, 64, 62,
    88, 90, 94, 98, 98, 94, 90, 88,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  [KNIGHT]: [
    -40, -30, -20, -20, -20, -20, -30, -40,
    -25, -10, 0, 5, 5, 0, -10, -25,
    -15, 0, 10, 15, 15, 10, 0, -15,
    -10, 5, 15, 20, 20, 15, 5, -10,
    -10, 5, 15, 20, 20, 15, 5, -10,
    -15, 0, 10, 15, 15, 10, 0, -15,
    -25, -10, 0, 5, 5, 0, -10, -25,
    -40, -30, -20, -20, -20, -20, -30, -40,
  ],
  [BISHOP]: [
    -15, -8, -5, -5, -5, -5, -8, -15,
    -8, 0, 5, 8, 8, 5, 0, -8,
    -5, 5, 10, 14, 14, 10, 5, -5,
    -5, 8, 14, 18, 18, 14, 8, -5,
    -5, 8, 14, 18, 18, 14, 8, -5,
    -5, 5, 10, 14, 14, 10, 5, -5,
    -8, 0, 5, 8, 8, 5, 0, -8,
    -15, -8, -5, -5, -5, -5, -8, -15,
  ],
  [ROOK]: [
    0, 0, 4, 8, 8, 4, 0, 0,
    2, 4, 8, 12, 12, 8, 4, 2,
    0, 2, 6, 10, 10, 6, 2, 0,
    0, 2, 6, 10, 10, 6, 2, 0,
    0, 2, 6, 10, 10, 6, 2, 0,
    4, 6, 10, 14, 14, 10, 6, 4,
    12, 14, 16, 18, 18, 16, 14, 12,
    4, 4, 6, 8, 8, 6, 4, 4,
  ],
  [QUEEN]: [
    -10, -5, 0, 5, 5, 0, -5, -10,
    -5, 0, 5, 8, 8, 5, 0, -5,
    0, 5, 8, 10, 10, 8, 5, 0,
    5, 8, 10, 12, 12, 10, 8, 5,
    5, 8, 10, 12, 12, 10, 8, 5,
    0, 5, 8, 10, 10, 8, 5, 0,
    -5, 0, 5, 8, 8, 5, 0, -5,
    -10, -5, 0, 5, 5, 0, -5, -10,
  ],
  [KING]: [
    -50, -30, -30, -30, -30, -30, -30, -50,
    -30, -10, 0, 0, 0, 0, -10, -30,
    -30, 0, 20, 30, 30, 20, 0, -30,
    -30, 0, 30, 40, 40, 30, 0, -30,
    -30, 0, 30, 40, 40, 30, 0, -30,
    -30, 0, 20, 30, 30, 20, 0, -30,
    -30, -10, 0, 0, 0, 0, -10, -30,
    -50, -30, -30, -30, -30, -30, -30, -50,
  ],
};

function clockNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function tableSquare(square, color) {
  return color === WHITE ? square : (7 - rankOf(square)) * 8 + fileOf(square);
}

function signed(color, whiteValue, blackValue = whiteValue) {
  return color === WHITE ? whiteValue : -blackValue;
}

function addPieceScore(score, color, mg, eg) {
  score.mg += signed(color, mg);
  score.eg += signed(color, eg);
}

function pawnAhead(square, color, pawnsByFile) {
  const file = fileOf(square);
  const rank = rankOf(square);
  const enemy = color === WHITE ? BLACK : WHITE;
  for (let candidateFile = Math.max(0, file - 1); candidateFile <= Math.min(7, file + 1); candidateFile += 1) {
    for (const enemySquare of pawnsByFile[enemy][candidateFile]) {
      const enemyRank = rankOf(enemySquare);
      if (color === WHITE ? enemyRank > rank : enemyRank < rank) return true;
    }
  }
  return false;
}

function isInsufficientMaterial(state) {
  const nonKings = [];
  for (const piece of state.board) {
    if (piece && typeOf(piece) !== KING) nonKings.push(piece);
  }
  if (nonKings.length === 0) return true;
  if (nonKings.length === 1 && [BISHOP, KNIGHT].includes(typeOf(nonKings[0]))) return true;
  if (nonKings.every((piece) => typeOf(piece) === BISHOP)) {
    let bishopColor = null;
    for (let square = 0; square < 64; square += 1) {
      if (!state.board[square] || typeOf(state.board[square]) !== BISHOP) continue;
      const squareColor = (fileOf(square) + rankOf(square)) & 1;
      if (bishopColor === null) bishopColor = squareColor;
      else if (bishopColor !== squareColor) return false;
    }
    return true;
  }
  return false;
}

function evaluateWhite(state) {
  const score = { mg: 0, eg: 0, phase: 0 };
  const pawnsByFile = {
    [WHITE]: Array.from({ length: 8 }, () => []),
    [BLACK]: Array.from({ length: 8 }, () => []),
  };
  const pieces = [];

  for (let square = 0; square < 64; square += 1) {
    const piece = state.board[square];
    if (!piece) continue;
    const color = colorOf(piece);
    const type = typeOf(piece);
    const material = MATERIAL[type];
    pieces.push({ square, piece, color, type });
    if (type === PAWN) pawnsByFile[color][fileOf(square)].push(square);
    score.phase += material.phase || 0;
    addPieceScore(
      score,
      color,
      (material.mg || 0) + (PST_MG[type]?.[tableSquare(square, color)] || 0),
      (material.eg || 0) + (PST_EG[type]?.[tableSquare(square, color)] || 0),
    );
  }
  score.phase = Math.min(MAX_PHASE, score.phase);

  const bishops = { [WHITE]: 0, [BLACK]: 0 };
  const kings = { [WHITE]: -1, [BLACK]: -1 };
  for (const piece of pieces) {
    if (piece.type === BISHOP) bishops[piece.color] += 1;
    if (piece.type === KING) kings[piece.color] = piece.square;
  }
  if (bishops[WHITE] > 1) {
    score.mg += 30;
    score.eg += 45;
  }
  if (bishops[BLACK] > 1) {
    score.mg -= 30;
    score.eg -= 45;
  }

  const passedPawns = [];
  for (const piece of pieces) {
    if (piece.type !== PAWN) continue;
    const { square, color } = piece;
    const file = fileOf(square);
    const rank = rankOf(square);
    const advance = color === WHITE ? rank : 7 - rank;
    const ownPawnsOnFile = pawnsByFile[color][file];
    const ownAdjacent = (pawnsByFile[color][file - 1]?.length || 0) + (pawnsByFile[color][file + 1]?.length || 0);
    const passed = !pawnAhead(square, color, pawnsByFile);

    if (ownPawnsOnFile.length > 1) {
      addPieceScore(score, color, -10 * (ownPawnsOnFile.length - 1), -16 * (ownPawnsOnFile.length - 1));
    }
    if (!ownAdjacent) addPieceScore(score, color, -14, -10);
    if (ownAdjacent && ((pawnsByFile[color][file - 1] || []).some((other) => Math.abs(rankOf(other) - rank) <= 1)
      || (pawnsByFile[color][file + 1] || []).some((other) => Math.abs(rankOf(other) - rank) <= 1))) {
      addPieceScore(score, color, 7, 10);
    }
    if (passed) {
      const passedMg = [8, 12, 18, 28, 42, 62, 90, 0][advance] || 0;
      const passedEg = [12, 18, 28, 42, 64, 92, 135, 0][advance] || 0;
      addPieceScore(score, color, passedMg, passedEg);
      passedPawns.push({ square, color, advance });
    }
  }

  for (const piece of pieces) {
    if (piece.type === ROOK) {
      const file = fileOf(piece.square);
      const ownPawns = pawnsByFile[piece.color][file].length;
      const enemy = piece.color === WHITE ? BLACK : WHITE;
      const enemyPawns = pawnsByFile[enemy][file].length;
      if (!ownPawns) addPieceScore(score, piece.color, enemyPawns ? 12 : 22, enemyPawns ? 16 : 28);
      const seventhRank = piece.color === WHITE ? 6 : 1;
      if (rankOf(piece.square) === seventhRank) addPieceScore(score, piece.color, 18, 24);
    }
    if (piece.type === KING) {
      const rank = rankOf(piece.square);
      const file = fileOf(piece.square);
      const direction = piece.color === WHITE ? 1 : -1;
      const shieldRank = rank + direction;
      let shield = 0;
      if (shieldRank >= 0 && shieldRank < 8) {
        for (let shieldFile = Math.max(0, file - 1); shieldFile <= Math.min(7, file + 1); shieldFile += 1) {
          if (state.board[shieldRank * 8 + shieldFile] === (piece.color === WHITE ? PAWN : -PAWN)) shield += 1;
        }
      }
      if (score.phase > 12) {
        addPieceScore(score, piece.color, shield * 8 - (3 - shield) * 5, shield * 3);
        if ((file === 2 || file === 6) && rank === (piece.color === WHITE ? 0 : 7)) {
          addPieceScore(score, piece.color, 18, 0);
        }
      }
    }
  }

  for (const passed of passedPawns) {
    const ownKing = kings[passed.color];
    const enemy = passed.color === WHITE ? BLACK : WHITE;
    const enemyKing = kings[enemy];
    if (ownKing >= 0) {
      const kingDistance = Math.max(Math.abs(fileOf(ownKing) - fileOf(passed.square)), Math.abs(rankOf(ownKing) - rankOf(passed.square)));
      addPieceScore(score, passed.color, 0, Math.max(0, 7 - kingDistance) * 3);
    }
    if (enemyKing >= 0) {
      const kingDistance = Math.max(Math.abs(fileOf(enemyKing) - fileOf(passed.square)), Math.abs(rankOf(enemyKing) - rankOf(passed.square)));
      addPieceScore(score, passed.color, 0, -Math.max(0, 7 - kingDistance) * 2);
    }
  }

  return Math.round((score.mg * score.phase + score.eg * (MAX_PHASE - score.phase)) / MAX_PHASE);
}

function evaluate(state) {
  const whiteScore = evaluateWhite(state);
  return state.turn === WHITE ? whiteScore : -whiteScore;
}

function capturedValue(state, move) {
  if (move.flags & MOVE_EN_PASSANT) return MATERIAL[PAWN].mg;
  return MATERIAL[typeOf(state.board[move.to])]?.mg || 0;
}

function isCapture(move) {
  return Boolean(move.flags & MOVE_CAPTURE);
}

function isPromotion(move) {
  return Boolean(move.flags & MOVE_PROMOTION) || Boolean(move.promotion);
}

function hasSafeNullMoveMaterial(state) {
  let sideMajor = 0;
  let sideMinor = 0;
  for (const piece of state.board) {
    if (!piece || colorOf(piece) !== state.turn) continue;
    const type = typeOf(piece);
    if (type === QUEEN || type === ROOK) sideMajor += 1;
    else if (type === BISHOP || type === KNIGHT) sideMinor += 1;
  }
  // Bare-pawn and minor-piece endings are especially prone to zugzwang. A
  // null move is reserved for positions where the side to move has a major
  // piece and enough material that passing is a useful lower-bound test.
  return sideMajor > 0 && sideMajor + sideMinor >= 2;
}

function isMateScore(score) {
  return Math.abs(score) >= MATE_SCORE - MAX_PLY;
}

function scoreToTable(score, ply) {
  if (score >= MATE_SCORE - MAX_PLY) return score + ply;
  if (score <= -MATE_SCORE + MAX_PLY) return score - ply;
  return score;
}

function scoreFromTable(score, ply) {
  if (score >= MATE_SCORE - MAX_PLY) return score - ply;
  if (score <= -MATE_SCORE + MAX_PLY) return score + ply;
  return score;
}

function scoreObject(score) {
  if (isMateScore(score)) {
    const sign = score >= 0 ? 1 : -1;
    const distance = Math.ceil((MATE_SCORE - Math.abs(score) + 1) / 2);
    return { mate: sign * Math.max(1, distance) };
  }
  return { cp: Math.round(score) };
}

function normaliseCounts(source) {
  const counts = new Map();
  if (source instanceof Map) {
    for (const [key, value] of source) {
      const count = Number(value);
      if (typeof key === 'string' && Number.isFinite(count) && count > 0) counts.set(key, Math.floor(count));
    }
  } else if (Array.isArray(source)) {
    for (const entry of source) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const count = Number(entry[1]);
      if (typeof entry[0] === 'string' && Number.isFinite(count) && count > 0) counts.set(entry[0], Math.floor(count));
    }
  } else if (source && typeof source === 'object') {
    for (const [key, value] of Object.entries(source)) {
      const count = Number(value);
      if (Number.isFinite(count) && count > 0) counts.set(key, Math.floor(count));
    }
  }
  return counts;
}

function hashText(text, seed) {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function keyHash(key) {
  return [hashText(key, 2166136261), hashText(key, 2246822519)];
}

function addHashTerm(hash, token, count) {
  return [
    (hash[0] + Math.imul(token[0], count)) >>> 0,
    (hash[1] + Math.imul(token[1], count)) >>> 0,
  ];
}

class SearchTimeout extends Error {}

class Searcher {
  constructor(root, limits = {}, onInfo = () => {}) {
    this.root = root;
    this.maxDepth = Math.max(1, Math.min(64, Math.floor(Number(limits.maxDepth ?? 8) || 8)));
    this.start = clockNow();
    this.timeMs = limits.infinite ? Infinity : Math.max(1, Number.isFinite(Number(limits.timeMs)) ? Number(limits.timeMs) : 1200);
    this.deadline = this.timeMs === Infinity ? Infinity : this.start + this.timeMs;
    this.nodeLimit = Number.isFinite(Number(limits.nodes)) ? Math.max(1, Math.floor(Number(limits.nodes))) : Infinity;
    this.onInfo = typeof onInfo === 'function' ? onInfo : () => {};
    this.nodes = 0;
    this.table = new Map();
    this.killers = new Map();
    this.history = new Map();
    this.pvTable = [];
    this.repetitionCounts = normaliseCounts(root.positionCounts || root.repetitionCounts);
    const rootKey = positionKey(root);
    if (!this.repetitionCounts.has(rootKey)) this.repetitionCounts.set(rootKey, 1);
    this.keyTokens = new Map();
    this.contextHash = [0, 0];
    for (const [key, count] of this.repetitionCounts) {
      const token = keyHash(key);
      this.keyTokens.set(key, token);
      this.contextHash = addHashTerm(this.contextHash, token, count);
    }
    this.rootOccurrence = this.repetitionCounts.get(rootKey) || 1;
  }

  checkTime() {
    if (this.nodes >= this.nodeLimit) throw new SearchTimeout();
    if ((this.nodes & TIME_CHECK_MASK) === 0 && clockNow() >= this.deadline) throw new SearchTimeout();
  }

  keyToken(key) {
    let token = this.keyTokens.get(key);
    if (!token) {
      token = keyHash(key);
      this.keyTokens.set(key, token);
    }
    return token;
  }

  pushPosition(key) {
    const oldCount = this.repetitionCounts.get(key) || 0;
    const token = this.keyToken(key);
    this.contextHash = addHashTerm(this.contextHash, token, -oldCount);
    this.contextHash = addHashTerm(this.contextHash, token, oldCount + 1);
    this.repetitionCounts.set(key, oldCount + 1);
  }

  popPosition(key) {
    const oldCount = this.repetitionCounts.get(key) || 0;
    const token = this.keyToken(key);
    this.contextHash = addHashTerm(this.contextHash, token, -oldCount);
    if (oldCount <= 1) this.repetitionCounts.delete(key);
    else {
      this.contextHash = addHashTerm(this.contextHash, token, oldCount - 1);
      this.repetitionCounts.set(key, oldCount - 1);
    }
  }

  searchChild(state, move, callback) {
    const child = applyMove(state, move);
    const childKey = positionKey(child);
    this.pushPosition(childKey);
    try {
      return callback(child);
    } finally {
      this.popPosition(childKey);
    }
  }

  currentCount(state) {
    return this.repetitionCounts.get(positionKey(state)) || 1;
  }

  isAutomaticDraw(state, count = this.currentCount(state)) {
    return count >= 5 || state.halfmove >= 150 || isInsufficientMaterial(state);
  }

  isClaimableDraw(state, count = this.currentCount(state)) {
    return count >= 3 || state.halfmove >= 100;
  }

  ttKey(state) {
    return `${positionKey(state)}|${state.halfmove}|${this.contextHash[0].toString(16)}:${this.contextHash[1].toString(16)}`;
  }

  probeTable(state, depth, ply, alpha, beta) {
    const entry = this.table.get(this.ttKey(state));
    if (!entry || entry.depth < depth) return { entry, alpha, beta, score: null };
    const score = scoreFromTable(entry.score, ply);
    this.pvTable[ply] = entry.pv?.slice(0, MAX_PV_LENGTH) || (entry.best ? [entry.best] : []);
    if (entry.flag === 'exact') return { entry, alpha, beta, score };
    if (entry.flag === 'lower') alpha = Math.max(alpha, score);
    if (entry.flag === 'upper') beta = Math.min(beta, score);
    return { entry, alpha, beta, score: alpha >= beta ? score : null };
  }

  storeTable(key, depth, score, flag, bestMove, ply) {
    if (this.table.size >= MAX_TABLE_SIZE) {
      let removed = 0;
      for (const oldKey of this.table.keys()) {
        this.table.delete(oldKey);
        removed += 1;
        if (removed >= 20000) break;
      }
    }
    this.table.set(key, {
      depth,
      score: scoreToTable(score, ply),
      flag,
      best: bestMove ? moveToUci(bestMove) : '',
      pv: this.pvTable[ply]?.slice(0, MAX_PV_LENGTH) || [],
    });
  }

  orderMoves(state, moves, ttMove = '', ply = 0) {
    const killerMoves = this.killers.get(ply) || [];
    return moves.slice().sort((a, b) => this.moveScore(state, b, ttMove, killerMoves, ply)
      - this.moveScore(state, a, ttMove, killerMoves, ply));
  }

  moveScore(state, move, ttMove, killerMoves, ply) {
    const uci = moveToUci(move);
    let score = 0;
    if (uci === ttMove) score += 2_000_000;
    if (isPromotion(move)) score += 100_000 + (MATERIAL[move.promotion]?.mg || 0);
    if (isCapture(move)) {
      score += 20_000 + capturedValue(state, move) * 16
        - (MATERIAL[typeOf(state.board[move.from])]?.mg || 0);
    }
    if (killerMoves.includes(uci)) score += 8_000;
    score += this.history.get(uci) || 0;
    return score - ply * 0.001;
  }

  rememberKiller(move, ply) {
    const uci = moveToUci(move);
    const killers = this.killers.get(ply) || [];
    if (!killers.includes(uci)) this.killers.set(ply, [uci, ...killers].slice(0, 2));
  }

  updateHistory(move, depth) {
    const uci = moveToUci(move);
    const old = this.history.get(uci) || 0;
    this.history.set(uci, Math.max(-10000, Math.min(10000, old + depth * depth)));
  }

  negamax(state, depth, alpha, beta, ply, allowNull = true) {
    this.nodes += 1;
    this.checkTime();
    this.pvTable[ply] = [];

    if (depth <= 0) return this.quiescence(state, alpha, beta, ply, 0);

    const count = this.currentCount(state);
    const claimable = this.isClaimableDraw(state, count);
    if (claimable && alpha < 0) alpha = 0;
    const originalAlpha = alpha;
    const originalBeta = beta;
    const tableKey = this.ttKey(state);
    const cached = this.probeTable(state, depth, ply, alpha, beta);
    alpha = cached.alpha;
    beta = cached.beta;
    if (cached.score !== null) return cached.score;

    const legalMoves = getLegalMoves(state);
    if (!legalMoves.length) return isInCheck(state) ? -MATE_SCORE + ply : 0;
    if (this.isAutomaticDraw(state, count)) return 0;
    if (alpha >= beta) return 0;

    const inCheck = isInCheck(state);
    if (allowNull && depth >= 5 && !inCheck && !claimable && state.halfmove < 90 && beta < MATE_SCORE - MAX_PLY
      && hasSafeNullMoveMaterial(state) && evaluate(state) >= beta) {
      const nullState = {
        ...state,
        turn: state.turn === WHITE ? BLACK : WHITE,
        ep: -1,
        halfmove: state.halfmove + 1,
        fullmove: state.fullmove,
        lastMove: null,
      };
      const nullKey = positionKey(nullState);
      const reduction = 2 + Math.floor(depth / 4);
      const nullDepth = Math.max(1, depth - 1 - reduction);
      // Do not let a synthetic pass inherit an actual repetition occurrence.
      // That would turn a null move into an unsafe draw claim.
      if (!this.repetitionCounts.has(nullKey)) {
        const nullScore = -this.negamax(nullState, nullDepth, -beta, -beta + 1, ply + 1, false);
        if (nullScore >= beta) return nullScore;
      }
    }

    const ordered = this.orderMoves(state, legalMoves, cached.entry?.best || '', ply);
    let bestScore = claimable ? 0 : -INFINITY;
    let bestMove = ordered[0];
    let bestLine = claimable ? [] : [moveToUci(bestMove)];

    for (let index = 0; index < ordered.length; index += 1) {
      this.checkTime();
      const candidate = ordered[index];
      const score = this.searchChild(state, candidate, (child) => {
        if (index === 0) {
          return -this.negamax(child, depth - 1, -beta, -alpha, ply + 1);
        }
        const quiet = !isCapture(candidate) && !isPromotion(candidate);
        const late = index >= 4 && depth >= 5 && quiet && !inCheck;
        const reduction = late ? (depth >= 10 ? 2 : 1) : 0;
        let reducedWindowScore = -this.negamax(child, depth - 1 - reduction, -alpha - 1, -alpha, ply + 1);
        if (reducedWindowScore > alpha && reducedWindowScore < beta) {
          reducedWindowScore = -this.negamax(child, depth - 1, -beta, -alpha, ply + 1);
        }
        return reducedWindowScore;
      });
      const childLine = this.pvTable[ply + 1] || [];
      if (score > bestScore) {
        bestScore = score;
        bestMove = candidate;
        bestLine = [moveToUci(candidate), ...childLine].slice(0, MAX_PV_LENGTH);
      }
      if (score > alpha) {
        alpha = score;
        this.pvTable[ply] = [moveToUci(candidate), ...childLine].slice(0, MAX_PV_LENGTH);
      }
      if (alpha >= beta) {
        if (!isCapture(candidate) && !isPromotion(candidate)) {
          this.rememberKiller(candidate, ply);
          this.updateHistory(candidate, depth);
        }
        break;
      }
    }

    if (!this.pvTable[ply].length) this.pvTable[ply] = bestLine;
    const flag = bestScore <= originalAlpha ? 'upper' : bestScore >= originalBeta ? 'lower' : 'exact';
    this.storeTable(tableKey, depth, bestScore, flag, bestMove, ply);
    return bestScore;
  }

  quiescence(state, alpha, beta, ply, quietDepth) {
    this.nodes += 1;
    this.checkTime();
    this.pvTable[ply] = [];

    const count = this.currentCount(state);
    const legalMoves = getLegalMoves(state);
    if (!legalMoves.length) return isInCheck(state) ? -MATE_SCORE + ply : 0;
    if (this.isAutomaticDraw(state, count)) return 0;

    const claimable = this.isClaimableDraw(state, count);
    if (claimable && alpha < 0) alpha = 0;
    if (alpha >= beta) return 0;

    const inCheck = isInCheck(state);
    let bestScore = claimable ? 0 : -INFINITY;
    let bestMove = legalMoves[0];
    let bestLine = inCheck && !claimable ? [moveToUci(bestMove)] : [];

    if (!inCheck) {
      const standPat = evaluate(state);
      bestScore = Math.max(bestScore, standPat);
      if (standPat >= beta) return standPat;
      if (standPat > alpha) alpha = standPat;
      if (quietDepth >= MAX_QUIET_DEPTH) return alpha;
    }

    const tactical = [];
    for (const candidate of legalMoves) {
      let child = null;
      let isTactical = inCheck || isCapture(candidate) || isPromotion(candidate);
      if (!isTactical) {
        child = applyMove(state, candidate);
        isTactical = isInCheck(child);
      }
      if (isTactical) tactical.push({ candidate, child: child || applyMove(state, candidate) });
    }
    const ordered = this.orderMoves(state, tactical.map((entry) => entry.candidate), '', ply);
    for (const candidate of ordered) {
      this.checkTime();
      const cachedChild = tactical.find((entry) => entry.candidate === candidate)?.child;
      const score = this.searchChildWithState(state, candidate, cachedChild, (child) => (
        -this.quiescence(child, -beta, -alpha, ply + 1, quietDepth + 1)
      ));
      const childLine = this.pvTable[ply + 1] || [];
      if (score > bestScore) {
        bestScore = score;
        bestMove = candidate;
        bestLine = [moveToUci(candidate), ...childLine].slice(0, MAX_PV_LENGTH);
      }
      if (score > alpha) {
        alpha = score;
        this.pvTable[ply] = [moveToUci(candidate), ...childLine].slice(0, MAX_PV_LENGTH);
      }
      if (alpha >= beta) return alpha;
    }
    if (!this.pvTable[ply].length) this.pvTable[ply] = bestLine;
    return alpha;
  }

  searchChildWithState(state, move, child, callback) {
    const next = child || applyMove(state, move);
    const childKey = positionKey(next);
    this.pushPosition(childKey);
    try {
      return callback(next);
    } finally {
      this.popPosition(childKey);
    }
  }

  rootSearch(depth, legalMoves, alpha, beta) {
    this.checkTime();
    this.pvTable[0] = [];
    const originalAlpha = alpha;
    const originalBeta = beta;
    const rootClaimable = this.isClaimableDraw(this.root, this.currentCount(this.root));
    if (rootClaimable) alpha = Math.max(alpha, 0);
    const cached = this.table.get(this.ttKey(this.root));
    const ordered = this.orderMoves(this.root, legalMoves, cached?.best || '', 0);
    let bestScore = rootClaimable ? 0 : -INFINITY;
    let bestMove = ordered[0];
    let bestLine = [moveToUci(bestMove)];

    for (let index = 0; index < ordered.length; index += 1) {
      this.checkTime();
      const candidate = ordered[index];
      const score = this.searchChild(this.root, candidate, (child) => {
        if (index === 0) return -this.negamax(child, depth - 1, -beta, -alpha, 1);
        let result = -this.negamax(child, depth - 1, -alpha - 1, -alpha, 1);
        if (result > alpha && result < beta) result = -this.negamax(child, depth - 1, -beta, -alpha, 1);
        return result;
      });
      const childLine = this.pvTable[1] || [];
      if (score > bestScore) {
        bestScore = score;
        bestMove = candidate;
        bestLine = [moveToUci(candidate), ...childLine].slice(0, MAX_PV_LENGTH);
      }
      if (score > alpha) {
        alpha = score;
        this.pvTable[0] = [moveToUci(candidate), ...childLine].slice(0, MAX_PV_LENGTH);
      }
      if (alpha >= beta) {
        if (!isCapture(candidate) && !isPromotion(candidate)) {
          this.rememberKiller(candidate, 0);
          this.updateHistory(candidate, depth);
        }
        break;
      }
    }

    if (!this.pvTable[0].length) this.pvTable[0] = bestLine;
    const flag = bestScore <= originalAlpha ? 'upper' : bestScore >= originalBeta ? 'lower' : 'exact';
    this.storeTable(this.ttKey(this.root), depth, bestScore, flag, bestMove, 0);
    return { move: bestMove, score: bestScore, pv: this.pvTable[0].slice(0, MAX_PV_LENGTH) };
  }

  aspirationSearch(depth, legalMoves, previousScore) {
    if (previousScore === null || isMateScore(previousScore)) {
      return this.rootSearch(depth, legalMoves, -INFINITY, INFINITY);
    }
    let window = 50;
    let alpha = Math.max(-INFINITY, previousScore - window);
    let beta = Math.min(INFINITY, previousScore + window);
    for (;;) {
      const result = this.rootSearch(depth, legalMoves, alpha, beta);
      if (result.score <= alpha) {
        if (alpha <= -INFINITY + 1) return this.rootSearch(depth, legalMoves, -INFINITY, INFINITY);
        window = Math.min(INFINITY, window * 2);
        alpha = Math.max(-INFINITY, previousScore - window);
        continue;
      }
      if (result.score >= beta) {
        if (beta >= INFINITY - 1) return this.rootSearch(depth, legalMoves, -INFINITY, INFINITY);
        window = Math.min(INFINITY, window * 2);
        beta = Math.min(INFINITY, previousScore + window);
        continue;
      }
      return result;
    }
  }

  run() {
    const legalMoves = getLegalMoves(this.root);
    const start = this.start;
    if (!legalMoves.length) {
      const terminalScore = isInCheck(this.root) ? -MATE_SCORE : 0;
      return {
        move: null,
        depth: 0,
        score: scoreObject(terminalScore),
        nodes: this.nodes,
        elapsedMs: clockNow() - start,
        pv: [],
      };
    }
    if (this.isAutomaticDraw(this.root, this.currentCount(this.root))) {
      return {
        move: null,
        depth: 0,
        score: { cp: 0 },
        nodes: this.nodes,
        elapsedMs: clockNow() - start,
        pv: [],
      };
    }

    let bestMove = legalMoves[0];
    let bestScore = evaluate(this.root);
    let bestPv = [moveToUci(bestMove)];
    let completedDepth = 0;
    let previousScore = null;

    for (let depth = 1; depth <= this.maxDepth; depth += 1) {
      try {
        const result = this.aspirationSearch(depth, legalMoves, previousScore);
        bestMove = result.move;
        bestScore = result.score;
        bestPv = result.pv.slice(0, MAX_PV_LENGTH);
        completedDepth = depth;
        previousScore = bestScore;
        this.onInfo({
          depth,
          score: scoreObject(bestScore),
          nodes: this.nodes,
          elapsedMs: clockNow() - start,
          pv: bestPv.slice(),
        });
      } catch (error) {
        if (!(error instanceof SearchTimeout)) throw error;
        break;
      }
    }

    return {
      move: bestMove,
      depth: completedDepth,
      score: scoreObject(bestScore),
      nodes: this.nodes,
      elapsedMs: clockNow() - start,
      pv: bestPv.slice(),
    };
  }
}

export function searchBestMove(state, limits = {}, onInfo = () => {}) {
  return new Searcher(state, limits, onInfo).run();
}
