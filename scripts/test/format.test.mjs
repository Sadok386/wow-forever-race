import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateTime, fullName, num, ordinal, relTime } from '../../site/assets/format.js';

const NOW = Date.parse('2026-11-10T18:00:00Z');
const ago = (seconds) => new Date(NOW - seconds * 1000).toISOString();

test('relTime', () => {
  assert.equal(relTime(ago(5), NOW), 'à l’instant');
  assert.equal(relTime(ago(-30), NOW), 'à l’instant');
  assert.equal(relTime(ago(4 * 60 + 20), NOW), 'il y a 4 min');
  assert.equal(relTime(ago(59 * 60), NOW), 'il y a 59 min');
  assert.equal(relTime(ago(2 * 3600 + 100), NOW), 'il y a 2 h');
  assert.equal(relTime(ago(3 * 86400 + 100), NOW), 'il y a 3 j');
  assert.equal(relTime('nope', NOW), '');
  assert.equal(relTime(null, NOW), '');
});

test('dateTime uses the local time zone', () => {
  assert.equal(dateTime(new Date(2026, 10, 10, 18, 7).toISOString()), '10 nov. à 18:07');
  assert.equal(dateTime(new Date(2026, 0, 3, 4, 5).toISOString()), '3 janv. à 04:05');
  assert.equal(dateTime(new Date(2026, 7, 21, 0, 0).toISOString()), '21 août à 00:00');
  assert.equal(dateTime('nope'), '');
});

test('num groups thousands with a narrow no-break space', () => {
  assert.equal(num(18450), '18 450');
  assert.equal(num(999), '999');
  assert.equal(num(1234567), '1 234 567');
  assert.equal(num(0), '0');
  assert.equal(num(null), '—');
  assert.equal(num(undefined), '—');
});

test('ordinal', () => {
  assert.equal(ordinal(1), '1er');
  assert.equal(ordinal(2), '2e');
  assert.equal(ordinal(11), '11e');
});

test('fullName tolerates missing parts', () => {
  assert.equal(fullName({ name: 'Joe', surname: 'Gun' }), 'Joe Gun');
  assert.equal(fullName({ name: 'Joe' }), 'Joe');
});
