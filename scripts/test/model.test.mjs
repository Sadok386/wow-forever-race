import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFeed, chartSeries, fractionalLevel, levelsGained, rankPlayers, trackRatio, xpNeeded, xpPercent,
} from '../../site/assets/model.js';

const player = (name, extra = {}) => ({ id: `eu:${name.toLowerCase()}-x`, name, surname: 'X', level: 10, xp: 0, ...extra });
const names = (list) => list.map((p) => p.name);
const rank = (players, goal = 60) => names(rankPlayers(players, goal).ranked);

test('rankPlayers puts players without level in waiting, in roster order', () => {
  const { ranked, waiting } = rankPlayers([player('Zed', { level: null }), player('Amy'), player('Bob', { level: null })], 60);
  assert.deepEqual(names(ranked), ['Amy']);
  assert.deepEqual(names(waiting), ['Zed', 'Bob']);
});

test('rankPlayers orders by level, then xp (null last), then levelAt (null last), then name', () => {
  assert.deepEqual(rank([player('A', { level: 20 }), player('B', { level: 30 })]), ['B', 'A']);
  assert.deepEqual(
    rank([player('A', { xp: 100 }), player('B', { xp: 900 }), player('C', { xp: null })]),
    ['B', 'A', 'C'],
  );
  assert.deepEqual(
    rank([
      player('A', { levelAt: null }),
      player('B', { levelAt: '2026-11-10T12:00:00Z' }),
      player('C', { levelAt: '2026-11-10T10:00:00Z' }),
    ]),
    ['C', 'B', 'A'],
  );
  assert.deepEqual(rank([player('Émile'), player('Zoé'), player('Eve')]), ['Émile', 'Eve', 'Zoé']);
});

test('rankPlayers puts finishers first, by arrival time, unknown arrival last', () => {
  const players = [
    player('Slow', { level: 59 }),
    player('Late', { level: 60, goalAt: '2026-11-12T20:00:00Z' }),
    player('Unknown', { level: 60, goalAt: null }),
    player('First', { level: 60, goalAt: '2026-11-12T10:00:00Z' }),
  ];
  assert.deepEqual(rank(players), ['First', 'Late', 'Unknown', 'Slow']);
});

test('rankPlayers honours a goal below 60', () => {
  const players = [player('A', { level: 41 }), player('B', { level: 40, goalAt: '2026-11-11T00:00:00Z' })];
  assert.deepEqual(rank(players, 40), ['B', 'A']);
});

test('rankPlayers does not mutate its input', () => {
  const input = [player('B', { level: 12 }), player('A', { level: 30 })];
  rankPlayers(input, 60);
  assert.deepEqual(names(input), ['B', 'A']);
});

const table = [400, 900, 1400];

test('xpNeeded reads the table by level', () => {
  assert.equal(xpNeeded(2, table), 900);
  assert.equal(xpNeeded(4, table), null);
  assert.equal(xpNeeded(2, null), null);
  assert.equal(xpNeeded(null, table), null);
});

test('fractionalLevel adds the xp share, clamped below the next level', () => {
  assert.equal(fractionalLevel(2, 450, table, 60), 2.5);
  assert.equal(fractionalLevel(2, 5000, table, 60), 2.999);
  assert.equal(fractionalLevel(2, -5, table, 60), 2);
});

test('fractionalLevel falls back to the level, or the goal, or null', () => {
  assert.equal(fractionalLevel(2, null, table, 60), 2);
  assert.equal(fractionalLevel(2, 100, null, 60), 2);
  assert.equal(fractionalLevel(30, 100, table, 60), 30);
  assert.equal(fractionalLevel(60, 0, table, 60), 60);
  assert.equal(fractionalLevel(70, 0, table, 60), 60);
  assert.equal(fractionalLevel(null, 0, table, 60), null);
});

test('trackRatio maps level 1..goal to 0..1 and clamps', () => {
  assert.equal(trackRatio(1, 60), 0);
  assert.equal(trackRatio(60, 60), 1);
  assert.equal(trackRatio(30.5, 60), 0.5);
  assert.equal(trackRatio(0, 60), 0);
  assert.equal(trackRatio(99, 60), 1);
  assert.equal(trackRatio(null, 60), 0);
});

test('levelsGained compares with the level at or just before the window start', () => {
  const points = [[100, 10, 0], [200, 12, 0], [300, 15, 0]];
  assert.equal(levelsGained(points, 250), 3);
  assert.equal(levelsGained(points, 200), 3);
  assert.equal(levelsGained(points, 150), 5);
  assert.equal(levelsGained(points, 400), 0);
});

test('levelsGained uses the first observation when the window starts before it, and 0 when unknown', () => {
  assert.equal(levelsGained([[100, 10, 0], [200, 12, 0]], 0), 2);
  assert.equal(levelsGained([], 0), 0);
  assert.equal(levelsGained(undefined, 0), 0);
  assert.equal(levelsGained([[100, 10, 0], [200, 10, 5]], 0), 0);
});

test('buildFeed lists each observed increase, newest first, with a limit', () => {
  const players = [player('A'), player('B')];
  const history = {
    series: {
      'eu:a-x': [[100, 10, 0], [200, 11, 0], [300, 11, 50], [400, 14, 0]],
      'eu:b-x': [[150, 20, 0], [250, 21, 0]],
      'eu:gone-x': [[100, 1, 0], [900, 5, 0]],
    },
  };
  assert.deepEqual(buildFeed(players, history), [
    { id: 'eu:a-x', t: 400, from: 11, to: 14 },
    { id: 'eu:b-x', t: 250, from: 20, to: 21 },
    { id: 'eu:a-x', t: 200, from: 10, to: 11 },
  ]);
  assert.equal(buildFeed(players, history, 2).length, 2);
});

test('buildFeed tolerates missing history', () => {
  assert.deepEqual(buildFeed([player('A')], null), []);
  assert.deepEqual(buildFeed([player('A')], { series: {} }), []);
});

test('chartSeries converts points to fractional levels for ranked players only', () => {
  const players = [player('A', { level: 3 }), player('B', { level: null }), player('C', { level: 12 })];
  const history = { series: { 'eu:a-x': [[100, 2, 450], [200, 3, null]], 'eu:b-x': [[100, 1, 0]] } };
  const out = chartSeries(players, history, table, 60);
  assert.deepEqual(out['eu:a-x'], [[100, 2.5], [200, 3]]);
  assert.deepEqual(out['eu:c-x'], []);
  assert.equal('eu:b-x' in out, false);
});

test('xpPercent is an integer share, or null when unknown', () => {
  assert.equal(xpPercent({ level: 2, xp: 450 }, table), 50);
  assert.equal(xpPercent({ level: 2, xp: 899 }, table), 99);
  assert.equal(xpPercent({ level: 2, xp: null }, table), null);
  assert.equal(xpPercent({ level: 2, xp: 10 }, null), null);
  assert.equal(xpPercent({ level: 50, xp: 10 }, table), null);
});
