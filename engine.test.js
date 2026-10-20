import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMove,
  createInitialState,
  getGameStatus,
  moveToUci,
  stateFromFEN,
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

test('finds a mate in one and reports a mate score', () => {
  const state = stateFromFEN('7k/5Q2/6K1/8/8/8/8/8 w - - 0 1');
  const result = searchBestMove(state, { timeMs: 700, maxDepth: 1 });

  assert.ok(result.move, 'mate search returns a move');
  assert.equal(result.score.mate, 1);
  assert.ok(result.pv.length >= 1);
  const next = applyMove(state, result.move);
  assert.equal(getGameStatus(next).phase, 'checkmate');
  for (const variationSeed of [1, 2, 3]) {
    const seeded = searchBestMove(state, { timeMs: 700, maxDepth: 1, variationSeed });
    assert.equal(seeded.score.mate, 1);
    assert.equal(getGameStatus(applyMove(state, seeded.move)).phase, 'checkmate');
  }
});

test('varies equivalent root choices by seed while keeping each seed deterministic', () => {
  const state = play(createInitialState(), 'e2e4', 'e7e5');
  const limits = { nodes: 1_500, maxDepth: 3, infinite: true, variationMargin: 18 };
  const first = searchBestMove(state, { ...limits, variationSeed: 1 });
  const repeat = searchBestMove(state, { ...limits, variationSeed: 1 });
  const choices = new Set();
  for (let seed = 1; seed <= 12; seed += 1) {
    const result = searchBestMove(state, { ...limits, variationSeed: seed });
    assert.ok(result.move, 'seeded search returns a move');
    assert.ok(uciToMove(state, moveToUci(result.move)), 'seeded move is legal');
    choices.add(moveToUci(result.move));
  }
  assert.equal(moveToUci(first.move), moveToUci(repeat.move));
  assert.deepEqual(first.pv, repeat.pv);
  assert.ok(choices.size >= 2, `expected seeded variety, got ${[...choices].join(', ')}`);
});

test('zero variation margin preserves the strongest root score', () => {
  const state = play(createInitialState(), 'e2e4', 'e7e5');
  const limits = {
    infinite: true,
    nodes: 2_500,
    maxDepth: 3,
    variationSeed: 9,
  };
  const strongest = searchBestMove(state, { ...limits, variationMargin: 0 });
  const varied = searchBestMove(state, { ...limits, variationMargin: 18 });
  const numericScore = (score) => typeof score?.mate === 'number'
    ? Math.sign(score.mate) * (32_000 - Math.abs(score.mate))
    : score?.cp ?? 0;

  assert.ok(strongest.move);
  assert.ok(varied.move);
  assert.ok(
    numericScore(strongest.score) >= numericScore(varied.score),
    `zero-margin score ${numericScore(strongest.score)} should not trail varied score ${numericScore(varied.score)}`,
  );
});

test('searches legal check evasions instead of standing pat', () => {
  const state = stateFromFEN('4k3/8/8/8/8/8/4r3/4K3 w - - 0 1');
  const result = searchBestMove(state, { timeMs: 180, maxDepth: 3 });

  assert.ok(result.move, 'checked side receives a move');
  assert.equal(moveToUci(result.move), 'e1e2');
  assert.equal(getGameStatus(applyMove(state, result.move)).inCheck, false);
});

test('honours repetition history and keeps a completed PV on timeout', () => {
  const repeated = play(
    createInitialState(),
    'g1f3', 'g8f6', 'f3g1', 'f6g8',
    'g1f3', 'g8f6', 'f3g1', 'f6g8',
  );
  const info = [];
  const result = searchBestMove(repeated, { timeMs: 70, maxDepth: 12 }, (entry) => info.push(entry));

  assert.equal(repeated.positionCounts.get([...repeated.positionCounts.keys()][0]), 3);
  assert.ok(result.move, 'repetition search still returns a legal move');
  assert.ok(result.pv.length >= 1);
  assert.equal(result.depth, info.length ? info[info.length - 1].depth : 0);
  if (info.length) assert.deepEqual(result.pv, info[info.length - 1].pv);
});

test('returns a draw score for an automatic repetition draw at the root', () => {
  const state = stateFromFEN('4k3/8/8/8/8/8/R7/4K3 w - - 0 1');
  const key = [...state.positionCounts.keys()][0];
  state.positionCounts.set(key, 5);
  const result = searchBestMove(state, { timeMs: 100, maxDepth: 6 });

  assert.equal(result.move, null);
  assert.deepEqual(result.score, { cp: 0 });
  assert.equal(result.depth, 0);
});

test('small time budgets stop without an unbounded search overrun', () => {
  const started = performance.now();
  const result = searchBestMove(createInitialState(), { timeMs: 25, maxDepth: 32 });
  const wallMs = performance.now() - started;

  assert.ok(result.move);
  assert.ok(result.elapsedMs < 100, `engine elapsed ${result.elapsedMs}ms`);
  assert.ok(wallMs < 150, `engine wall time ${wallMs}ms`);
  assert.ok(result.depth <= 32);
});
