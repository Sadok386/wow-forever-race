// Encryption of the GitHub token shared through the edit link. Web Crypto only, so that the same
// module runs in the browser and in Node tests. The key never leaves the browser: it travels in the
// URL fragment, which is not sent to any server.

const KEY_BYTES = 32;
const IV_BYTES = 12;
const KEY_LENGTH = 43; // base64url of 32 bytes, without padding
// Binds the ciphertext to this application and format version.
const AAD = new TextEncoder().encode('wow-forever-tracker/v1');
const B64URL = /^[A-Za-z0-9_-]*$/;

export function b64urlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(text) {
  if (typeof text !== 'string' || !B64URL.test(text) || text.length % 4 === 1) {
    throw new TypeError('Invalid base64url text');
  }
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '='));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function generateKey() {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(KEY_BYTES)));
}

function importKey(key, usage) {
  const raw = b64urlDecode(key);
  if (raw.length !== KEY_BYTES) throw new TypeError('Invalid key length');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [usage]);
}

export async function encryptToken(key, token) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plain = new TextEncoder().encode(JSON.stringify({ v: 1, t: token }));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: AAD },
    await importKey(key, 'encrypt'),
    plain,
  );
  return { iv: b64urlEncode(iv), ct: b64urlEncode(new Uint8Array(cipher)) };
}

export async function decryptToken(key, { iv, ct }) {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64urlDecode(iv), additionalData: AAD },
    await importKey(key, 'decrypt'),
    b64urlDecode(ct),
  );
  const payload = JSON.parse(new TextDecoder().decode(plain));
  if (payload?.v !== 1 || typeof payload.t !== 'string' || !payload.t) throw new Error('Unexpected payload');
  return payload.t;
}

/** Accepts a bare key or any text containing "#k=<key>" (a pasted link); null when there is none. */
export function extractKey(text) {
  const s = String(text ?? '').trim();
  if (s.length === KEY_LENGTH && B64URL.test(s)) return s;
  const match = /[#&]k=([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/.exec(s);
  return match ? match[1] : null;
}

/* ---------- key bookkeeping: pure decisions, the caller does the storage and network work ---------- */

/** Reads "k" out of a URL fragment: whether it was there, the usable key (or null) and the fragment without it. */
export function parseFragmentKey(hash) {
  const params = new URLSearchParams(String(hash ?? '').replace(/^#/, ''));
  const present = params.has('k');
  const key = present ? extractKey(`#k=${params.get('k')}`) : null;
  params.delete('k');
  return { present, key, rest: params.toString() };
}

/** Keys to try against edit.json, best first: the pending renewal key, the link's key, then the previously stored one. */
export function keyCandidates({ nextKey, urlKey, storedKey }) {
  return [...new Set([nextKey, urlKey, storedKey].filter(Boolean))];
}

/**
 * New values of the two stored keys once edit.json was fetched and the candidates tried.
 * `ok` is the key that decrypted it (or null); `failed` are the keys that did not.
 * A stored key is forgotten only when that very key failed; a pending "next" key is never forgotten
 * by a failure, because edit.json may simply not be redeployed yet.
 */
export function settleKeys({ stored, next, ok, failed }) {
  if (ok) return { stored: ok, next: next === ok ? null : next };
  return { stored: stored && failed.includes(stored) ? null : stored, next };
}
