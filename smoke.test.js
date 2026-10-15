import assert from 'node:assert/strict';
import {
  BLACK,
  BISHOP,
  KING,
  KNIGHT,
  PAWN,
  QUEEN,
  ROOK,
  WHITE,
  applyMove,
  createInitialState,
  effectiveEnPassantSquare,
  formatMove,
  getGameStatus,
  getLegalMoves,
  hasInsufficientMaterial,
  moveToUci,
  perft,
  positionKey,
  parseSquare,
  stateFromFEN,
  timeoutResult,
  toFEN,
  uciToMove,
} from './chess.js';
import { searchBestMove } from './engine.js';

function play(state, ...moves) {
  let current = state;
  for (const uci of moves) {
    const move = uciToMove(current, uci);
    assert.ok(move, `expected legal move ${uci}`);
    current = applyMove(current, move, { record: true });
  }
  return current;
}

function pieceAt(state, square) {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  return state.board[rank * 8 + file];
}

const initial = createInitialState();
assert.equal(perft(initial, 1), 20, 'initial perft depth 1');
assert.equal(perft(initial, 2), 400, 'initial perft depth 2');
assert.equal(perft(initial, 3), 8902, 'initial perft depth 3');
assert.equal(perft(initial, 4), 197281, 'initial perft depth 4');

const kiwipete = stateFromFEN('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
assert.equal(perft(kiwipete, 1), 48, 'kiwipete perft depth 1');
assert.equal(perft(kiwipete, 2), 2039, 'kiwipete perft depth 2');
assert.equal(perft(kiwipete, 3), 97862, 'kiwipete perft depth 3');

const perftPositionThree = stateFromFEN('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1');
assert.equal(perft(perftPositionThree, 1), 14, 'perft position three depth 1');
assert.equal(perft(perftPositionThree, 2), 191, 'perft position three depth 2');
assert.equal(perft(perftPositionThree, 3), 2812, 'perft position three depth 3');

const opening = play(createInitialState(), 'e2e4');
assert.equal(toFEN(opening), 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1', 'FEN round trip after e4');
assert.equal(opening.history[0].notation, 'e4');

const strictRoundTrip = 'r3k2r/ppp2ppp/2n5/3pp3/8/2N2N2/PPP2PPP/R3K2R w KQkq - 4 12';
assert.equal(toFEN(stateFromFEN(strictRoundTrip)), strictRoundTrip, 'strict FEN round trip');
for (const invalidFen of [
  '4k3/8/8/8/8/8/8/4K3 w - - 0',
  '4k3/8/8/8/8/8/8/4K3 x - - 0 1',
  '4k3/8/8/8/8/8/8/4K3 w KK - 0 1',
  '4k3/8/8/8/8/8/8/4K3 w qK - 0 1',
  '4k3/8/8/8/8/8/8/4K3 w - - -1 1',
  '4k3/8/8/8/8/8/8/4K3 w - - 0 0',
  '4k3/8/8/8/8/8/8/4K3 w K - 0 1',
  '4k3/8/8/8/8/8/8/4k3 w - - 0 1',
  '8/8/8/8/8/8/4k3/4K3 w - - 0 1',
  '8/8/8/8/8/8/8/P3K2k w - - 0 1',
  '4k3/8/8/8/8/8/4R3/4K3 w - - 0 1',
  '4k3/8/8/8/4P3/8/8/4K3 b - e3 1 1',
  '4k3/8/8/8/8/8/8/4K3 b - e3 0 1',
]) {
  assert.throws(() => stateFromFEN(invalidFen), `rejects invalid FEN: ${invalidFen}`);
}

const sideToMoveInCheck = stateFromFEN('4k3/8/8/8/8/8/4r3/4K3 w - - 0 1');
assert.equal(getGameStatus(sideToMoveInCheck).inCheck, true, 'a legal FEN may have the side to move in check');

const foolsMate = play(createInitialState(), 'f2f3', 'e7e5', 'g2g4', 'd8h4');
const mateStatus = getGameStatus(foolsMate);
assert.equal(mateStatus.phase, 'checkmate');
assert.equal(mateStatus.winner, BLACK);
assert.equal(mateStatus.legalMoves.length, 0);
assert.deepEqual(foolsMate.history.map(({ notation }) => notation), ['f3', 'e5', 'g4', 'Qh4#']);

const stalemate = stateFromFEN('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
assert.equal(getGameStatus(stalemate).drawReason, 'stalemate');

const castle = stateFromFEN('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
assert.ok(uciToMove(castle, 'e1g1'), 'white kingside castle is legal');
assert.ok(uciToMove(castle, 'e1c1'), 'white queenside castle is legal');
const castled = play(castle, 'e1g1');
assert.equal(pieceAt(castled, 'g1'), KING);
assert.equal(pieceAt(castled, 'f1'), ROOK);
assert.equal(castled.castling & 3, 0);
assert.equal(castled.history[0].notation, 'O-O');

const castlingThroughAttack = stateFromFEN('4k3/8/8/8/8/5r2/8/4K2R w K - 0 1');
assert.equal(uciToMove(castlingThroughAttack, 'e1g1'), null, 'castling cannot cross an attacked square');
const castlingWithoutRight = stateFromFEN('4k3/8/8/8/8/8/8/4K2R w - - 0 1');
assert.equal(uciToMove(castlingWithoutRight, 'e1g1'), null, 'a rook alone does not preserve castling rights');

const enPassant = stateFromFEN('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
const enPassantResult = play(enPassant, 'e5d6');
assert.equal(pieceAt(enPassantResult, 'd6'), PAWN);
assert.equal(pieceAt(enPassantResult, 'd5'), 0);
assert.equal(enPassantResult.history[0].notation, 'exd6');
assert.equal(effectiveEnPassantSquare(enPassant), parseSquare('d6'));
assert.notEqual(positionKey(enPassant), positionKey(stateFromFEN('4k3/8/8/3pP3/8/8/8/4K3 w - - 0 1')));

const epWithoutCapturer = stateFromFEN('4k3/8/8/8/4P3/8/8/4K3 b - e3 0 1');
const samePositionWithoutEp = stateFromFEN('4k3/8/8/8/4P3/8/8/4K3 b - - 0 1');
assert.equal(effectiveEnPassantSquare(epWithoutCapturer), -1, 'unusable FEN en-passant is not repetition identity');
assert.equal(positionKey(epWithoutCapturer), positionKey(samePositionWithoutEp));

const pinnedEp = stateFromFEN('k3r3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
assert.equal(uciToMove(pinnedEp, 'e5d6'), null, 'a pinned en-passant capture is illegal');
assert.equal(effectiveEnPassantSquare(pinnedEp), -1, 'a pinned en-passant is not repetition identity');
assert.equal(positionKey(pinnedEp), positionKey(stateFromFEN('k3r3/8/8/3pP3/8/8/8/4K3 w - - 0 1')));
const malformedEpState = {
  ...stateFromFEN('4k3/8/8/4P3/8/8/8/4K3 w - - 0 1'),
  ep: parseSquare('d6'),
};
assert.equal(uciToMove(malformedEpState, 'e5d6'), null, 'en-passant needs an enemy pawn on the captured square');

const promotion = stateFromFEN('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
const promotionMoves = getLegalMoves(promotion).filter((move) => moveToUci(move).startsWith('a7a8'));
assert.equal(promotionMoves.length, 4, 'all four promotions are generated');
assert.ok(promotionMoves.some((move) => move.promotion === QUEEN));

const promotionMate = stateFromFEN('7k/P7/6K1/8/8/8/8/8 w - - 0 1');
const promotionMateMove = uciToMove(promotionMate, 'a7a8q');
assert.ok(promotionMateMove, 'queen promotion is legal');
const promotedMate = applyMove(promotionMate, promotionMateMove, { record: true });
assert.equal(promotedMate.history[0].notation, 'a8=Q#');

const disambiguation = stateFromFEN('4k3/8/8/8/8/2N1N3/8/4K3 w - - 0 1');
const disambiguatingMove = uciToMove(disambiguation, 'c3d5');
assert.equal(formatMove(disambiguation, disambiguatingMove), 'Ncd5');

const deadPosition = stateFromFEN('8/8/8/8/8/8/2N5/K1k5 w - - 0 1');
assert.equal(getGameStatus(deadPosition).drawReason, 'insufficient material');
assert.equal(hasInsufficientMaterial(deadPosition), true);
assert.equal(timeoutResult(deadPosition, WHITE).phase, 'draw', 'flag fall is drawn when the opponent cannot mate');
const matingMaterial = stateFromFEN('4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
assert.deepEqual(timeoutResult(matingMaterial, 'black'), { phase: 'timeout', winner: WHITE, drawReason: null });

const cycle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
const threefold = play(createInitialState(), ...cycle, ...cycle);
assert.ok(getGameStatus(threefold).claimableDraws.includes('threefold repetition'));
const fivefold = play(createInitialState(), ...cycle, ...cycle, ...cycle, ...cycle);
assert.equal(getGameStatus(fivefold).drawReason, 'fivefold repetition');
const fiftyMove = stateFromFEN('4k3/8/8/8/8/8/8/R3K3 w - - 100 1');
assert.ok(getGameStatus(fiftyMove).claimableDraws.includes('fifty-move rule'));
const seventyFiveMove = stateFromFEN('4k3/8/8/8/8/8/8/R3K3 w - - 150 1');
assert.equal(getGameStatus(seventyFiveMove).drawReason, 'seventy-five-move rule');
assert.equal(getGameStatus({ ...foolsMate, halfmove: 150 }).phase, 'checkmate', 'mate takes precedence over automatic move-count draws');

const engineResult = searchBestMove(createInitialState(), { timeMs: 180, maxDepth: 3 });
assert.ok(engineResult.move, 'engine returns a move');
assert.ok(uciToMove(createInitialState(), moveToUci(engineResult.move)), 'engine move is legal');

console.log('Nova Chess smoke tests passed.');
