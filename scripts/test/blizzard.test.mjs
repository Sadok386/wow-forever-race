import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  BlizzardAuthError,
  BlizzardClient,
  LOCALES,
  characterPath,
  profileNamespace,
  staticNamespace,
} from '../lib/blizzard.mjs';
import { createMockBlizzard } from '../lib/mock-blizzard.mjs';
import { normalizeProfile } from '../lib/normalize.mjs';

const servers = [];
after(() => Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve)))));

async function listen(handler) {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

/** The mock behind a real HTTP server, under a prefix, counting token requests. */
async function startMock(options) {
  const mock = createMockBlizzard(options);
  const seen = { tokens: 0, urls: [] };
  const origin = await listen(async (req, res) => {
    seen.urls.push(req.url);
    if (req.method === 'POST' && req.url.endsWith('/oauth/token')) seen.tokens++;
    if (!(await mock.handle(req, res, '/mock'))) res.writeHead(500).end();
  });
  return { origin, seen };
}

function clientFor(origin, extra = {}) {
  const sleeps = [];
  const client = new BlizzardClient({
    clientId: 'id',
    clientSecret: 'secret',
    oauthUrl: `${origin}/mock/oauth/token`,
    apiTemplate: `${origin}/mock/{region}`,
    sleep: async (ms) => void sleeps.push(ms),
    ...extra,
  });
  return { client, sleeps };
}

const ns = profileNamespace('eu');

test('namespaces, locales and character path', () => {
  assert.equal(profileNamespace('kr'), 'profile-forever-kr');
  assert.equal(staticNamespace('us'), 'static-forever-us');
  assert.deepEqual(LOCALES, { eu: 'fr_FR', us: 'en_US', kr: 'ko_KR', tw: 'zh_TW' });
  assert.equal(characterPath('aldric-ventor'), '/profile/wow/character/aldric-ventor');
  assert.equal(characterPath('léa-bella', '/equipment'), '/profile/wow/character/l%C3%A9a-bella/equipment');
});

test('the token is fetched once, even for concurrent requests', async () => {
  const { origin, seen } = await startMock();
  const { client } = clientFor(origin);
  const results = await Promise.all(['aldric-ventor', 'brakk-cendrepoing', 'mira-solene'].map((s) => client.get('eu', characterPath(s), ns)));
  await client.get('eu', characterPath('aldric-ventor', '/equipment'), ns);
  assert.deepEqual(results.map((r) => r.status), [200, 200, 200]);
  assert.equal(seen.tokens, 1);
  assert.equal(client.requestCount, 5);
});

test('a profile fetched through the client normalises', async () => {
  const { origin } = await startMock();
  const { client } = clientFor(origin);
  const { status, json, empty } = await client.get('eu', characterPath('aldric-ventor'), ns);
  assert.equal(status, 200);
  assert.equal(empty, false);
  assert.equal(normalizeProfile(json).surname, 'Ventor');
});

test('requests carry namespace and the locale of the region', async () => {
  const { origin, seen } = await startMock();
  const { client } = clientFor(origin);
  await client.get('kr', characterPath('aldric-ventor'), profileNamespace('kr'));
  assert.equal(seen.urls.at(-1), '/mock/kr/profile/wow/character/aldric-ventor?namespace=profile-forever-kr&locale=ko_KR');
});

test('404 with a JSON body versus 404 with an empty body', async () => {
  const { origin } = await startMock();
  const { client } = clientFor(origin);
  const notFound = await client.get('eu', characterPath('inconnu-fantome'), ns);
  assert.equal(notFound.status, 404);
  assert.equal(notFound.empty, false);
  assert.equal(notFound.json.code, 404);
  const unrouted = await client.get('eu', '/profile/wow/unrouted', ns);
  assert.deepEqual(unrouted, { status: 404, json: null, empty: true });
});

test('403 for a namespace the API refuses is returned, not thrown', async () => {
  const { origin } = await startMock();
  const { client, sleeps } = clientFor(origin);
  const res = await client.get('eu', characterPath('aldric-ventor'), 'static-forever-eu');
  assert.equal(res.status, 403);
  assert.equal(res.json.code, 403);
  assert.deepEqual(sleeps, []);
});

test('401 on a request raises BlizzardAuthError without retrying', async () => {
  const { origin } = await startMock();
  const staleToken = await listen((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ access_token: 'stale', token_type: 'bearer' }));
  });
  const { client, sleeps } = clientFor(origin, { oauthUrl: staleToken });
  await assert.rejects(client.get('eu', characterPath('aldric-ventor'), ns), BlizzardAuthError);
  assert.equal(client.requestCount, 2);
  assert.deepEqual(sleeps, []);
});

test('a refused token raises BlizzardAuthError and is not retried', async () => {
  let hits = 0;
  const origin = await listen((req, res) => {
    hits++;
    res.writeHead(401, { 'Content-Type': 'application/json' }).end('{"error":"invalid_client"}');
  });
  const { client, sleeps } = clientFor(origin, { oauthUrl: `${origin}/token`, apiTemplate: `${origin}/{region}` });
  await assert.rejects(client.getToken(), BlizzardAuthError);
  await assert.rejects(client.get('eu', '/x', ns), BlizzardAuthError);
  assert.equal(hits, 1);
  assert.deepEqual(sleeps, []);
});

test('missing credentials raise BlizzardAuthError before any request', async () => {
  const client = new BlizzardClient({ clientId: '', clientSecret: '' });
  await assert.rejects(client.getToken(), BlizzardAuthError);
  assert.equal(client.requestCount, 0);
});

test('the token request uses Basic auth and the client-credentials grant', async () => {
  let seen;
  const origin = await listen((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen = { method: req.method, auth: req.headers.authorization, type: req.headers['content-type'], body };
      res.writeHead(200).end(JSON.stringify({ access_token: 'abc', token_type: 'bearer', expires_in: 1 }));
    });
  });
  const { client } = clientFor(origin, { oauthUrl: `${origin}/token` });
  assert.equal(await client.getToken(), 'abc');
  assert.deepEqual(seen, {
    method: 'POST',
    auth: `Basic ${Buffer.from('id:secret').toString('base64')}`,
    type: 'application/x-www-form-urlencoded',
    body: 'grant_type=client_credentials',
  });
});

/** A server whose successive answers are scripted: a status, optionally with headers, or 'drop' to kill the socket. */
async function scripted(steps) {
  let i = 0;
  return listen((req, res) => {
    if (req.method === 'POST') return res.writeHead(200).end('{"access_token":"t"}');
    const step = steps[Math.min(i++, steps.length - 1)];
    if (step === 'drop') return req.socket.destroy();
    res.writeHead(step.status, step.headers).end(step.body ?? '');
  });
}

test('a 500 is retried and the next success wins', async () => {
  const origin = await scripted([{ status: 500 }, { status: 200, body: '{"ok":true}' }]);
  const { client, sleeps } = clientFor(origin, { oauthUrl: `${origin}/token`, apiTemplate: `${origin}/{region}` });
  const res = await client.get('eu', '/x', ns);
  assert.deepEqual(res, { status: 200, json: { ok: true }, empty: false });
  assert.deepEqual(sleeps, [500]);
  assert.equal(client.requestCount, 3);
});

test('three failed attempts resolve with the last status, waiting 0.5 s then 1.5 s', async () => {
  const origin = await scripted([{ status: 503, body: '{"code":503}' }]);
  const { client, sleeps } = clientFor(origin, { oauthUrl: `${origin}/token`, apiTemplate: `${origin}/{region}` });
  const res = await client.get('eu', '/x', ns);
  assert.equal(res.status, 503);
  assert.equal(res.json.code, 503);
  assert.deepEqual(sleeps, [500, 1500]);
  assert.equal(client.requestCount, 4);
});

test('Retry-After is honoured and capped at 10 s', async () => {
  const origin = await scripted([
    { status: 429, headers: { 'Retry-After': '2' } },
    { status: 429, headers: { 'Retry-After': '99' } },
    { status: 200, body: '{}' },
  ]);
  const { client, sleeps } = clientFor(origin, { oauthUrl: `${origin}/token`, apiTemplate: `${origin}/{region}` });
  assert.equal((await client.get('eu', '/x', ns)).status, 200);
  assert.deepEqual(sleeps, [2000, 10_000]);
});

test('network errors are retried, then resolve with status 0', async () => {
  const origin = await scripted(['drop']);
  const { client, sleeps } = clientFor(origin, { oauthUrl: `${origin}/token`, apiTemplate: `${origin}/{region}` });
  assert.deepEqual(await client.get('eu', '/x', ns), { status: 0, json: null, empty: true });
  assert.deepEqual(sleeps, [500, 1500]);
});

test('a non-JSON body is reported as neither json nor empty', async () => {
  const origin = await scripted([{ status: 200, body: '<html>oops</html>' }]);
  const { client } = clientFor(origin, { oauthUrl: `${origin}/token`, apiTemplate: `${origin}/{region}` });
  assert.deepEqual(await client.get('eu', '/x', ns), { status: 200, json: null, empty: false });
});

test('a failing token endpoint is retried and does not poison later calls', async () => {
  let fail = true;
  const origin = await listen((req, res) => {
    if (fail) return res.writeHead(500).end();
    res.writeHead(200).end('{"access_token":"t"}');
  });
  const { client, sleeps } = clientFor(origin, { oauthUrl: `${origin}/token` });
  await assert.rejects(client.getToken(), (err) => err instanceof Error && !(err instanceof BlizzardAuthError));
  assert.deepEqual(sleeps, [500, 1500]);
  fail = false;
  assert.equal(await client.getToken(), 't');
});

test('a slug with accents reaches the mock decoded', async () => {
  const { origin, seen } = await startMock();
  const { client } = clientFor(origin);
  const { status, json } = await client.get('eu', characterPath('léa-bella'), ns);
  assert.equal(status, 200);
  assert.equal(json.name, 'Léa');
  assert.equal(json.surname, 'Bella');
  assert.ok(seen.urls.some((u) => u.startsWith('/mock/eu/profile/wow/character/l%C3%A9a-bella?')));
  const roster = await client.get('eu', '/data/wow/guild/les-copains/roster', ns);
  assert.ok(roster.json.members.some((m) => m.character.slug === 'léa-bella'));
});

test('mock: erreur answers 500 and the client gives up after three attempts', async () => {
  const { origin } = await startMock();
  const { client, sleeps } = clientFor(origin);
  assert.equal((await client.get('eu', characterPath('erreur-test'), ns)).status, 500);
  assert.deepEqual(sleeps, [500, 1500]);
});

test('mock: authentication rules', async () => {
  const { origin } = await startMock();
  const url = `${origin}/mock/eu/profile/wow/character/aldric-ventor?namespace=${ns}`;
  const anonymous = await fetch(url);
  assert.equal(anonymous.status, 404);
  assert.equal(await anonymous.text(), '');
  const wrong = await fetch(url, { headers: { Authorization: 'Bearer nope' } });
  assert.equal(wrong.status, 401);
  assert.equal(typeof (await wrong.json()), 'object');
  const noNamespace = await fetch(url.replace(/\?.*/, ''), { headers: { Authorization: 'Bearer mock-token' } });
  assert.equal(noNamespace.status, 403);
  const token = await fetch(`${origin}/mock/oauth/token`, { method: 'POST', headers: { Authorization: 'Basic eDp5' }, body: 'grant_type=client_credentials' });
  assert.deepEqual(await token.json(), { access_token: 'mock-token', token_type: 'bearer', expires_in: 86399 });
  const noBasic = await fetch(`${origin}/mock/oauth/token`, { method: 'POST' });
  assert.equal(noBasic.status, 401);
  const elsewhere = await fetch(`${origin}/other`);
  assert.equal(elsewhere.status, 500, 'requests outside the prefix are not answered by the mock');
});

test('mock: special slugs', async () => {
  const { origin } = await startMock();
  const { client } = clientFor(origin);
  const get = (slug, sub = '') => client.get('eu', characterPath(slug, sub), ns);

  assert.equal((await get('sansimage-test')).status, 200);
  assert.equal((await get('sansimage-test', '/character-media')).status, 404);
  assert.equal((await get('sansimage-test', '/equipment')).status, 200);

  const solo = await get('solo-loup');
  assert.equal(solo.status, 200);
  assert.equal(normalizeProfile(solo.json).guild, null);
  assert.equal((await get('aldric-ventor', '/nonsense')).status, 404);

  const roster = (await client.get('eu', '/data/wow/guild/les-copains/roster', ns)).json;
  const slugs = roster.members.map((m) => m.character.slug);
  assert.ok(slugs.includes('aldric-ventor') && slugs.includes('sansimage-test'));
  assert.ok(!slugs.includes('solo-loup') && !slugs.includes('inconnu-x') && !slugs.includes('erreur-x'));
  assert.equal((await client.get('eu', '/data/wow/guild/autre-guilde/roster', ns)).status, 404);
  const usRoster = await client.get('us', '/data/wow/guild/les-copains/roster', profileNamespace('us'));
  assert.deepEqual(usRoster.json.members, []);
});

test('mock: item media, with missing icons for ids divisible by 7', async () => {
  const { origin } = await startMock();
  const { client } = clientFor(origin);
  const media = (id) => client.get('eu', `/data/wow/media/item/${id}`, staticNamespace('eu'));
  const ok = await media(2316);
  assert.match(ok.json.assets[0].value, /^https:\/\/render\.worldofwarcraft\.com\/forever-eu\/icons\/56\/\d+\.jpg$/);
  assert.deepEqual((await media(2316)).json, ok.json);
  assert.equal((await media(2317)).status, 404);
  assert.equal((await media(0)).status, 404);
  assert.equal((await media('abc')).status, 404);
});

test('mock: characters progress with simulated time and cap at level 60', async () => {
  let clock = 0;
  const { origin } = await startMock({ now: () => clock, startedAt: 0, speed: 60 });
  const { client } = clientFor(origin);
  const snapshot = async (slug) => normalizeProfile((await client.get('eu', characterPath(slug), ns)).json);

  const first = await snapshot('aldric-ventor');
  assert.deepEqual(await snapshot('aldric-ventor'), first, 'deterministic at a given time');
  clock += 60_000;
  const later = await snapshot('aldric-ventor');
  assert.ok(later.level > first.level || (later.level === first.level && later.xp > first.xp));
  assert.notEqual(later.lastLoginAt, first.lastLoginAt);
  assert.ok(Date.parse(later.lastLoginAt) <= clock);

  clock += 24 * 3600 * 1000;
  const capped = await snapshot('aldric-ventor');
  assert.equal(capped.level, 60);
  assert.equal(capped.xp, 0);
});

test('mock: debutant is hidden from profile endpoints until level 10 but listed in the guild roster', async () => {
  let clock = 0;
  const { origin } = await startMock({ now: () => clock, startedAt: 0, speed: 60 });
  const { client } = clientFor(origin);
  const rosterLevel = async () => {
    const { json } = await client.get('eu', '/data/wow/guild/les-copains/roster', ns);
    return json.members.find((m) => m.character.slug === 'debutant-petitpas')?.character.level;
  };

  assert.equal((await client.get('eu', characterPath('debutant-petitpas'), ns)).status, 404);
  assert.equal(await rosterLevel(), 6);
  assert.equal((await client.get('eu', characterPath('debutant-petitpas', '/equipment'), ns)).status, 404);

  clock = 6 * 60_000;
  assert.equal((await client.get('eu', characterPath('debutant-petitpas'), ns)).status, 200);
  assert.ok((await rosterLevel()) >= 10);
});

test('mock: the demo characters get varied classes and one guild means one faction', async () => {
  const { origin } = await startMock();
  const { client } = clientFor(origin);
  const profileOf = async (slug) => normalizeProfile((await client.get('eu', characterPath(slug), ns)).json);

  const demo = ['aldric-ventor', 'brynn-valcourt', 'corwin-maelis', 'dara-nevers', 'elior-sombrebois'];
  const profiles = await Promise.all(demo.map(profileOf));
  assert.equal(new Set(profiles.map((p) => p.class.id)).size, 5, profiles.map((p) => p.class.name).join(', '));

  const factionOfRace = { 1: 'ALLIANCE', 3: 'ALLIANCE', 4: 'ALLIANCE', 7: 'ALLIANCE', 2: 'HORDE', 5: 'HORDE', 6: 'HORDE', 8: 'HORDE' };
  const slugs = Array.from({ length: 40 }, (_, i) => `membre-numero${i}`);
  const members = await Promise.all(slugs.map(profileOf));
  assert.equal(new Set(members.map((p) => p.faction)).size, 1, 'every guild member has the same faction');
  for (const p of members) assert.equal(factionOfRace[p.race.id], p.faction);

  const solos = await Promise.all(slugs.map((s) => profileOf(`solo-${s.slice(7)}`)));
  assert.equal(new Set(solos.map((p) => p.faction)).size, 2, 'solo characters may be on either side');
  for (const p of solos) assert.equal(factionOfRace[p.race.id], p.faction);
});
