import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RATING,
  calculateEloChange,
  expectedScore,
  normalizeResult,
  updateElo,
} from './rating.js';

test('calculates expected scores from the standard Elo curve', () => {
  assert.equal(DEFAULT_RATING, 1200);
  assert.equal(expectedScore(1200, 1200), 0.5);
  assert.ok(expectedScore(1400, 1200) > 0.5);
  assert.ok(Math.abs(expectedScore(1200, 1400) - (1 - expectedScore(1400, 1200))) < 1e-12);
});

test('normalizes equivalent win, draw, and loss results deterministically', () => {
  assert.equal(normalizeResult('WIN'), 1);
  assert.equal(normalizeResult('1-0'), 1);
  assert.equal(normalizeResult('draw'), 0.5);
  assert.equal(normalizeResult('1/2-1/2'), 0.5);
  assert.equal(normalizeResult('loss'), 0);
  assert.equal(normalizeResult('0-1'), 0);
  assert.equal(normalizeResult({ winner: 'white' }), 1);
  assert.equal(normalizeResult({ winner: null }), 0.5);
  assert.throws(() => normalizeResult('unfinished'), /win, draw, or loss/);
});

test('applies standard K=32 updates from the first player perspective', () => {
  assert.equal(calculateEloChange(1200, 1200, 'win'), 16);
  assert.equal(calculateEloChange(1200, 1200, 'draw'), 0);
  assert.equal(calculateEloChange(1200, 1200, 'loss'), -16);
  assert.equal(updateElo(1200, 1200, 'win'), 1216);
  assert.equal(updateElo(1200, 1200, 'draw'), 1200);
  assert.equal(updateElo(1200, 1200, 'loss'), 1184);
  assert.throws(() => updateElo(Number.NaN, 1200, 'win'), /finite number/);
});
