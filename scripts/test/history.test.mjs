import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendPoint,
  dropSeries,
  emptyHistory,
  lastPoint,
  parseHistory,
  pruneToRoster,
  serializeHistory,
} from '../lib/history.mjs';

test('emptyHistory', () => {
  assert.deepEqual(emptyHistory(), { schema: 1, series: {} });
});

test('parseHistory tolerates empty, invalid and misshapen input', () => {
  assert.deepEqual(parseHistory(''), { history: emptyHistory(), warning: null });
  assert.deepEqual(parseHistory(undefined).history, emptyHistory());
  for (const bad of ['{nope', 'null', '[]', '{"schema":2,"series":{}}', '{"schema":1}', '{"schema":1,"series":[]}']) {
    const { history, warning } = parseHistory(bad);
    assert.deepEqual(history, emptyHistory(), bad);
    assert.equal(typeof warning, 'string', bad);
  }
});

test('parseHistory keeps valid points, sorts them, drops garbage', () => {
  const text = JSON.stringify({
    schema: 1,
    series: {
      a: [[20, 5, 10], [10, 4, null], [30, 'x', 1], 'junk', [40, 6]],
      b: 'nope',
      c: [],
    },
  });
  const { history, warning } = parseHistory(text);
  assert.deepEqual(history.series, { a: [[10, 4, null], [20, 5, 10]] });
  assert.match(warning, /invalide/);
});

test('parseHistory has no warning for a clean file', () => {
  const h = emptyHistory();
  appendPoint(h, 'eu:a-b', 100, 10, 5);
  assert.deepEqual(parseHistory(serializeHistory(h)), { history: h, warning: null });
});

test('appendPoint records the first observation and only changes after that', () => {
  const h = emptyHistory();
  assert.equal(lastPoint(h, 'x'), null);
  assert.equal(appendPoint(h, 'x', 100, 10, 50), true);
  assert.equal(appendPoint(h, 'x', 200, 10, 50), false, 'same level and xp');
  assert.equal(appendPoint(h, 'x', 300, 10, 80), true, 'xp changed');
  assert.equal(appendPoint(h, 'x', 400, 11, 80), true, 'level changed');
  assert.deepEqual(h.series.x, [[100, 10, 50], [300, 10, 80], [400, 11, 80]]);
  assert.deepEqual(lastPoint(h, 'x'), [400, 11, 80]);
});

test('appendPoint treats undefined xp as null (roster source)', () => {
  const h = emptyHistory();
  assert.equal(appendPoint(h, 'r', 1, 8, undefined), true);
  assert.equal(appendPoint(h, 'r', 2, 8, null), false);
  assert.equal(appendPoint(h, 'r', 3, 8, 0), true, 'null -> 0 is a change');
  assert.deepEqual(h.series.r, [[1, 8, null], [3, 8, 0]]);
});

test('series are independent per id', () => {
  const h = emptyHistory();
  appendPoint(h, 'a', 1, 10, 0);
  assert.equal(appendPoint(h, 'b', 1, 10, 0), true);
});

test('dropSeries and pruneToRoster', () => {
  const h = emptyHistory();
  for (const id of ['a', 'b', 'c']) appendPoint(h, id, 1, 10, 0);
  dropSeries(h, 'a');
  dropSeries(h, 'unknown');
  assert.deepEqual(Object.keys(h.series), ['b', 'c']);
  pruneToRoster(h, new Set(['c', 'd']));
  assert.deepEqual(Object.keys(h.series), ['c']);
  pruneToRoster(h, ['x']);
  assert.deepEqual(h.series, {});
});

test('serializeHistory is 2-space JSON with a trailing newline and schema first', () => {
  const h = emptyHistory();
  appendPoint(h, 'a', 1, 10, null);
  const text = serializeHistory(h);
  assert.ok(text.endsWith('}\n'));
  assert.ok(text.startsWith('{\n  "schema": 1,\n  "series": {'));
  assert.deepEqual(JSON.parse(text), h);
});
