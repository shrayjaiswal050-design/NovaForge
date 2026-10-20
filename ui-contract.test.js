import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const index = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');

test('the active game has premove controls without a lobby escape link', () => {
  assert.doesNotMatch(index, /id=["']back-to-lobby["']/);
  assert.match(index, /id=["']premove-status["']/);
  assert.match(index, /id=["']clear-premoves["']/);
});

test('NovaForge strength must be chosen explicitly before an AI game starts', () => {
  assert.match(index, /id=["']lobby-difficulty["'][^>]*required/);
  assert.match(index, /<option value="" selected disabled>Choose a strength before playing<\/option>/);
  assert.match(index, /id=["']difficulty-select["']/);
  assert.match(app, /selectedMode === 'ai' && !selectedDifficulty/);
  assert.match(app, /Choose a NovaForge strength before opening the game board/);
});
