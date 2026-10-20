import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BISHOP,
  BLACK,
  CASTLE_WHITE_KING,
  CASTLE_WHITE_QUEEN,
  KING,
  KNIGHT,
  MOVE_CASTLE,
  QUEEN,
  ROOK,
  WHITE,
  applyMove,
  createChess960State,
  createInitialState,
  createStateForVariant,
  fileOf,
  getLegalMoves,
  moveToUci,
  positionKey,
  uciToMove,
} from './chess.js';

function prepareWhiteCastling(state) {
  const board = new Array(64).fill(0);
  board[state.chess960Homes.king[WHITE]] = KING;
  board[state.chess960Homes.rooks[WHITE].queenSide] = ROOK;
  board[state.chess960Homes.rooks[WHITE].kingSide] = ROOK;
  board[56] = -KING;
  return {
    ...state,
    board,
    turn: WHITE,
    castling: CASTLE_WHITE_KING | CASTLE_WHITE_QUEEN,
    history: [],
    positionCounts: new Map([[positionKey(state), 1]]),
  };
}

function backRank(state) {
  return state.board.slice(0, 8);
}

test('generates deterministic valid Chess960 starting positions', () => {
  const first = createChess960State(518);
  const second = createChess960State(518);
  assert.deepEqual(backRank(first), backRank(second));
  assert.equal(first.variant, 'chess960');
  assert.equal(first.chess960Seed, 518);

  const positions = new Set();
  for (let seed = 0; seed < 960; seed += 1) {
    const state = createChess960State(seed);
    const rank = backRank(state);
    const bishops = rank.map((piece, file) => (piece === BISHOP ? file : -1)).filter((file) => file >= 0);
    const kingFile = rank.indexOf(KING);
    const rookFiles = rank.map((piece, file) => (piece === ROOK ? file : -1)).filter((file) => file >= 0);

    assert.equal(rank.filter((piece) => piece === BISHOP).length, 2);
    assert.equal(rank.filter((piece) => piece === KNIGHT).length, 2);
    assert.equal(rank.filter((piece) => piece === QUEEN).length, 1);
    assert.equal(rookFiles.length, 2);
    assert.equal((bishops[0] + bishops[1]) % 2, 1, `bishops share a color for seed ${seed}`);
    assert.ok(rookFiles[0] < kingFile && kingFile < rookFiles[1], `king is not between rooks for seed ${seed}`);
    positions.add(rank.join(','));
  }
  assert.equal(positions.size, 960);
});

test('selects the standard and Chess960 variant factories', () => {
  assert.equal(createStateForVariant({ variant: 'chess960', chess960Seed: 3 }).variant, 'chess960');
  assert.equal(createStateForVariant({ variant: 'chess960', chess960Seed: 3 }).chess960Seed, 3);
  assert.equal(createStateForVariant({ variant: 'standard' }).variant, undefined);
  assert.deepEqual(backRank(createChess960State(518)), backRank(createInitialState()));
  assert.throws(() => createStateForVariant({ variant: 'atomic' }), /Unsupported chess variant/);
});

test('casts with nonstandard homes and handles king-rook swaps', () => {
  const state = prepareWhiteCastling(createChess960State(3));
  assert.equal(fileOf(state.chess960Homes.king[WHITE]), 5);
  assert.equal(fileOf(state.chess960Homes.rooks[WHITE].queenSide), 4);
  assert.equal(fileOf(state.chess960Homes.rooks[WHITE].kingSide), 6);

  const castle = uciToMove(state, 'f1g1');
  assert.ok(castle);
  assert.equal(castle.flags & MOVE_CASTLE, MOVE_CASTLE);
  const castled = applyMove(state, castle, { record: true });
  assert.equal(castled.board[6], KING, 'king reaches g1');
  assert.equal(castled.board[5], ROOK, 'rook reaches f1');
  assert.equal(castled.board[state.chess960Homes.king[WHITE]], ROOK, 'rook may occupy the king home square');
  assert.equal(castled.board[state.chess960Homes.rooks[WHITE].kingSide], KING, 'king may occupy the rook home square');
  assert.equal(castled.board[6], KING, 'king and rook do not overwrite each other');
  assert.equal(castled.castling & (CASTLE_WHITE_KING | CASTLE_WHITE_QUEEN), 0);
  assert.equal(castled.history[0].notation, 'O-O');
});

test('keeps both sides of the Chess960 path clear and checks attacked king squares', () => {
  const state = prepareWhiteCastling(createChess960State(15));
  const castleMoves = getLegalMoves(state).filter((candidate) => candidate.flags & MOVE_CASTLE);
  assert.deepEqual(castleMoves.map(moveToUci).sort(), ['e1c1', 'e1g1']);

  const blocked = { ...state, board: state.board.slice() };
  blocked.board[2] = BISHOP;
  assert.equal(uciToMove(blocked, 'e1c1'), null, 'a piece on the king destination blocks castling');

  const attacked = { ...state, board: state.board.slice() };
  attacked.board[5 + 2 * 8] = -ROOK;
  assert.equal(uciToMove(attacked, 'e1g1'), null, 'the king cannot cross an attacked square');

  const destinationAttacked = { ...state, board: state.board.slice() };
  destinationAttacked.board[6 + 2 * 8] = -ROOK;
  assert.equal(uciToMove(destinationAttacked, 'e1g1'), null, 'the king cannot land on an attacked square');
});

test('removes Chess960 rights when a home rook moves or is captured', () => {
  const state = prepareWhiteCastling(createChess960State(15));
  const movedRook = uciToMove(state, 'd1d2');
  assert.ok(movedRook);
  const afterRookMove = applyMove(state, movedRook);
  assert.equal(afterRookMove.castling & CASTLE_WHITE_QUEEN, 0);
  assert.equal(afterRookMove.castling & CASTLE_WHITE_KING, CASTLE_WHITE_KING);

  const capturePosition = {
    ...state,
    board: state.board.slice(),
    turn: BLACK,
    castling: CASTLE_WHITE_KING | CASTLE_WHITE_QUEEN,
  };
  capturePosition.board[3 + 2 * 8] = -ROOK;
  const capture = uciToMove(capturePosition, 'd3d1');
  assert.ok(capture);
  const afterCapture = applyMove(capturePosition, capture);
  assert.equal(afterCapture.castling & CASTLE_WHITE_QUEEN, 0);
});
