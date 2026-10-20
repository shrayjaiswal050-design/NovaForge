import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthStore } from './auth.js';
import {
  calculateEloChange,
  normalizeSpeed,
  ratingKey,
  timeControlCategory,
  updateElo,
} from './rating.js';

test('maps supported time controls to independent speed categories', () => {
  assert.equal(normalizeSpeed(' BULLET '), 'bullet');
  assert.equal(timeControlCategory('1+0'), 'bullet');
  assert.equal(timeControlCategory('2+1'), 'bullet');
  assert.equal(timeControlCategory('3+2'), 'blitz');
  assert.equal(timeControlCategory('5+3'), 'blitz');
  assert.equal(timeControlCategory('10+0'), 'rapid');
  assert.equal(timeControlCategory('15+10'), 'rapid');
  assert.equal(timeControlCategory({ initialMs: 60_000, incrementMs: 0 }), 'bullet');
  assert.equal(ratingKey('standard', 'bullet'), 'standard:bullet');
  assert.notEqual(ratingKey('standard', 'bullet'), ratingKey('chess960', 'bullet'));
});

test('uses the requested K factor for bullet, blitz, and rapid', () => {
  assert.equal(calculateEloChange(1200, 1200, 'win', 'bullet'), 20);
  assert.equal(calculateEloChange(1200, 1200, 'win', 'blitz'), 16);
  assert.equal(calculateEloChange(1200, 1200, 'win', 'rapid'), 12);
  assert.equal(calculateEloChange(1200, 1200, 'draw', 'bullet'), 0);
  assert.equal(calculateEloChange(1200, 1200, 'draw', 'blitz'), 0);
  assert.equal(calculateEloChange(1200, 1200, 'draw', 'rapid'), 0);
  assert.equal(updateElo(1200, 1200, 'win', 'rapid'), 1212);
});

test('keeps speed pools independent within each variant', () => {
  const store = new AuthStore();

  const bullet = store.recordGameResult('alice', 'bob', 'white', 'standard', '1+0');
  assert.deepEqual(bullet.before, { white: 1200, black: 1200 });
  assert.deepEqual(bullet.after, { white: 1220, black: 1180 });
  assert.equal(bullet.variant, 'standard');
  assert.equal(bullet.speed, 'bullet');
  assert.equal(bullet.category, 'bullet');

  assert.equal(store.getRating('alice', 'standard', '1+0'), 1220);
  assert.equal(store.getRating('bob', 'standard', '1+0'), 1180);
  assert.equal(store.getRating('alice', 'standard', '3+2'), 1200);
  assert.equal(store.getRating('bob', 'standard', '10+0'), 1200);

  const blitz = store.recordGameResult('alice', 'bob', 'white', 'standard', '5+3');
  assert.deepEqual(blitz.after, { white: 1216, black: 1184 });
  assert.equal(store.getRating('alice', 'standard', '1+0'), 1220);
  assert.equal(store.getRating('alice', 'standard', '5+3'), 1216);

  const rapid = store.recordGameResult('alice', 'bob', 'white', 'standard', '15+10');
  assert.deepEqual(rapid.after, { white: 1212, black: 1188 });
  assert.equal(store.getRating('alice', 'standard', '5+3'), 1216);
  assert.equal(store.getRating('alice', 'standard', '15+10'), 1212);
});

test('keeps standard and chess960 pools independent', () => {
  const store = new AuthStore();
  store.recordGameResult('alice', 'bob', 'white', 'standard', '1+0');

  const chess960 = store.recordGameResult('alice', 'bob', 'white', 'chess960', '1+0');
  assert.deepEqual(chess960.before, { white: 1200, black: 1200 });
  assert.deepEqual(chess960.after, { white: 1220, black: 1180 });
  assert.equal(store.getRating('alice', 'standard', '1+0'), 1220);
  assert.equal(store.getRating('alice', 'chess960', '1+0'), 1220);
  assert.equal(store.getRating('alice', 'chess960', '5+3'), 1200);
  assert.equal(chess960.ratingKey, 'chess960:bullet');
});

test('draws preserve equal ratings and include category metadata', () => {
  const store = new AuthStore();
  const result = store.recordGameResult('alice', 'bob', null, {
    variant: 'chess960',
    speed: 'rapid',
  });

  assert.deepEqual(result.before, { white: 1200, black: 1200 });
  assert.deepEqual(result.after, { white: 1200, black: 1200 });
  assert.equal(result.variant, 'chess960');
  assert.equal(result.speed, 'rapid');
  assert.equal(result.ratingKey, 'chess960:rapid');
});

test('legacy calls default to standard blitz ratings', () => {
  const store = new AuthStore();
  assert.equal(store.getRating('legacy'), 1200);

  const result = store.recordGameResult('legacy', 'opponent', 'white');
  assert.equal(result.white, 1216);
  assert.equal(result.black, 1184);
  assert.deepEqual(result.before, { white: 1200, black: 1200 });
  assert.equal(result.variant, 'standard');
  assert.equal(result.speed, 'blitz');
  assert.equal(result.ratingKey, 'standard:blitz');
  assert.equal(store.getRating('legacy'), 1216);
  assert.equal(store.getRating('legacy', 'standard', '5+3'), 1216);
});
