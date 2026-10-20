import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isStaticDemoMode } from './static-mode.js';

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

test('static demo mode detects Pages hosts and the explicit query flag without opening network access', () => {
  assert.equal(isStaticDemoMode({ hostname: 'nova-chess.github.io', search: '' }), true);
  assert.equal(isStaticDemoMode({ hostname: 'NOVA-CHESS.GITHUB.IO', search: '' }), true);
  assert.equal(isStaticDemoMode({ hostname: 'localhost', search: '?static=1' }), true);
  assert.equal(isStaticDemoMode({ hostname: 'localhost', search: '?static=0' }), false);
  assert.equal(isStaticDemoMode({ hostname: 'localhost', search: '' }), false);
  assert.match(index, /id=["']static-demo-notice["']/);
  assert.match(app, /if \(STATIC_DEMO_MODE\) \{\s*throw new ApiError/);
  assert.match(app, /function connectOnline\(\) \{\s*if \(STATIC_DEMO_MODE\) return false;/);
  assert.match(app, /if \(!STATIC_DEMO_MODE\) void loadCurrentAccount\(\);/);
});
