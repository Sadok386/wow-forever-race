import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  b64urlDecode, b64urlEncode, decryptToken, encryptToken, extractKey, generateKey,
} from '../../site/assets/crypto.js';

// Deliberately not shaped like a real GitHub token, so that no secret scanner flags the repository.
const TOKEN = 'jeton-factice-pour-les-tests_0123456789abcdefghijklmnopqrstuvwxyz';

test('generateKey returns 43 base64url characters and never repeats', () => {
  const a = generateKey();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, generateKey());
});

test('b64url round trip, without padding, for every length', () => {
  for (let length = 0; length < 40; length++) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 250) % 256);
    const text = b64urlEncode(bytes);
    assert.match(text, /^[A-Za-z0-9_-]*$/);
    assert.deepEqual(b64urlDecode(text), bytes);
  }
});

test('b64urlDecode rejects foreign characters and impossible lengths', () => {
  assert.throws(() => b64urlDecode('ab+c'));
  assert.throws(() => b64urlDecode('abc='));
  assert.throws(() => b64urlDecode('a'));
  assert.throws(() => b64urlDecode(null));
});

test('encrypt then decrypt returns the token; iv is 16 chars and ct has the size the roster command accepts', async () => {
  const key = generateKey();
  const { iv, ct } = await encryptToken(key, TOKEN);
  assert.equal(iv.length, 16);
  assert.ok(ct.length >= 40 && ct.length <= 4000);
  assert.equal(await decryptToken(key, { iv, ct }), TOKEN);
});

test('two encryptions of the same token differ (random iv)', async () => {
  const key = generateKey();
  const a = await encryptToken(key, TOKEN);
  const b = await encryptToken(key, TOKEN);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ct, b.ct);
});

test('a non-ASCII token survives the round trip', async () => {
  const key = generateKey();
  assert.equal(await decryptToken(key, await encryptToken(key, 'jéton-☃')), 'jéton-☃');
});

test('a wrong key is rejected', async () => {
  const sealed = await encryptToken(generateKey(), TOKEN);
  await assert.rejects(decryptToken(generateKey(), sealed));
});

test('tampered ciphertext or iv is rejected', async () => {
  const key = generateKey();
  const { iv, ct } = await encryptToken(key, TOKEN);
  const bytes = b64urlDecode(ct);
  bytes[0] ^= 1;
  await assert.rejects(decryptToken(key, { iv, ct: b64urlEncode(bytes) }));
  const ivBytes = b64urlDecode(iv);
  ivBytes[0] ^= 1;
  await assert.rejects(decryptToken(key, { iv: b64urlEncode(ivBytes), ct }));
  await assert.rejects(decryptToken(key, { iv, ct: ct.slice(0, -4) }));
});

test('ciphertext is bound to the application context (additional data)', async () => {
  const key = generateKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey('raw', b64urlDecode(key), 'AES-GCM', false, ['encrypt']);
  const plain = new TextEncoder().encode(JSON.stringify({ v: 1, t: TOKEN }));
  const foreign = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, plain);
  await assert.rejects(decryptToken(key, { iv: b64urlEncode(iv), ct: b64urlEncode(new Uint8Array(foreign)) }));
});

test('a key of the wrong length is rejected on both sides', async () => {
  await assert.rejects(encryptToken('abc', TOKEN));
  await assert.rejects(decryptToken('abc', { iv: 'AAAAAAAAAAAAAAAA', ct: 'AAAA' }));
});

test('extractKey accepts a raw key, a full link and a fragment', () => {
  const key = generateKey();
  assert.equal(extractKey(key), key);
  assert.equal(extractKey(`  ${key}\n`), key);
  assert.equal(extractKey(`https://user.github.io/repo/#k=${key}`), key);
  assert.equal(extractKey(`Voici le lien : https://user.github.io/repo/#k=${key} merci`), key);
  assert.equal(extractKey(`#p=eu%3Ajoe-gun&k=${key}`), key);
});

test('extractKey returns null for anything else', () => {
  const key = generateKey();
  assert.equal(extractKey(''), null);
  assert.equal(extractKey(null), null);
  assert.equal(extractKey('hello'), null);
  assert.equal(extractKey(key.slice(1)), null);
  assert.equal(extractKey(`${key}x`), null);
  assert.equal(extractKey(`https://example.org/#k=${key}x`), null);
  assert.equal(extractKey('https://example.org/#k=short'), null);
});
