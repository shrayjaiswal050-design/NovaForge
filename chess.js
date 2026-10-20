// Nova Chess rules core. Coordinates use a1 = 0 and h8 = 63.

export const WHITE = 0;
export const BLACK = 1;

export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

export const CASTLE_WHITE_KING = 1;
export const CASTLE_WHITE_QUEEN = 2;
export const CASTLE_BLACK_KING = 4;
export const CASTLE_BLACK_QUEEN = 8;

export const MOVE_CAPTURE = 1;
export const MOVE_DOUBLE_PAWN = 2;
export const MOVE_EN_PASSANT = 4;
export const MOVE_CASTLE = 8;
export const MOVE_PROMOTION = 16;

export const PROMOTION_PIECES = [QUEEN, ROOK, BISHOP, KNIGHT];
export const FILES = 'abcdefgh';
export const PIECE_GLYPHS = {
  [PAWN]: '♟',
  [KNIGHT]: '♞',
  [BISHOP]: '♝',
  [ROOK]: '♜',
  [QUEEN]: '♛',
  [KING]: '♚',
};
export const PIECE_LETTERS = {
  [PAWN]: '',
  [KNIGHT]: 'N',
  [BISHOP]: 'B',
  [ROOK]: 'R',
  [QUEEN]: 'Q',
  [KING]: 'K',
};
export const PIECE_NAMES = {
  [PAWN]: 'Pawn',
  [KNIGHT]: 'Knight',
  [BISHOP]: 'Bishop',
  [ROOK]: 'Rook',
  [QUEEN]: 'Queen',
  [KING]: 'King',
};

function pieceOf(color, type) {
  return color === WHITE ? type : -type;
}

export function colorOf(piece) {
  if (piece === 0) return null;
  return piece > 0 ? WHITE : BLACK;
}

export function typeOf(piece) {
  return Math.abs(piece);
}

export function squareOf(file, rank) {
  return rank * 8 + file;
}

export function fileOf(square) {
  return square & 7;
}

export function rankOf(square) {
  return square >> 3;
}

export function squareName(square) {
  return `${FILES[fileOf(square)]}${rankOf(square) + 1}`;
}

export function parseSquare(value) {
  if (!/^[a-h][1-8]$/.test(value)) return -1;
  return squareOf(FILES.indexOf(value[0]), Number(value[1]) - 1);
}

function emptyBoard() {
  return new Array(64).fill(0);
}

export function createInitialState() {
  const board = emptyBoard();
  const backRank = [ROOK, KNIGHT, BISHOP, QUEEN, KING, BISHOP, KNIGHT, ROOK];
  for (let file = 0; file < 8; file += 1) {
    board[squareOf(file, 0)] = pieceOf(WHITE, backRank[file]);
    board[squareOf(file, 1)] = pieceOf(WHITE, PAWN);
    board[squareOf(file, 6)] = pieceOf(BLACK, PAWN);
    board[squareOf(file, 7)] = pieceOf(BLACK, backRank[file]);
  }
  const state = {
    board,
    turn: WHITE,
    castling: CASTLE_WHITE_KING | CASTLE_WHITE_QUEEN | CASTLE_BLACK_KING | CASTLE_BLACK_QUEEN,
    ep: -1,
    halfmove: 0,
    fullmove: 1,
    history: [],
    positionCounts: new Map(),
    lastMove: null,
  };
  state.positionCounts.set(positionKey(state), 1);
  return state;
}

const CHESS960_POSITION_COUNT = 960;
const CHESS960_DARK_BISHOP_FILES = [0, 2, 4, 6];
const CHESS960_LIGHT_BISHOP_FILES = [1, 3, 5, 7];
const CHESS960_KNIGHT_PAIRS = [
  [0, 1], [0, 2], [0, 3], [0, 4], [1, 2],
  [1, 3], [1, 4], [2, 3], [2, 4], [3, 4],
];

function normalizeChess960Seed(seed) {
  if (!Number.isSafeInteger(seed)) throw new Error('Chess960 seed must be a safe integer.');
  return ((seed % CHESS960_POSITION_COUNT) + CHESS960_POSITION_COUNT) % CHESS960_POSITION_COUNT;
}

function generateChess960BackRank(seed) {
  let position = normalizeChess960Seed(seed);
  const backRank = new Array(8).fill(0);

  const lightBishopFile = CHESS960_LIGHT_BISHOP_FILES[position % 4];
  backRank[lightBishopFile] = BISHOP;
  position = Math.floor(position / 4);

  const darkBishopFile = CHESS960_DARK_BISHOP_FILES[position % 4];
  backRank[darkBishopFile] = BISHOP;
  position = Math.floor(position / 4);

  let openFiles = backRank.map((piece, file) => (piece ? -1 : file)).filter((file) => file >= 0);
  const queenFile = openFiles[position % 6];
  backRank[queenFile] = QUEEN;
  position = Math.floor(position / 6);

  openFiles = backRank.map((piece, file) => (piece ? -1 : file)).filter((file) => file >= 0);
  const [firstKnight, secondKnight] = CHESS960_KNIGHT_PAIRS[position];
  backRank[openFiles[firstKnight]] = KNIGHT;
  backRank[openFiles[secondKnight]] = KNIGHT;

  openFiles = backRank.map((piece, file) => (piece ? -1 : file)).filter((file) => file >= 0);
  backRank[openFiles[0]] = ROOK;
  backRank[openFiles[1]] = KING;
  backRank[openFiles[2]] = ROOK;
  return backRank;
}

function createChess960Homes(backRank) {
  const kingFile = backRank.indexOf(KING);
  const rookFiles = backRank
    .map((piece, file) => (piece === ROOK ? file : -1))
    .filter((file) => file >= 0)
    .sort((a, b) => a - b);
  if (kingFile < 0 || rookFiles.length !== 2 || rookFiles[0] >= kingFile || rookFiles[1] <= kingFile) {
    throw new Error('Chess960 back rank must place the king between the rooks.');
  }
  return {
    king: {
      [WHITE]: squareOf(kingFile, 0),
      [BLACK]: squareOf(kingFile, 7),
    },
    rooks: {
      [WHITE]: {
        queenSide: squareOf(rookFiles[0], 0),
        kingSide: squareOf(rookFiles[1], 0),
      },
      [BLACK]: {
        queenSide: squareOf(rookFiles[0], 7),
        kingSide: squareOf(rookFiles[1], 7),
      },
    },
  };
}

export function createChess960State(seed = 518) {
  const backRank = generateChess960BackRank(seed);
  const board = emptyBoard();
  for (let file = 0; file < 8; file += 1) {
    board[squareOf(file, 0)] = pieceOf(WHITE, backRank[file]);
    board[squareOf(file, 1)] = pieceOf(WHITE, PAWN);
    board[squareOf(file, 6)] = pieceOf(BLACK, PAWN);
    board[squareOf(file, 7)] = pieceOf(BLACK, backRank[file]);
  }
  const state = {
    board,
    turn: WHITE,
    castling: CASTLE_WHITE_KING | CASTLE_WHITE_QUEEN | CASTLE_BLACK_KING | CASTLE_BLACK_QUEEN,
    ep: -1,
    halfmove: 0,
    fullmove: 1,
    history: [],
    positionCounts: new Map(),
    lastMove: null,
    variant: 'chess960',
    chess960Seed: seed,
    chess960Homes: createChess960Homes(backRank),
  };
  state.positionCounts.set(positionKey(state), 1);
  return state;
}

export function createStateForVariant({ variant = 'standard', chess960Seed = 518 } = {}) {
  if (typeof variant !== 'string') throw new Error('Variant must be a string.');
  const normalizedVariant = variant.trim().toLowerCase();
  if (normalizedVariant === 'standard') return createInitialState();
  if (normalizedVariant === 'chess960') return createChess960State(chess960Seed);
  throw new Error(`Unsupported chess variant: ${variant}`);
}

export function stateFromFEN(fen) {
  if (typeof fen !== 'string') throw new Error('FEN must be a string.');
  const fields = fen.trim().split(/\s+/);
  if (fields.length !== 6) throw new Error('A FEN position needs exactly six fields.');
  const board = emptyBoard();
  const ranks = fields[0].split('/');
  if (ranks.length !== 8) throw new Error('FEN board must have eight ranks.');
  const kingSquares = { [WHITE]: -1, [BLACK]: -1 };
  for (let fenRank = 0; fenRank < 8; fenRank += 1) {
    let file = 0;
    let previousWasDigit = false;
    for (const symbol of ranks[fenRank]) {
      if (/^[1-8]$/.test(symbol)) {
        if (previousWasDigit) throw new Error('FEN ranks must use one digit per empty run.');
        file += Number(symbol);
        previousWasDigit = true;
      } else {
        const lower = symbol.toLowerCase();
        const type = { p: PAWN, n: KNIGHT, b: BISHOP, r: ROOK, q: QUEEN, k: KING }[lower];
        if (!type || file > 7) throw new Error(`Invalid FEN piece: ${symbol}`);
        const color = symbol === lower ? BLACK : WHITE;
        const square = squareOf(file, 7 - fenRank);
        if (type === PAWN && (7 - fenRank === 0 || 7 - fenRank === 7)) {
          throw new Error('FEN pawns cannot be placed on the back rank.');
        }
        board[square] = pieceOf(color, type);
        if (type === KING) {
          if (kingSquares[color] >= 0) throw new Error('FEN must contain exactly one king per side.');
          kingSquares[color] = square;
        }
        file += 1;
        previousWasDigit = false;
      }
      if (file > 8) throw new Error('Each FEN rank must describe eight squares.');
    }
    if (file !== 8) throw new Error('Each FEN rank must describe eight squares.');
  }
  if (kingSquares[WHITE] < 0 || kingSquares[BLACK] < 0) {
    throw new Error('FEN must contain exactly one king per side.');
  }

  if (fields[1] !== 'w' && fields[1] !== 'b') throw new Error('FEN active color must be w or b.');

  const halfmove = parseFenClock(fields[4], 'halfmove', 0);
  const fullmove = parseFenClock(fields[5], 'fullmove', 1);

  const castlingText = fields[2];
  let castling = 0;
  if (castlingText !== '-') {
    if (!/^[KQkq]+$/.test(castlingText)) throw new Error('Invalid FEN castling field.');
    const canonicalCastling = ['K', 'Q', 'k', 'q'].filter((right) => castlingText.includes(right)).join('');
    if (castlingText !== canonicalCastling) throw new Error('Invalid FEN castling field.');
    if (castlingText.includes('K')) castling |= CASTLE_WHITE_KING;
    if (castlingText.includes('Q')) castling |= CASTLE_WHITE_QUEEN;
    if (castlingText.includes('k')) castling |= CASTLE_BLACK_KING;
    if (castlingText.includes('q')) castling |= CASTLE_BLACK_QUEEN;
  }
  validateFenCastling(board, castling);

  let ep = -1;
  if (fields[3] !== '-') {
    ep = parseSquare(fields[3]);
    if (ep < 0) throw new Error('Invalid FEN en-passant square.');
    const turn = fields[1] === 'b' ? BLACK : WHITE;
    const expectedRank = turn === WHITE ? 5 : 2;
    const direction = turn === WHITE ? 8 : -8;
    const capturedSquare = ep - direction;
    const originSquare = ep + direction;
    if (rankOf(ep) !== expectedRank || board[ep] || !board[capturedSquare]
      || board[capturedSquare] !== pieceOf(turn === WHITE ? BLACK : WHITE, PAWN)
      || board[originSquare]) {
      throw new Error('Invalid FEN en-passant state.');
    }
    if (halfmove !== 0) throw new Error('FEN en-passant positions must have a zero halfmove clock.');
  }
  const state = {
    board,
    turn: fields[1] === 'b' ? BLACK : WHITE,
    castling,
    ep,
    halfmove,
    fullmove,
    history: [],
    positionCounts: new Map(),
    lastMove: null,
  };

  const whiteKingFile = fileOf(kingSquares[WHITE]);
  const whiteKingRank = rankOf(kingSquares[WHITE]);
  const blackKingFile = fileOf(kingSquares[BLACK]);
  const blackKingRank = rankOf(kingSquares[BLACK]);
  if (Math.max(Math.abs(whiteKingFile - blackKingFile), Math.abs(whiteKingRank - blackKingRank)) <= 1) {
    throw new Error('FEN kings cannot be adjacent.');
  }
  const sideNotToMove = state.turn === WHITE ? BLACK : WHITE;
  if (isInCheck(state, sideNotToMove)) throw new Error('The FEN side not to move cannot be in check.');
  state.positionCounts.set(positionKey(state), 1);
  return state;
}

function parseFenClock(value, name, minimum) {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) throw new Error(`Invalid FEN ${name} clock.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`Invalid FEN ${name} clock.`);
  return parsed;
}

function validateFenCastling(board, castling) {
  const requiredPieces = [
    [CASTLE_WHITE_KING, squareOf(4, 0), pieceOf(WHITE, KING), squareOf(7, 0), pieceOf(WHITE, ROOK)],
    [CASTLE_WHITE_QUEEN, squareOf(4, 0), pieceOf(WHITE, KING), squareOf(0, 0), pieceOf(WHITE, ROOK)],
    [CASTLE_BLACK_KING, squareOf(4, 7), pieceOf(BLACK, KING), squareOf(7, 7), pieceOf(BLACK, ROOK)],
    [CASTLE_BLACK_QUEEN, squareOf(4, 7), pieceOf(BLACK, KING), squareOf(0, 7), pieceOf(BLACK, ROOK)],
  ];
  for (const [right, kingSquare, king, rookSquare, rook] of requiredPieces) {
    if (castling & right && (board[kingSquare] !== king || board[rookSquare] !== rook)) {
      throw new Error('FEN castling rights do not match the king and rook placement.');
    }
  }
}

export function toFEN(state) {
  const ranks = [];
  for (let rank = 7; rank >= 0; rank -= 1) {
    let text = '';
    let empty = 0;
    for (let file = 0; file < 8; file += 1) {
      const piece = state.board[squareOf(file, rank)];
      if (!piece) {
        empty += 1;
        continue;
      }
      if (empty) {
        text += empty;
        empty = 0;
      }
      const letter = ' pnbrqk'[typeOf(piece)];
      text += colorOf(piece) === WHITE ? letter.toUpperCase() : letter;
    }
    if (empty) text += empty;
    ranks.push(text);
  }
  let castling = '';
  if (state.castling & CASTLE_WHITE_KING) castling += 'K';
  if (state.castling & CASTLE_WHITE_QUEEN) castling += 'Q';
  if (state.castling & CASTLE_BLACK_KING) castling += 'k';
  if (state.castling & CASTLE_BLACK_QUEEN) castling += 'q';
  return `${ranks.join('/')} ${state.turn === WHITE ? 'w' : 'b'} ${castling || '-'} ${state.ep < 0 ? '-' : squareName(state.ep)} ${state.halfmove} ${state.fullmove}`;
}

const KNIGHT_STEPS = [
  [1, 2], [2, 1], [2, -1], [1, -2],
  [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];
const KING_STEPS = [[1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
const BISHOP_DIRECTIONS = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
const ROOK_DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function inside(file, rank) {
  return file >= 0 && file < 8 && rank >= 0 && rank < 8;
}

function move(from, to, flags = 0, promotion = 0) {
  return { from, to, flags, promotion };
}

function addPawnMove(moves, from, to, flags, color, promotionRank) {
  if (rankOf(to) === promotionRank) {
    for (const promotion of PROMOTION_PIECES) {
      moves.push(move(from, to, flags | MOVE_PROMOTION, promotion));
    }
  } else {
    moves.push(move(from, to, flags, 0));
  }
}

function addSlidingMoves(state, moves, from, piece, directions) {
  const color = colorOf(piece);
  const fromFile = fileOf(from);
  const fromRank = rankOf(from);
  for (const [df, dr] of directions) {
    let file = fromFile + df;
    let rank = fromRank + dr;
    while (inside(file, rank)) {
      const to = squareOf(file, rank);
      const target = state.board[to];
      if (!target) {
        moves.push(move(from, to));
      } else {
        if (colorOf(target) !== color && typeOf(target) !== KING) {
          moves.push(move(from, to, MOVE_CAPTURE));
        }
        break;
      }
      file += df;
      rank += dr;
    }
  }
}

export function isSquareAttacked(state, square, byColor) {
  const file = fileOf(square);
  const rank = rankOf(square);
  const pawnRank = rank + (byColor === WHITE ? -1 : 1);
  for (const pawnFile of [file - 1, file + 1]) {
    if (inside(pawnFile, pawnRank) && state.board[squareOf(pawnFile, pawnRank)] === pieceOf(byColor, PAWN)) return true;
  }
  for (const [df, dr] of KNIGHT_STEPS) {
    const attackerFile = file + df;
    const attackerRank = rank + dr;
    if (inside(attackerFile, attackerRank) && state.board[squareOf(attackerFile, attackerRank)] === pieceOf(byColor, KNIGHT)) return true;
  }
  for (const [df, dr] of KING_STEPS) {
    const attackerFile = file + df;
    const attackerRank = rank + dr;
    if (inside(attackerFile, attackerRank) && state.board[squareOf(attackerFile, attackerRank)] === pieceOf(byColor, KING)) return true;
  }
  for (const [df, dr] of BISHOP_DIRECTIONS) {
    let attackerFile = file + df;
    let attackerRank = rank + dr;
    while (inside(attackerFile, attackerRank)) {
      const attacker = state.board[squareOf(attackerFile, attackerRank)];
      if (attacker) {
        if (colorOf(attacker) === byColor && (typeOf(attacker) === BISHOP || typeOf(attacker) === QUEEN)) return true;
        break;
      }
      attackerFile += df;
      attackerRank += dr;
    }
  }
  for (const [df, dr] of ROOK_DIRECTIONS) {
    let attackerFile = file + df;
    let attackerRank = rank + dr;
    while (inside(attackerFile, attackerRank)) {
      const attacker = state.board[squareOf(attackerFile, attackerRank)];
      if (attacker) {
        if (colorOf(attacker) === byColor && (typeOf(attacker) === ROOK || typeOf(attacker) === QUEEN)) return true;
        break;
      }
      attackerFile += df;
      attackerRank += dr;
    }
  }
  return false;
}

export function kingSquare(state, color) {
  const king = pieceOf(color, KING);
  return state.board.indexOf(king);
}

export function isInCheck(state, color = state.turn) {
  const king = kingSquare(state, color);
  return king < 0 || isSquareAttacked(state, king, color === WHITE ? BLACK : WHITE);
}

function isValidEnPassantCapture(state, from, to, color = state.turn) {
  if (state.ep !== to || state.board[to]) return false;
  const direction = color === WHITE ? 8 : -8;
  const expectedFromRank = color === WHITE ? 4 : 3;
  const expectedToRank = color === WHITE ? 5 : 2;
  if (typeOf(state.board[from]) !== PAWN || colorOf(state.board[from]) !== color
    || rankOf(from) !== expectedFromRank || rankOf(to) !== expectedToRank
    || Math.abs(fileOf(from) - fileOf(to)) !== 1 || to - from !== direction + (fileOf(to) - fileOf(from))) {
    return false;
  }
  const capturedSquare = to - direction;
  const enemy = color === WHITE ? BLACK : WHITE;
  return state.board[capturedSquare] === pieceOf(enemy, PAWN);
}

function isLegalEnPassantCapture(state, from, to) {
  const color = state.turn;
  if (!isValidEnPassantCapture(state, from, to, color)) return false;
  const board = state.board.slice();
  const direction = color === WHITE ? 8 : -8;
  const capturedSquare = to - direction;
  board[from] = 0;
  board[capturedSquare] = 0;
  board[to] = pieceOf(color, PAWN);
  const next = { ...state, board };
  const king = kingSquare(next, color);
  return king >= 0 && !isSquareAttacked(next, king, color === WHITE ? BLACK : WHITE);
}

export function effectiveEnPassantSquare(state) {
  if (state.ep < 0) return -1;
  const color = state.turn;
  const fromRank = color === WHITE ? 4 : 3;
  const targetFile = fileOf(state.ep);
  for (const fromFile of [targetFile - 1, targetFile + 1]) {
    if (!inside(fromFile, fromRank)) continue;
    const from = squareOf(fromFile, fromRank);
    if (isLegalEnPassantCapture(state, from, state.ep)) return state.ep;
  }
  return -1;
}

function castlingRightFor(color, side) {
  if (color === WHITE) return side === 'kingSide' ? CASTLE_WHITE_KING : CASTLE_WHITE_QUEEN;
  return side === 'kingSide' ? CASTLE_BLACK_KING : CASTLE_BLACK_QUEEN;
}

function chess960HomesForState(state) {
  const storedHomes = state.chess960Homes;
  if (storedHomes?.king && storedHomes?.rooks
    && Number.isInteger(storedHomes.king[WHITE]) && Number.isInteger(storedHomes.king[BLACK])
    && storedHomes.rooks[WHITE] && storedHomes.rooks[BLACK]
    && Number.isInteger(storedHomes.rooks[WHITE].queenSide)
    && Number.isInteger(storedHomes.rooks[WHITE].kingSide)
    && Number.isInteger(storedHomes.rooks[BLACK].queenSide)
    && Number.isInteger(storedHomes.rooks[BLACK].kingSide)) {
    return storedHomes;
  }

  const homes = { king: {}, rooks: {} };
  for (const color of [WHITE, BLACK]) {
    const rank = color === WHITE ? 0 : 7;
    const kingHome = state.board.findIndex((piece, square) => square >> 3 === rank && piece === pieceOf(color, KING));
    const rookHomes = state.board
      .map((piece, square) => (square >> 3 === rank && piece === pieceOf(color, ROOK) ? square : -1))
      .filter((square) => square >= 0)
      .sort((a, b) => a - b);
    if (kingHome < 0 || rookHomes.length !== 2
      || fileOf(rookHomes[0]) >= fileOf(kingHome) || fileOf(rookHomes[1]) <= fileOf(kingHome)) {
      return null;
    }
    homes.king[color] = kingHome;
    homes.rooks[color] = { queenSide: rookHomes[0], kingSide: rookHomes[1] };
  }
  return homes;
}

function chess960CastleSquares(state, color, side) {
  const homes = chess960HomesForState(state);
  if (!homes) return null;
  const kingHome = homes.king[color];
  const rookHome = homes.rooks[color][side];
  if (!Number.isInteger(kingHome) || !Number.isInteger(rookHome)) return null;
  const rank = color === WHITE ? 0 : 7;
  const kingDestination = squareOf(side === 'kingSide' ? 6 : 2, rank);
  const rookDestination = squareOf(side === 'kingSide' ? 5 : 3, rank);
  return {
    side,
    right: castlingRightFor(color, side),
    kingHome,
    rookHome,
    kingDestination,
    rookDestination,
  };
}

function rankPath(from, to) {
  const fromFile = fileOf(from);
  const toFile = fileOf(to);
  const step = Math.sign(toFile - fromFile);
  const squares = [];
  for (let file = fromFile; ; file += step) {
    squares.push(squareOf(file, rankOf(from)));
    if (file === toFile) break;
  }
  return squares;
}

function isChess960CastlePathClear(state, color, squares) {
  const king = pieceOf(color, KING);
  const rook = pieceOf(color, ROOK);
  for (const square of rankPath(squares.kingHome, squares.kingDestination)) {
    const piece = state.board[square];
    if (!piece || square === squares.kingHome || (square === squares.rookHome && piece === rook)) continue;
    return false;
  }
  for (const square of rankPath(squares.rookHome, squares.rookDestination)) {
    const piece = state.board[square];
    if (!piece || square === squares.rookHome || (square === squares.kingHome && piece === king)) continue;
    return false;
  }
  return state.board[squares.kingHome] === king && state.board[squares.rookHome] === rook;
}

function isChess960CastleSafe(state, color, squares) {
  const enemy = color === WHITE ? BLACK : WHITE;
  if (isSquareAttacked(state, squares.kingHome, enemy)) return false;

  for (const square of rankPath(squares.kingHome, squares.kingDestination).slice(1, -1)) {
    const board = state.board.slice();
    board[squares.kingHome] = 0;
    if (isSquareAttacked({ ...state, board }, square, enemy)) return false;
  }

  const finalBoard = state.board.slice();
  finalBoard[squares.kingHome] = 0;
  finalBoard[squares.rookHome] = 0;
  finalBoard[squares.rookDestination] = 0;
  finalBoard[squares.kingDestination] = pieceOf(color, KING);
  return !isSquareAttacked({ ...state, board: finalBoard }, squares.kingDestination, enemy);
}

function addChess960CastleMoves(state, moves, from, color) {
  for (const side of ['kingSide', 'queenSide']) {
    const squares = chess960CastleSquares(state, color, side);
    if (!squares || from !== squares.kingHome || !(state.castling & squares.right)) continue;
    if (!isChess960CastlePathClear(state, color, squares)) continue;
    if (isChess960CastleSafe(state, color, squares)) {
      moves.push(move(from, squares.kingDestination, MOVE_CASTLE));
    }
  }
}

function addCastleMoves(state, moves, from, color) {
  if (state.variant === 'chess960') {
    addChess960CastleMoves(state, moves, from, color);
    return;
  }
  const enemy = color === WHITE ? BLACK : WHITE;
  const rank = color === WHITE ? 0 : 7;
  const kingHome = squareOf(4, rank);
  if (from !== kingHome || isSquareAttacked(state, kingHome, enemy)) return;
  if (color === WHITE && state.castling & CASTLE_WHITE_KING) {
    if (!state.board[squareOf(5, rank)] && !state.board[squareOf(6, rank)] && state.board[squareOf(7, rank)] === pieceOf(WHITE, ROOK)
      && !isSquareAttacked(state, squareOf(5, rank), enemy) && !isSquareAttacked(state, squareOf(6, rank), enemy)) {
      moves.push(move(from, squareOf(6, rank), MOVE_CASTLE));
    }
  }
  if (color === WHITE && state.castling & CASTLE_WHITE_QUEEN) {
    if (!state.board[squareOf(1, rank)] && !state.board[squareOf(2, rank)] && !state.board[squareOf(3, rank)] && state.board[squareOf(0, rank)] === pieceOf(WHITE, ROOK)
      && !isSquareAttacked(state, squareOf(3, rank), enemy) && !isSquareAttacked(state, squareOf(2, rank), enemy)) {
      moves.push(move(from, squareOf(2, rank), MOVE_CASTLE));
    }
  }
  if (color === BLACK && state.castling & CASTLE_BLACK_KING) {
    if (!state.board[squareOf(5, rank)] && !state.board[squareOf(6, rank)] && state.board[squareOf(7, rank)] === pieceOf(BLACK, ROOK)
      && !isSquareAttacked(state, squareOf(5, rank), enemy) && !isSquareAttacked(state, squareOf(6, rank), enemy)) {
      moves.push(move(from, squareOf(6, rank), MOVE_CASTLE));
    }
  }
  if (color === BLACK && state.castling & CASTLE_BLACK_QUEEN) {
    if (!state.board[squareOf(1, rank)] && !state.board[squareOf(2, rank)] && !state.board[squareOf(3, rank)] && state.board[squareOf(0, rank)] === pieceOf(BLACK, ROOK)
      && !isSquareAttacked(state, squareOf(3, rank), enemy) && !isSquareAttacked(state, squareOf(2, rank), enemy)) {
      moves.push(move(from, squareOf(2, rank), MOVE_CASTLE));
    }
  }
}

export function generatePseudoMoves(state) {
  const moves = [];
  const color = state.turn;
  for (let from = 0; from < 64; from += 1) {
    const piece = state.board[from];
    if (!piece || colorOf(piece) !== color) continue;
    const type = typeOf(piece);
    const fromFile = fileOf(from);
    const fromRank = rankOf(from);
    if (type === PAWN) {
      const direction = color === WHITE ? 1 : -1;
      const startRank = color === WHITE ? 1 : 6;
      const promotionRank = color === WHITE ? 7 : 0;
      const oneRank = fromRank + direction;
      if (inside(fromFile, oneRank)) {
        const one = squareOf(fromFile, oneRank);
        if (!state.board[one]) {
          addPawnMove(moves, from, one, 0, color, promotionRank);
          const twoRank = fromRank + direction * 2;
          const two = squareOf(fromFile, twoRank);
          if (fromRank === startRank && !state.board[two]) moves.push(move(from, two, MOVE_DOUBLE_PAWN));
        }
        for (const captureFile of [fromFile - 1, fromFile + 1]) {
          if (!inside(captureFile, oneRank)) continue;
          const targetSquare = squareOf(captureFile, oneRank);
          const target = state.board[targetSquare];
          if (target && colorOf(target) !== color && typeOf(target) !== KING) {
            addPawnMove(moves, from, targetSquare, MOVE_CAPTURE, color, promotionRank);
          } else if (targetSquare === state.ep && isValidEnPassantCapture(state, from, targetSquare, color)) {
            moves.push(move(from, targetSquare, MOVE_CAPTURE | MOVE_EN_PASSANT));
          }
        }
      }
    } else if (type === KNIGHT) {
      for (const [df, dr] of KNIGHT_STEPS) {
        const file = fromFile + df;
        const rank = fromRank + dr;
        if (!inside(file, rank)) continue;
        const to = squareOf(file, rank);
        const target = state.board[to];
        if (!target || (colorOf(target) !== color && typeOf(target) !== KING)) moves.push(move(from, to, target ? MOVE_CAPTURE : 0));
      }
    } else if (type === BISHOP) {
      addSlidingMoves(state, moves, from, piece, BISHOP_DIRECTIONS);
    } else if (type === ROOK) {
      addSlidingMoves(state, moves, from, piece, ROOK_DIRECTIONS);
    } else if (type === QUEEN) {
      addSlidingMoves(state, moves, from, piece, [...BISHOP_DIRECTIONS, ...ROOK_DIRECTIONS]);
    } else if (type === KING) {
      for (const [df, dr] of KING_STEPS) {
        const file = fromFile + df;
        const rank = fromRank + dr;
        if (!inside(file, rank)) continue;
        const to = squareOf(file, rank);
        const target = state.board[to];
        if (!target || (colorOf(target) !== color && typeOf(target) !== KING)) moves.push(move(from, to, target ? MOVE_CAPTURE : 0));
      }
      addCastleMoves(state, moves, from, color);
    }
  }
  return moves;
}

function updateStandardCastlingRights(castling, from, to, movingPiece, capturedPiece) {
  const movingType = typeOf(movingPiece);
  if (movingType === KING) {
    castling &= colorOf(movingPiece) === WHITE
      ? ~(CASTLE_WHITE_KING | CASTLE_WHITE_QUEEN)
      : ~(CASTLE_BLACK_KING | CASTLE_BLACK_QUEEN);
  }
  if (from === squareOf(0, 0) || to === squareOf(0, 0)) castling &= ~CASTLE_WHITE_QUEEN;
  if (from === squareOf(7, 0) || to === squareOf(7, 0)) castling &= ~CASTLE_WHITE_KING;
  if (from === squareOf(0, 7) || to === squareOf(0, 7)) castling &= ~CASTLE_BLACK_QUEEN;
  if (from === squareOf(7, 7) || to === squareOf(7, 7)) castling &= ~CASTLE_BLACK_KING;
  if (capturedPiece && typeOf(capturedPiece) === ROOK) {
    if (colorOf(capturedPiece) === WHITE) {
      if (to === squareOf(0, 0)) castling &= ~CASTLE_WHITE_QUEEN;
      if (to === squareOf(7, 0)) castling &= ~CASTLE_WHITE_KING;
    } else {
      if (to === squareOf(0, 7)) castling &= ~CASTLE_BLACK_QUEEN;
      if (to === squareOf(7, 7)) castling &= ~CASTLE_BLACK_KING;
    }
  }
  return castling;
}

function updateChess960CastlingRights(state, from, to, movingPiece, capturedPiece) {
  let castling = state.castling;
  const movingColor = colorOf(movingPiece);
  const homes = chess960HomesForState(state);
  if (!homes || movingColor === null) return castling;

  if (typeOf(movingPiece) === KING) {
    castling &= movingColor === WHITE
      ? ~(CASTLE_WHITE_KING | CASTLE_WHITE_QUEEN)
      : ~(CASTLE_BLACK_KING | CASTLE_BLACK_QUEEN);
  }
  if (typeOf(movingPiece) === ROOK) {
    for (const side of ['kingSide', 'queenSide']) {
      if (from === homes.rooks[movingColor][side]) castling &= ~castlingRightFor(movingColor, side);
    }
  }
  if (capturedPiece && typeOf(capturedPiece) === ROOK) {
    const capturedColor = colorOf(capturedPiece);
    for (const side of ['kingSide', 'queenSide']) {
      if (to === homes.rooks[capturedColor][side]) castling &= ~castlingRightFor(capturedColor, side);
    }
  }
  return castling;
}

function updateCastlingRights(state, from, to, movingPiece, capturedPiece) {
  return state.variant === 'chess960'
    ? updateChess960CastlingRights(state, from, to, movingPiece, capturedPiece)
    : updateStandardCastlingRights(state.castling, from, to, movingPiece, capturedPiece);
}

function isChess960CastleAlias(state, candidate, from, to) {
  if (state.variant !== 'chess960' || !(candidate.flags & MOVE_CASTLE)) return false;
  for (const side of ['kingSide', 'queenSide']) {
    const squares = chess960CastleSquares(state, state.turn, side);
    if (squares && candidate.from === squares.kingHome && candidate.to === squares.kingDestination
      && from === squares.kingHome && to === squares.rookHome) return true;
  }
  return false;
}

export function applyMove(state, selectedMove, options = {}) {
  const moveToApply = selectedMove;
  const board = state.board.slice();
  const movingPiece = board[moveToApply.from];
  const movingColor = colorOf(movingPiece);
  let capturedPiece = board[moveToApply.to];
  const placedPiece = moveToApply.promotion ? pieceOf(movingColor, moveToApply.promotion) : movingPiece;
  const isChess960Castle = state.variant === 'chess960' && (moveToApply.flags & MOVE_CASTLE);
  const chess960Castle = isChess960Castle
    ? chess960CastleSquares(state, movingColor, fileOf(moveToApply.to) === 6 ? 'kingSide' : 'queenSide')
    : null;

  if (chess960Castle) {
    const rookPiece = board[chess960Castle.rookHome];
    capturedPiece = 0;
    board[chess960Castle.kingHome] = 0;
    board[chess960Castle.rookHome] = 0;
    board[chess960Castle.kingDestination] = placedPiece;
    board[chess960Castle.rookDestination] = rookPiece;
  } else {
    board[moveToApply.from] = 0;
    if (moveToApply.flags & MOVE_EN_PASSANT) {
      const capturedSquare = moveToApply.to + (movingColor === WHITE ? -8 : 8);
      capturedPiece = board[capturedSquare];
      board[capturedSquare] = 0;
    }
    board[moveToApply.to] = placedPiece;
    if (moveToApply.flags & MOVE_CASTLE) {
      const rank = rankOf(moveToApply.from);
      if (fileOf(moveToApply.to) === 6) {
        board[squareOf(5, rank)] = board[squareOf(7, rank)];
        board[squareOf(7, rank)] = 0;
      } else {
        board[squareOf(3, rank)] = board[squareOf(0, rank)];
        board[squareOf(0, rank)] = 0;
      }
    }
  }
  const next = {
    ...state,
    board,
    turn: state.turn === WHITE ? BLACK : WHITE,
    castling: updateCastlingRights(state, moveToApply.from, moveToApply.to, movingPiece, capturedPiece),
    ep: moveToApply.flags & MOVE_DOUBLE_PAWN
      ? (moveToApply.from + moveToApply.to) / 2
      : -1,
    halfmove: typeOf(movingPiece) === PAWN || capturedPiece ? 0 : state.halfmove + 1,
    fullmove: state.turn === BLACK ? state.fullmove + 1 : state.fullmove,
    lastMove: { ...moveToApply },
  };
  if (options.record) {
    const notation = formatMove(state, moveToApply, next);
    next.history = [...state.history, { ...moveToApply, notation }];
    next.positionCounts = new Map(state.positionCounts || []);
    const key = positionKey(next);
    next.positionCounts.set(key, (next.positionCounts.get(key) || 0) + 1);
  } else {
    next.history = state.history;
    next.positionCounts = state.positionCounts;
  }
  return next;
}

export function getLegalMoves(state) {
  const legal = [];
  const mover = state.turn;
  for (const candidate of generatePseudoMoves(state)) {
    const next = applyMove(state, candidate);
    if (!isInCheck(next, mover)) legal.push(candidate);
  }
  return legal;
}

export function findMove(state, from, to, promotion = 0) {
  const legalMoves = getLegalMoves(state);
  return legalMoves.find((candidate) => candidate.from === from && candidate.to === to
    && (!candidate.promotion || candidate.promotion === promotion || !promotion))
    || (promotion === 0 && legalMoves.find((candidate) => isChess960CastleAlias(state, candidate, from, to)));
}

export function moveToUci(moveToFormat) {
  const promotion = moveToFormat.promotion ? PIECE_LETTERS[moveToFormat.promotion].toLowerCase() : '';
  return `${squareName(moveToFormat.from)}${squareName(moveToFormat.to)}${promotion}`;
}

export function uciToMove(state, uci) {
  if (!uci || uci.length < 4) return null;
  const from = parseSquare(uci.slice(0, 2));
  const to = parseSquare(uci.slice(2, 4));
  const promotionLetter = uci[4]?.toLowerCase();
  const promotion = { q: QUEEN, r: ROOK, b: BISHOP, n: KNIGHT }[promotionLetter] || 0;
  const legalMoves = getLegalMoves(state);
  return legalMoves.find((candidate) => candidate.from === from && candidate.to === to && candidate.promotion === promotion)
    || legalMoves.find((candidate) => promotion === 0 && isChess960CastleAlias(state, candidate, from, to))
    || null;
}

export function positionKey(state) {
  // FIDE repetition identity includes en-passant only when that capture is legal.
  // effectiveEnPassantSquare performs the king-safety check directly so key
  // construction never calls the public move generator recursively.
  let variantKey = '';
  if (state.variant === 'chess960') {
    const homes = chess960HomesForState(state);
    const homeKey = homes
      ? `${homes.king[WHITE]},${homes.king[BLACK]}|${homes.rooks[WHITE].queenSide},${homes.rooks[WHITE].kingSide}|${homes.rooks[BLACK].queenSide},${homes.rooks[BLACK].kingSide}`
      : '';
    variantKey = `|chess960|${homeKey}`;
  }
  return `${state.board.join(',')}|${state.turn}|${state.castling}|${effectiveEnPassantSquare(state)}${variantKey}`;
}

export function hasInsufficientMaterial(state) {
  const nonKings = [];
  for (const piece of state.board) {
    if (piece && typeOf(piece) !== KING) nonKings.push(piece);
  }
  if (nonKings.length === 0) return true;
  if (nonKings.length === 1 && [BISHOP, KNIGHT].includes(typeOf(nonKings[0]))) return true;
  if (nonKings.every((piece) => typeOf(piece) === BISHOP)) {
    const squareColors = [];
    for (let square = 0; square < 64; square += 1) {
      if (state.board[square] && typeOf(state.board[square]) === BISHOP) squareColors.push((fileOf(square) + rankOf(square)) % 2);
    }
    if (squareColors.every((color) => color === squareColors[0])) return true;
  }
  return false;
}

function canPossiblyMate(state, color) {
  const attackingPieces = [];
  const defendingPieces = [];
  for (let square = 0; square < 64; square += 1) {
    const piece = state.board[square];
    if (!piece || typeOf(piece) === KING) continue;
    (colorOf(piece) === color ? attackingPieces : defendingPieces).push({ piece, square });
  }

  // A bare king cannot ever give checkmate. If the full position is a known
  // dead position, the timeout is also a draw. Other cases remain deliberately
  // conservative because the flagging rule asks whether mate is possible.
  if (!attackingPieces.length || hasInsufficientMaterial(state)) return false;
  if (defendingPieces.length === 0) {
    if (attackingPieces.length === 1 && [BISHOP, KNIGHT].includes(typeOf(attackingPieces[0].piece))) return false;
    if (attackingPieces.every(({ piece }) => typeOf(piece) === BISHOP)) {
      const squareColors = attackingPieces.map(({ square }) => (fileOf(square) + rankOf(square)) % 2);
      if (squareColors.every((squareColor) => squareColor === squareColors[0])) return false;
    }
  }
  return true;
}

function normalizeColor(color) {
  if (color === WHITE || color === 'white' || color === 'w') return WHITE;
  if (color === BLACK || color === 'black' || color === 'b') return BLACK;
  return null;
}

export function timeoutResult(state, loserColor) {
  const loser = normalizeColor(loserColor);
  if (loser === null) throw new Error('timeoutResult needs a white or black loser color.');
  const winner = loser === WHITE ? BLACK : WHITE;
  if (!canPossiblyMate(state, winner)) {
    return { phase: 'draw', winner: null, drawReason: 'timeout with insufficient mating material' };
  }
  return { phase: 'timeout', winner, drawReason: null };
}

export function getGameStatus(state) {
  const legalMoves = getLegalMoves(state);
  const inCheck = isInCheck(state, state.turn);
  if (legalMoves.length === 0) {
    if (inCheck) {
      return {
        phase: 'checkmate',
        legalMoves,
        inCheck,
        winner: state.turn === WHITE ? BLACK : WHITE,
        drawReason: null,
        claimableDraws: [],
      };
    }
    return {
      phase: 'draw',
      legalMoves,
      inCheck: false,
      winner: null,
      drawReason: 'stalemate',
      claimableDraws: [],
    };
  }
  const repetitionCount = state.positionCounts?.get(positionKey(state)) || 1;
  const claimableDraws = [];
  if (repetitionCount >= 3) claimableDraws.push('threefold repetition');
  if (state.halfmove >= 100) claimableDraws.push('fifty-move rule');
  if (hasInsufficientMaterial(state)) {
    return {
      phase: 'draw',
      legalMoves,
      inCheck,
      winner: null,
      drawReason: 'insufficient material',
      claimableDraws,
    };
  }
  if (repetitionCount >= 5) {
    return {
      phase: 'draw',
      legalMoves,
      inCheck,
      winner: null,
      drawReason: 'fivefold repetition',
      claimableDraws,
    };
  }
  if (state.halfmove >= 150) {
    return {
      phase: 'draw',
      legalMoves,
      inCheck,
      winner: null,
      drawReason: 'seventy-five-move rule',
      claimableDraws,
    };
  }
  return { phase: 'playing', legalMoves, inCheck, winner: null, drawReason: null, claimableDraws };
}

export function formatMove(state, moveToFormat, resultingState = null) {
  const movingPiece = state.board[moveToFormat.from];
  const type = typeOf(movingPiece);
  let notation = '';
  if (moveToFormat.flags & MOVE_CASTLE) {
    notation = fileOf(moveToFormat.to) === 6 ? 'O-O' : 'O-O-O';
  } else {
    const capture = Boolean(moveToFormat.flags & MOVE_CAPTURE);
    notation += PIECE_LETTERS[type];
    if (type === PAWN && capture) notation += FILES[fileOf(moveToFormat.from)];
    if (type !== PAWN) {
      const alternatives = getLegalMoves(state).filter((candidate) => candidate.to === moveToFormat.to
        && candidate.from !== moveToFormat.from && typeOf(state.board[candidate.from]) === type);
      if (alternatives.length) {
        const sameFile = alternatives.some((candidate) => fileOf(candidate.from) === fileOf(moveToFormat.from));
        const sameRank = alternatives.some((candidate) => rankOf(candidate.from) === rankOf(moveToFormat.from));
        notation += sameFile && sameRank ? squareName(moveToFormat.from) : sameFile ? String(rankOf(moveToFormat.from) + 1) : FILES[fileOf(moveToFormat.from)];
      }
    }
    if (capture) notation += 'x';
    notation += squareName(moveToFormat.to);
    if (moveToFormat.promotion) notation += `=${PIECE_LETTERS[moveToFormat.promotion]}`;
  }
  if (resultingState) {
    const result = getGameStatus(resultingState);
    if (result.phase === 'checkmate') notation += '#';
    else if (result.inCheck) notation += '+';
  }
  return notation;
}

export function perft(state, depth) {
  if (depth === 0) return 1;
  let nodes = 0;
  for (const nextMove of getLegalMoves(state)) {
    nodes += perft(applyMove(state, nextMove), depth - 1);
  }
  return nodes;
}
