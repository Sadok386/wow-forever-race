import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateKey, keyCandidates, parseFragmentKey, settleKeys,
} from '../../site/assets/crypto.js';
import { isFailedRun, isSyncResolved, safeRunUrl } from '../../site/assets/github.js';

const A = generateKey();
const B = generateKey();
const N = generateKey();

test('parseFragmentKey: usable key, empty key, no key, other params kept', () => {
  assert.deepEqual(parseFragmentKey(`#k=${A}`), { present: true, key: A, rest: '' });
  assert.deepEqual(parseFragmentKey(`#p=eu%3Aa-b&k=${A}`), { present: true, key: A, rest: 'p=eu%3Aa-b' });
  assert.deepEqual(parseFragmentKey('#k='), { present: true, key: null, rest: '' });
  assert.deepEqual(parseFragmentKey('#k=abc'), { present: true, key: null, rest: '' });
  assert.deepEqual(parseFragmentKey('#setup'), { present: false, key: null, rest: 'setup=' });
  assert.deepEqual(parseFragmentKey(''), { present: false, key: null, rest: '' });
});

test('keyCandidates: next first, then the link, then the stored key, without duplicates', () => {
  assert.deepEqual(keyCandidates({ nextKey: N, urlKey: B, storedKey: A }), [N, B, A]);
  assert.deepEqual(keyCandidates({ nextKey: null, urlKey: A, storedKey: A }), [A]);
  assert.deepEqual(keyCandidates({ nextKey: null, urlKey: null, storedKey: null }), []);
});

test('settleKeys: a key that decrypts becomes the stored key', () => {
  assert.deepEqual(settleKeys({ stored: B, next: null, ok: B, failed: [] }), { stored: B, next: null });
  assert.deepEqual(settleKeys({ stored: A, next: null, ok: B, failed: [] }), { stored: B, next: null });
});

test('settleKeys: a wrong key from the link never removes a different stored key', () => {
  // The link key B was stored first, the previous key A decrypted: A is restored.
  assert.deepEqual(settleKeys({ stored: B, next: null, ok: A, failed: [B] }), { stored: A, next: null });
  // A key that is not the stored one fails (typed in the dialog): storage is untouched.
  assert.deepEqual(settleKeys({ stored: A, next: null, ok: null, failed: [B] }), { stored: A, next: null });
});

test('settleKeys: the stored key is forgotten only when that same key failed', () => {
  assert.deepEqual(settleKeys({ stored: A, next: null, ok: null, failed: [A] }), { stored: null, next: null });
  assert.deepEqual(settleKeys({ stored: A, next: null, ok: null, failed: [] }), { stored: A, next: null });
});

test('settleKeys: renewal keeps the old key and promotes the next key once it decrypts', () => {
  // edit.json not redeployed yet: the next key fails, the old one works, nothing is forgotten.
  assert.deepEqual(settleKeys({ stored: A, next: N, ok: A, failed: [N] }), { stored: A, next: N });
  // Only the next key exists and it does not decrypt yet: it is kept.
  assert.deepEqual(settleKeys({ stored: null, next: N, ok: null, failed: [N] }), { stored: null, next: N });
  // The new edit.json is live.
  assert.deepEqual(settleKeys({ stored: A, next: N, ok: N, failed: [] }), { stored: N, next: null });
});

test('safeRunUrl: https on github.com only', () => {
  assert.equal(safeRunUrl('https://github.com/o/r/actions/runs/12'), 'https://github.com/o/r/actions/runs/12');
  for (const bad of ['http://github.com/o', 'https://evil.example/login', 'https://github.com.evil.example/x',
    'https://api.github.com/x', 'javascript:alert(1)', '#', '', null, undefined, 42]) {
    assert.equal(safeRunUrl(bad), null, String(bad));
  }
});

test('isFailedRun: failure, timed_out and startup_failure only once completed', () => {
  for (const conclusion of ['failure', 'timed_out', 'startup_failure']) {
    assert.equal(isFailedRun({ status: 'completed', conclusion }), true);
  }
  assert.equal(isFailedRun({ status: 'completed', conclusion: 'success' }), false);
  assert.equal(isFailedRun({ status: 'completed', conclusion: 'cancelled' }), false);
  assert.equal(isFailedRun({ status: 'in_progress', conclusion: null }), false);
  assert.equal(isFailedRun(null), false);
});

test('isSyncResolved: newer data, or the run seen succeeding even when the local clock is ahead', () => {
  const at = Date.parse('2026-11-10T18:10:00Z'); // visitor clock, 5 minutes ahead of the server
  assert.equal(isSyncResolved({ at }, '2026-11-10T18:05:00Z'), false);
  assert.equal(isSyncResolved({ at }, '2026-11-10T18:10:00Z'), false);
  assert.equal(isSyncResolved({ at, runSucceeded: true }, '2026-11-10T18:05:00Z'), true);
  assert.equal(isSyncResolved({ at }, '2026-11-10T18:10:01Z'), true);
});
