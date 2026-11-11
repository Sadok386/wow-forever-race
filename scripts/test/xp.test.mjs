import test from 'node:test';
import assert from 'node:assert/strict';
import { CLASSIC_XP_TO_NEXT, isXpSetting, isXpTableConsistent, resolveXpTable, xpNeeded } from '../lib/xp.mjs';

test('built-in table has 59 values summing to 4,084,700', () => {
  assert.equal(CLASSIC_XP_TO_NEXT.length, 59);
  assert.equal(CLASSIC_XP_TO_NEXT.reduce((a, b) => a + b, 0), 4084700);
});

test('resolveXpTable', () => {
  assert.equal(resolveXpTable(undefined), CLASSIC_XP_TO_NEXT);
  assert.equal(resolveXpTable(true), CLASSIC_XP_TO_NEXT);
  assert.equal(resolveXpTable(false), null);
  assert.equal(resolveXpTable(null), null);
  const custom = [100, 200];
  assert.equal(resolveXpTable(custom), custom);
  for (const bad of ['yes', 5, {}, [], [1, 0], [1, -2], [1, 'a'], [1, NaN], [1, Infinity]]) {
    assert.equal(resolveXpTable(bad), CLASSIC_XP_TO_NEXT, JSON.stringify(bad));
  }
});

test('isXpSetting tells callers when to warn', () => {
  for (const ok of [undefined, null, true, false, [1, 2]]) assert.equal(isXpSetting(ok), true);
  for (const bad of ['yes', 5, {}, [], [1, 0], [1, 'a']]) assert.equal(isXpSetting(bad), false);
});

test('xpNeeded', () => {
  assert.equal(xpNeeded(CLASSIC_XP_TO_NEXT, 1), 400);
  assert.equal(xpNeeded(CLASSIC_XP_TO_NEXT, 59), 209800);
  assert.equal(xpNeeded(CLASSIC_XP_TO_NEXT, 60), null);
  assert.equal(xpNeeded(CLASSIC_XP_TO_NEXT, 0), null);
  assert.equal(xpNeeded(CLASSIC_XP_TO_NEXT, null), null);
  assert.equal(xpNeeded(null, 5), null);
});

test('isXpTableConsistent', () => {
  const t = CLASSIC_XP_TO_NEXT;
  assert.equal(isXpTableConsistent(t, []), true);
  assert.equal(isXpTableConsistent(t, [{ level: 27, xp: 18450 }, { level: 10, xp: 0 }]), true);
  assert.equal(isXpTableConsistent(t, [{ level: 27, xp: 38900 }]), false, 'xp equal to the need is impossible');
  assert.equal(isXpTableConsistent(t, [{ level: 10, xp: 5 }, { level: 1, xp: 999 }]), false);
  assert.equal(isXpTableConsistent(t, [{ level: null, xp: null }, { level: 30, xp: null }]), true, 'unknown values prove nothing');
  assert.equal(isXpTableConsistent(t, [{ level: 60, xp: 0 }]), true, 'level beyond the table');
  assert.equal(isXpTableConsistent(null, [{ level: 1, xp: 99999 }]), true, 'disabled table cannot be inconsistent');
});
