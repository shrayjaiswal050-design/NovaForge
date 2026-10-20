import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BLACK,
  WHITE,
  createInitialState,
  parseSquare,
} from './chess.js';
import { previewPremoveState, resolvePremove } from './premove.js';

function pieceAt(state, square) {
  return state.board[parseSquare(square)];
}

test('previews an unlimited same-side premove line without changing live history', () => {
  const state = createInitialState();
  const queue = [{ uci: 'e2e4' }, { uci: 'g1f3' }, { uci: 'f3g5' }];
  const preview = previewPremoveState(state, queue, WHITE);

  assert.equal(preview.turn, WHITE);
  assert.equal(pieceAt(preview, 'e4') > 0, true);
  assert.equal(pieceAt(preview, 'g5') > 0, true);
  assert.equal(preview.history.length, 0);
  assert.equal(state.turn, WHITE);
  assert.equal(pieceAt(state, 'e2') > 0, true);
});

test('resolves a legal premove and discards a stale line safely', () => {
  const state = createInitialState();
  const legal = resolvePremove(state, [{ uci: 'e2e4' }, { uci: 'g1f3' }]);
  assert.equal(legal.stale, false);
  assert.ok(legal.move);
  assert.deepEqual(legal.queue, [{ uci: 'g1f3' }]);

  const stale = resolvePremove(state, [{ uci: 'e2e5' }, { uci: 'g1f3' }]);
  assert.equal(stale.stale, true);
  assert.deepEqual(stale.queue, []);
});

test('supports black premove previews', () => {
  const state = createInitialState();
  const preview = previewPremoveState(state, [{ uci: 'e7e5' }], BLACK);
  assert.equal(preview.turn, BLACK);
  assert.equal(pieceAt(preview, 'e5') < 0, true);
});
