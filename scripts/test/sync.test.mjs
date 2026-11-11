import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createMockBlizzard } from '../lib/mock-blizzard.mjs';
import { runSync } from '../lib/sync-core.mjs';

const T0 = Date.parse('2026-11-10T18:00:00Z');
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

const PLAYER_KEYS = [
  'id', 'region', 'slug', 'name', 'surname', 'label', 'addedAt', 'state', 'source', 'checkedAt', 'seenAt',
  'characterId', 'level', 'xp', 'changedAt', 'levelAt', 'goalAt', 'class', 'race', 'gender', 'faction', 'ruleset',
  'guild', 'ilvl', 'achievementPoints', 'lastLoginAt', 'avatar', 'render', 'gear', 'professions', 'stats', 'talents',
];
const GEAR_KEYS = ['slot', 'slotName', 'itemId', 'name', 'quality', 'ilvl', 'icon', 'enchant'];

const NAMES = ['Aldric Ventor', 'Brenna Stone', 'Corwin Hale', 'Delia Marsh', 'Edric Voss', 'Fenna Lark'];

const entry = (full, label) => {
  const [name, surname] = full.split(' ');
  return { region: 'eu', name, surname, ...(label && { label }), addedAt: '2026-11-10T17:00:00Z' };
};

/** A sandbox: temp data directory and roster, a mock Blizzard API on 127.0.0.1 with a clock the test moves. */
async function sandbox(t, { players = NAMES, settings = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wft-'));
  const clock = { t: T0 };
  const mock = createMockBlizzard({ now: () => clock.t, startedAt: T0, speed: 1 });
  const server = http.createServer(async (req, res) => {
    if (box.intercept?.(req, res)) return;
    if (!(await mock.handle(req, res, '/m'))) res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/m`;
  t.after(() => {
    server.closeAllConnections();
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const box = {
    clock,
    dataDir: path.join(dir, 'data'),
    rosterFile: path.join(dir, 'players.json'),
    env: {
      BLIZZARD_CLIENT_ID: 'id',
      BLIZZARD_CLIENT_SECRET: 'secret',
      BLIZZARD_OAUTH_URL: `${base}/oauth/token`,
      BLIZZARD_API_TEMPLATE: `${base}/{region}`,
      TRACKER_ROSTER_FILE: path.join(dir, 'players.json'),
      TRACKER_DATA_DIR: path.join(dir, 'data'),
    },
    setRoster(list, extraSettings = settings) {
      const roster = { version: 1, settings: { title: 'Course', goalLevel: 60, ...extraSettings }, players: list.map((p) => (typeof p === 'string' ? entry(p) : p)) };
      fs.writeFileSync(this.rosterFile, `${JSON.stringify(roster, null, 2)}\n`);
    },
    read(file) {
      return JSON.parse(fs.readFileSync(path.join(this.dataDir, file), 'utf8'));
    },
    advance(ms) {
      clock.t += ms;
    },
    /** Optional (req, res) => boolean hook in front of the mock, to script what the API answers. */
    intercept: null,
    sync(env = {}, log = () => {}) {
      return runSync({ env: { ...this.env, ...env }, now: new Date(clock.t), log });
    },
  };
  box.setRoster(players);
  return box;
}

const byId = (data) => Object.fromEntries(data.players.map((p) => [p.id, p]));
const requestsOf = (result) => Number(/Requêtes Blizzard : (\d+)/.exec(result.summary)[1]);

test('first run: files, key order, nullability and history', async (t) => {
  const box = await sandbox(t, { players: [entry('Aldric Ventor', 'Max'), entry('Brenna Stone')] });
  const result = await box.sync({ GITHUB_REPOSITORY: 'sadok/wow-forever-race', GITHUB_REF_NAME: 'trunk' });

  const text = fs.readFileSync(path.join(box.dataDir, 'data.json'), 'utf8');
  assert.ok(text.endsWith('}\n'));
  assert.ok(text.includes('\n  "schema": 1'));
  const data = JSON.parse(text);
  assert.deepEqual(Object.keys(data), ['schema', 'generatedAt', 'settings', 'repo', 'status', 'xpTable', 'players']);
  assert.equal(data.generatedAt, iso(T0));
  assert.deepEqual(data.settings, { title: 'Course', goalLevel: 60 });
  assert.deepEqual(data.repo, { owner: 'sadok', name: 'wow-forever-race', branch: 'trunk', workflow: 'tracker.yml', apiBase: 'https://api.github.com' });
  assert.deepEqual(data.status, { code: 'ok', message: null, warnings: [] });
  assert.equal(data.xpTable.length, 59);
  assert.deepEqual(result.data, data);

  const [aldric, brenna] = data.players;
  assert.deepEqual(Object.keys(aldric), PLAYER_KEYS);
  assert.equal(aldric.id, 'eu:aldric-ventor');
  assert.equal(aldric.label, 'Max');
  assert.equal(brenna.label, null);
  assert.equal(aldric.state, 'ok');
  assert.equal(aldric.source, 'profile');
  assert.equal(aldric.checkedAt, iso(T0));
  assert.equal(aldric.seenAt, iso(T0));
  assert.ok(aldric.level >= 10 && Number.isInteger(aldric.xp));
  assert.equal(aldric.changedAt, null);
  assert.equal(aldric.levelAt, null);
  assert.equal(aldric.goalAt, null);
  assert.equal(aldric.guild.slug, 'les-copains');
  assert.equal(aldric.class.name.length > 0, true);
  assert.match(aldric.avatar, /^https:\/\/render\.worldofwarcraft\.com\//);
  assert.match(aldric.lastLoginAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.ok(aldric.gear.length >= 8);
  assert.deepEqual(Object.keys(aldric.gear[0]), GEAR_KEYS);
  assert.ok(aldric.professions.length > 0 && aldric.talents.length > 0);
  assert.deepEqual(Object.keys(aldric.stats), ['health', 'power', 'powerType', 'strength', 'agility', 'stamina', 'intellect', 'spirit', 'armor']);

  const history = box.read('history.json');
  assert.deepEqual(Object.keys(history), ['schema', 'series']);
  assert.deepEqual(history.series['eu:aldric-ventor'], [[T0 / 1000, aldric.level, aldric.xp]]);
  assert.deepEqual(result.history, history);

  const media = box.read('media.json');
  assert.equal(media.schema, 1);
  const withIcon = aldric.gear.filter((g) => g.icon);
  assert.ok(withIcon.length > 0);
  for (const g of withIcon) assert.equal(media.items[g.itemId].icon, g.icon);
  for (const g of aldric.gear.filter((x) => !x.icon)) assert.equal(media.items[g.itemId].icon, null);
  assert.ok(result.summary.includes('| Aldric Ventor (EU) | ok |'));
});

test('second run: progress, history growth, changedAt and levelAt; idle run costs one request per player', async (t) => {
  const box = await sandbox(t, { players: ['Aldric Ventor', 'Brenna Stone'] });
  const first = await box.sync();
  const before = byId(first.data);

  box.advance(3 * HOUR);
  const second = await box.sync();
  const after = byId(second.data);
  for (const id of Object.keys(before)) {
    assert.ok(after[id].level >= before[id].level);
    assert.notDeepEqual([after[id].level, after[id].xp], [before[id].level, before[id].xp]);
    assert.equal(after[id].changedAt, iso(box.clock.t));
    assert.equal(after[id].seenAt, iso(box.clock.t));
    assert.notEqual(after[id].lastLoginAt, before[id].lastLoginAt);
    assert.equal(box.read('history.json').series[id].length, 2);
    assert.equal(box.read('history.json').series[id][1][0], box.clock.t / 1000);
  }
  const leveled = Object.values(after).filter((p) => p.level > before[p.id].level);
  assert.ok(leveled.length > 0);
  for (const p of leveled) assert.equal(p.levelAt, iso(box.clock.t));

  const idle = await box.sync();
  assert.equal(requestsOf(idle), 2 + 1, 'token + one profile per player, nothing else');
  const idleAfter = byId(idle.data);
  for (const id of Object.keys(after)) {
    assert.deepEqual(idleAfter[id], { ...after[id], checkedAt: idleAfter[id].checkedAt });
    assert.equal(box.read('history.json').series[id].length, 2);
  }
});

test('TRACKER_FULL refetches every sub-resource', async (t) => {
  const box = await sandbox(t, { players: ['Aldric Ventor'] });
  await box.sync();
  const idle = await box.sync();
  const full = await box.sync({ TRACKER_FULL: '1' });
  assert.equal(requestsOf(idle), 2);
  assert.equal(requestsOf(full), 1 + 1 + 5);
});

test('inconnu stays pending with null fields and does not make the run partial', async (t) => {
  const box = await sandbox(t, { players: ['Aldric Ventor', 'Inconnu Fantome'] });
  const { data } = await box.sync();
  const ghost = byId(data)['eu:inconnu-fantome'];
  assert.equal(ghost.state, 'pending');
  assert.equal(ghost.seenAt, null);
  assert.equal(ghost.checkedAt, iso(T0));
  for (const key of PLAYER_KEYS.slice(PLAYER_KEYS.indexOf('characterId'))) assert.equal(ghost[key], null, key);
  assert.equal(data.status.code, 'ok');
  assert.equal(box.read('history.json').series['eu:inconnu-fantome'], undefined);
});

test('erreur: error state, partial status, then api-error when everything fails', async (t) => {
  const box = await sandbox(t, { players: ['Aldric Ventor', 'Erreur Panne'] });
  const { data } = await box.sync();
  assert.equal(byId(data)['eu:erreur-panne'].state, 'error');
  assert.equal(byId(data)['eu:aldric-ventor'].state, 'ok');
  assert.equal(data.status.code, 'partial');
  assert.equal(data.status.message, 'Certains personnages n’ont pas pu être vérifiés ; nouvel essai à la prochaine synchronisation.');

  box.setRoster(['Erreur Panne']);
  const all = await box.sync();
  assert.equal(all.data.status.code, 'api-error');
  assert.equal(all.data.players[0].state, 'error');
});

test('an unreachable API keeps the last data and reports api-error', async (t) => {
  const box = await sandbox(t, { players: ['Aldric Ventor'] });
  const first = await box.sync();
  box.advance(HOUR);
  const second = await box.sync({ BLIZZARD_API_TEMPLATE: 'http://127.0.0.1:1/{region}', BLIZZARD_OAUTH_URL: 'http://127.0.0.1:1/oauth' });
  assert.equal(second.data.status.code, 'api-error');
  const p = second.data.players[0];
  assert.equal(p.state, 'error');
  assert.equal(p.level, first.data.players[0].level);
  assert.equal(p.checkedAt, first.data.players[0].checkedAt);
});

test('debutant is found through the guild roster, then promoted to ok with a level-up', async (t) => {
  const box = await sandbox(t, { players: ['Aldric Ventor', 'Debutant Petitpas'] });
  const first = await box.sync();
  const kid = byId(first.data)['eu:debutant-petitpas'];
  assert.equal(kid.state, 'roster');
  assert.equal(kid.source, 'roster');
  assert.equal(kid.level, 6);
  assert.equal(kid.xp, null);
  assert.equal(kid.seenAt, iso(T0));
  assert.equal(kid.guild.slug, 'les-copains');
  assert.ok(kid.class.id > 0 && typeof kid.class.name === 'string');
  assert.ok(typeof kid.race.name === 'string');
  assert.ok(kid.characterId > 0);
  assert.equal(kid.gear, null);
  assert.equal(kid.changedAt, null);
  assert.equal(first.data.status.code, 'ok');
  assert.deepEqual(box.read('history.json').series['eu:debutant-petitpas'], [[T0 / 1000, 6, null]]);

  box.advance(6 * HOUR);
  const second = await box.sync();
  const grown = byId(second.data)['eu:debutant-petitpas'];
  assert.equal(grown.state, 'ok');
  assert.equal(grown.source, 'profile');
  assert.ok(grown.level >= 10 && grown.xp !== null);
  assert.equal(grown.levelAt, iso(box.clock.t));
  assert.equal(grown.changedAt, iso(box.clock.t));
  assert.ok(grown.gear.length > 0);
  assert.equal(box.read('history.json').series['eu:debutant-petitpas'].length, 2);
});

test('a roster-sourced player that no roster lists any more is missing', async (t) => {
  const box = await sandbox(t, { players: ['Aldric Ventor', 'Debutant Petitpas'] });
  await box.sync();
  // Its stored guild is now one whose roster the API does not know: nothing lists the debutant.
  box.setRoster(['Debutant Petitpas']);
  const stored = box.read('data.json');
  stored.players = stored.players.filter((p) => p.slug === 'debutant-petitpas');
  stored.players[0].guild = { name: 'Autre guilde', slug: 'autre-guilde' };
  fs.writeFileSync(path.join(box.dataDir, 'data.json'), JSON.stringify(stored));
  const { data } = await box.sync();
  assert.equal(data.players[0].state, 'missing');
  assert.equal(data.players[0].level, 6);
});

test('the guild stored on a player is read even when no guild-mate has a profile', async (t) => {
  const box = await sandbox(t, { players: ['Aldric Ventor', 'Debutant Petitpas'] });
  await box.sync();
  // Aldric is gone: the debutant, found through the roster earlier, still points to its guild.
  box.setRoster(['Debutant Petitpas']);
  const alone = await box.sync();
  assert.equal(alone.data.players[0].state, 'roster');
  assert.equal(alone.data.players[0].level, 6);
});

test('a guild-mate in error this run still leads to the guild roster', async (t) => {
  const box = await sandbox(t, { players: ['Erreur Mate', 'Debutant Petitpas'] });
  fs.mkdirSync(box.dataDir, { recursive: true });
  const known = { id: 'eu:erreur-mate', region: 'eu', slug: 'erreur-mate', name: 'Erreur', surname: 'Mate', state: 'ok', characterId: 5, level: 20, xp: 10, guild: { name: 'Les Copains', slug: 'les-copains' } };
  fs.writeFileSync(path.join(box.dataDir, 'data.json'), JSON.stringify({ players: [known] }));
  const { data } = await box.sync();
  const byslug = byId(data);
  assert.equal(byslug['eu:erreur-mate'].state, 'error');
  assert.equal(byslug['eu:debutant-petitpas'].state, 'roster');
  assert.equal(byslug['eu:debutant-petitpas'].level, 6);
});

test('guilds nobody is looking for do not use up the cap of guild rosters', async (t) => {
  const junk = Array.from({ length: 6 }, (_, i) => ({ region: 'us', slug: `guilde-${i}` }));
  const box = await sandbox(t, { players: ['Aldric Ventor', 'Debutant Petitpas'], settings: { guilds: junk } });
  const urls = [];
  box.intercept = (req) => void urls.push(req.url);
  const { data } = await box.sync();
  assert.equal(byId(data)['eu:debutant-petitpas'].state, 'roster');
  assert.equal(urls.filter((u) => u.includes('/guild/')).length, 1, 'only the eu guild is read');
});

test('a re-created name found through a roster resets what was known about the old character', async (t) => {
  const box = await sandbox(t, { players: ['Debutant Petitpas'] });
  fs.mkdirSync(box.dataDir, { recursive: true });
  const old = {
    id: 'eu:debutant-petitpas', region: 'eu', slug: 'debutant-petitpas', name: 'Debutant', surname: 'Petitpas', state: 'ok', source: 'profile',
    seenAt: iso(T0 - HOUR), characterId: 1, level: 59, xp: 5, changedAt: iso(T0 - HOUR), levelAt: iso(T0 - HOUR), goalAt: iso(T0 - HOUR),
    guild: { name: 'Les Copains', slug: 'les-copains' }, ilvl: 50, avatar: 'https://render.worldofwarcraft.com/old.jpg', lastLoginAt: iso(T0 - HOUR),
    gear: [{ slot: 'HEAD', slotName: 'Tête', itemId: 1, name: 'Ancien', quality: 'RARE', ilvl: 5, icon: null, enchant: null }],
    professions: [], stats: null, talents: [],
  };
  fs.writeFileSync(path.join(box.dataDir, 'data.json'), JSON.stringify({ players: [old] }));
  fs.writeFileSync(path.join(box.dataDir, 'history.json'), JSON.stringify({ schema: 1, series: { 'eu:debutant-petitpas': [[T0 / 1000 - 7200, 58, 10], [T0 / 1000 - 3600, 59, 5]] } }));

  const { data } = await box.sync();
  const p = data.players[0];
  assert.equal(p.state, 'roster');
  assert.equal(p.level, 6);
  assert.notEqual(p.characterId, 1);
  assert.equal(p.gear, null);
  assert.equal(p.avatar, null);
  assert.equal(p.ilvl, null);
  assert.equal(p.lastLoginAt, null);
  assert.equal(p.changedAt, null);
  assert.equal(p.levelAt, null);
  assert.equal(p.goalAt, null);
  assert.deepEqual(box.read('history.json').series['eu:debutant-petitpas'], [[T0 / 1000, 6, null]]);
});

test('no credentials: previous data is kept, states degrade, files are still written', async (t) => {
  const box = await sandbox(t, { players: ['Aldric Ventor'] });
  const first = await box.sync();

  box.setRoster(['Aldric Ventor', 'Brenna Stone']);
  box.advance(HOUR);
  const lines = [];
  const result = await runSync({
    env: { TRACKER_ROSTER_FILE: box.rosterFile, TRACKER_DATA_DIR: box.dataDir },
    now: new Date(box.clock.t),
    log: (l) => lines.push(l),
  });
  const { data } = result;
  assert.equal(data.status.code, 'no-credentials');
  assert.equal(data.status.message, 'L’API Blizzard n’est pas encore configurée : ajoute les secrets BLIZZARD_CLIENT_ID et BLIZZARD_CLIENT_SECRET au dépôt.');
  const [aldric, brenna] = data.players;
  assert.equal(aldric.state, 'error');
  assert.equal(aldric.level, first.data.players[0].level);
  assert.deepEqual(aldric.gear, first.data.players[0].gear);
  assert.equal(brenna.state, 'pending');
  assert.equal(data.repo, null);
  assert.deepEqual(box.read('data.json'), data);
  assert.equal(box.read('history.json').series['eu:aldric-ventor'].length, 1);
  assert.ok(lines.some((l) => l.startsWith('::warning::')));
  assert.equal(requestsOf(result), 0);
});

test('refused credentials give auth-failed, a 401 during the run too', async (t) => {
  const box = await sandbox(t, { players: ['Aldric Ventor'] });
  const first = await box.sync();
  const lines = [];
  const refused = await runSync({
    env: { ...box.env, BLIZZARD_OAUTH_URL: box.env.BLIZZARD_OAUTH_URL.replace('/oauth/token', '/oauth/refused') },
    now: new Date(box.clock.t),
    log: (l) => lines.push(l),
  });
  assert.equal(refused.data.status.code, 'auth-failed');
  assert.equal(refused.data.status.message, 'Blizzard a refusé les identifiants de l’API : vérifie les deux secrets du dépôt.');
  assert.equal(refused.data.players[0].state, 'error');
  assert.equal(refused.data.players[0].level, first.data.players[0].level);
  assert.ok(lines.some((l) => l.startsWith('::error::')));

  // A token the API then rejects: the run is abandoned and the players are left as they were.
  const server = http.createServer((req, res) => {
    if (req.method === 'POST') res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"access_token":"stale"}');
    else res.writeHead(401, { 'Content-Type': 'application/json' }).end('{"error":"invalid_token"}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const stale = await box.sync({ BLIZZARD_OAUTH_URL: `${origin}/token`, BLIZZARD_API_TEMPLATE: `${origin}/{region}` });
  assert.equal(stale.data.status.code, 'auth-failed');
  assert.equal(stale.data.players[0].level, first.data.players[0].level);
  assert.equal(stale.data.players[0].state, 'error');
});

test('a different characterId for the same name resets everything that was learned', async (t) => {
  const box = await sandbox(t, { players: ['Aldric Ventor'] });
  const first = await box.sync();
  const realId = first.data.players[0].characterId;

  const data = box.read('data.json');
  Object.assign(data.players[0], { characterId: 1, changedAt: '2026-11-10T10:00:00Z', levelAt: '2026-11-10T10:00:00Z', goalAt: '2026-11-10T10:00:00Z', level: 59, xp: 1, gear: [{ slot: 'HEAD', slotName: 'Tête', itemId: 1, name: 'Ancien', quality: 'RARE', ilvl: 5, icon: null, enchant: null }], avatar: null });
  fs.writeFileSync(path.join(box.dataDir, 'data.json'), JSON.stringify(data));
  const history = box.read('history.json');
  history.series['eu:aldric-ventor'] = [[T0 / 1000 - 7200, 58, 10], [T0 / 1000 - 3600, 59, 1]];
  fs.writeFileSync(path.join(box.dataDir, 'history.json'), JSON.stringify(history));

  const { data: after } = await box.sync();
  const p = after.players[0];
  assert.equal(p.characterId, realId);
  assert.equal(p.level, first.data.players[0].level);
  assert.equal(p.changedAt, null);
  assert.equal(p.levelAt, null);
  assert.equal(p.goalAt, null);
  assert.notEqual(p.gear[0].name, 'Ancien');
  assert.deepEqual(box.read('history.json').series['eu:aldric-ventor'], [[T0 / 1000, p.level, p.xp]]);
});

test('30-day purge erases what Blizzard data was kept, 29 days do not', async (t) => {
  const box = await sandbox(t, { players: ['Aldric Ventor', 'Brenna Stone'] });
  const first = await box.sync();
  const noCredentials = { BLIZZARD_CLIENT_ID: '', BLIZZARD_CLIENT_SECRET: '' };

  box.advance(29 * DAY);
  const early = await box.sync(noCredentials);
  assert.equal(early.data.players[0].level, first.data.players[0].level);
  assert.deepEqual(early.data.status.warnings, []);

  box.advance(2 * DAY);
  const late = await box.sync(noCredentials);
  assert.equal(late.data.status.code, 'no-credentials');
  for (const p of late.data.players) {
    assert.equal(p.state, 'pending');
    assert.equal(p.seenAt, null);
    assert.equal(p.source, null);
    for (const key of PLAYER_KEYS.slice(PLAYER_KEYS.indexOf('characterId'))) assert.equal(p[key], null, key);
    assert.equal(p.addedAt, '2026-11-10T17:00:00Z');
  }
  assert.deepEqual(late.data.status.warnings, [
    'Les données de Aldric Ventor ont été effacées : personnage introuvable depuis 30 jours.',
    'Les données de Brenna Stone ont été effacées : personnage introuvable depuis 30 jours.',
  ]);
  assert.deepEqual(box.read('history.json').series, {});
});

test('removing a player from the roster deletes its history series and its entry', async (t) => {
  const box = await sandbox(t, { players: ['Aldric Ventor', 'Brenna Stone'] });
  await box.sync();
  assert.deepEqual(Object.keys(box.read('history.json').series).sort(), ['eu:aldric-ventor', 'eu:brenna-stone']);
  box.setRoster(['Brenna Stone']);
  const { data } = await box.sync();
  assert.deepEqual(data.players.map((p) => p.id), ['eu:brenna-stone']);
  assert.deepEqual(Object.keys(box.read('history.json').series), ['eu:brenna-stone']);
});

test('XP table self-check and settings', async (t) => {
  const box = await sandbox(t, { players: ['Aldric Ventor'] });
  const ok = await box.sync();
  assert.equal(ok.data.xpTable.length, 59);
  box.advance(1.5 * HOUR); // xp is 0 at the very start of a level, which no table can contradict

  box.setRoster(['Aldric Ventor'], { xpTable: new Array(59).fill(1) });
  const wrong = await box.sync();
  assert.equal(wrong.data.xpTable, null);
  assert.deepEqual(wrong.data.status.warnings, ['La table d’XP ne correspond pas aux valeurs observées : les barres d’XP sont désactivées.']);

  box.setRoster(['Aldric Ventor'], { xpTable: false });
  const off = await box.sync();
  assert.equal(off.data.xpTable, null);
  assert.deepEqual(off.data.status.warnings, []);

  const custom = new Array(59).fill(1_000_000);
  box.setRoster(['Aldric Ventor'], { xpTable: custom });
  assert.deepEqual((await box.sync()).data.xpTable, custom);

  box.setRoster(['Aldric Ventor'], { xpTable: 'oui' });
  const invalid = await box.sync();
  assert.equal(invalid.data.xpTable.length, 59);
  assert.equal(invalid.data.status.warnings.length, 1);
});

test('goalAt is set when the goal is first observed and cleared when the goal is raised', async (t) => {
  const box = await sandbox(t, { players: ['Aldric Ventor'], settings: { goalLevel: 10 } });
  const first = await box.sync();
  assert.equal(first.data.players[0].goalAt, iso(T0));

  box.advance(HOUR);
  const second = await box.sync();
  assert.equal(second.data.players[0].goalAt, iso(T0), 'the first sighting is kept');

  box.setRoster(['Aldric Ventor'], { goalLevel: 60 });
  const third = await box.sync();
  assert.equal(third.data.players[0].goalAt, null);
});

test('item icons that failed are retried only after 24 hours', async (t) => {
  const box = await sandbox(t, { players: NAMES });
  // 66 gear items against a cap of 60 lookups per run: the second run completes the cache.
  await box.sync();
  assert.equal(Object.keys(box.read('media.json').items).length, 60);
  await box.sync();
  const missing = Object.entries(box.read('media.json').items).filter(([, v]) => v.icon === null);
  assert.ok(missing.length > 0, 'the fixed roster contains at least one item the mock cannot resolve');

  box.advance(HOUR);
  await box.sync();
  for (const [id, value] of missing) assert.equal(box.read('media.json').items[id].at, T0 / 1000);

  box.advance(25 * HOUR);
  await box.sync();
  const retried = missing.filter(([id]) => box.read('media.json').items[id].at === box.clock.t / 1000);
  assert.ok(retried.length > 0);
});

test('a missing avatar and a failing sub-resource keep what was known', async (t) => {
  const box = await sandbox(t, { players: ['Sansimage Test'] });
  const first = await box.sync();
  assert.equal(first.data.players[0].state, 'ok');
  assert.equal(first.data.players[0].avatar, null);
  assert.ok(first.data.players[0].gear.length > 0);

  // Media is retried on each run while the avatar is missing, the rest is not.
  const second = await box.sync();
  assert.equal(requestsOf(second), 1 + 1 + 1);
});

test('corrupt or missing data files never crash the sync', async (t) => {
  const box = await sandbox(t, { players: ['Aldric Ventor'] });
  fs.mkdirSync(box.dataDir, { recursive: true });
  for (const file of ['data.json', 'history.json', 'media.json']) fs.writeFileSync(path.join(box.dataDir, file), '{ nope');
  const { data } = await box.sync();
  assert.equal(data.players[0].state, 'ok');
  assert.equal(data.status.warnings.length, 3);
  assert.ok(data.status.warnings.every((w) => w.includes('illisible')));
  assert.equal(box.read('history.json').series['eu:aldric-ventor'].length, 1);
});

test('roster warnings reach data.json and an empty roster is fine', async (t) => {
  const box = await sandbox(t, { players: [] });
  fs.writeFileSync(box.rosterFile, '{"version":1,"settings":{},"players":[{"region":"xx","name":"A","surname":"B"}]}');
  const { data } = await box.sync();
  assert.deepEqual(data.players, []);
  assert.equal(data.status.code, 'ok');
  assert.equal(data.status.warnings.length, 1);
  assert.match(data.status.warnings[0], /Entrée n°1/);
});

test('the step summary is appended to GITHUB_STEP_SUMMARY', async (t) => {
  const box = await sandbox(t, { players: ['Aldric Ventor'] });
  const file = path.join(path.dirname(box.rosterFile), 'summary.md');
  const result = await box.sync({ GITHUB_STEP_SUMMARY: file });
  assert.equal(fs.readFileSync(file, 'utf8').trim(), result.summary.trim());
  assert.match(result.summary, /\| Personnage \| État \| Niveau \| XP \| Changement \|/);
});

test('a technical failure of an icon lookup is not cached, only a real not-found is', async (t) => {
  const box = await sandbox(t, { players: ['Aldric Ventor'] });
  // 403 for even ids, an empty 404 (the gateway refusing the request) for odd ones.
  box.intercept = (req, res) => {
    const id = /\/media\/item\/(\d+)/.exec(req.url)?.[1];
    if (!id) return false;
    if (Number(id) % 2 === 0) res.writeHead(403, { 'Content-Type': 'application/json' }).end('{"code":403}');
    else res.writeHead(404).end();
    return true;
  };
  await box.sync();
  assert.deepEqual(box.read('media.json').items, {});

  box.intercept = null;
  box.advance(HOUR);
  await box.sync();
  const items = Object.entries(box.read('media.json').items);
  assert.ok(items.length >= 8);
  for (const [id, value] of items) assert.equal(value.at, box.clock.t / 1000, id);
  assert.ok(items.some(([, v]) => v.icon !== null));
});

test('text from the API cannot start a log line, break the summary table or leave control characters', async (t) => {
  const box = await sandbox(t, { players: ['Aldric Ventor'] });
  box.intercept = (req, res) => {
    if (!req.url.includes('/profile/wow/character/aldric-ventor?')) return false;
    const body = {
      id: 4242017, name: 'Aldric\n::error::INJECTED', surname: 'Ven|tor\u0007', level: 27, experience: 5,
      character_class: { id: 2, name: 'Pala\ndin' }, race: { id: 1, name: 'Humain' }, faction: { type: 'ALLIANCE' },
    };
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    return true;
  };
  const lines = [];
  const file = path.join(path.dirname(box.rosterFile), 'summary.md');
  const { data, summary } = await box.sync({ GITHUB_STEP_SUMMARY: file }, (line) => lines.push(line));

  const p = data.players[0];
  assert.equal(p.name, 'Aldric ::error::INJECTED');
  assert.equal(p.surname, 'Ven|tor');
  assert.equal(p.class.name, 'Pala din');
  for (const line of lines) assert.doesNotMatch(line, /[\r\n]/);
  assert.ok(lines.every((line) => !line.startsWith('::') || line.startsWith('::warning::') || line.startsWith('::error::Blizzard')));
  assert.ok(!lines.some((line) => line.startsWith('::error::INJECTED')));

  const row = summary.split('\n').find((l) => l.includes('INJECTED'));
  assert.ok(row.startsWith('| Aldric ::error::INJECTED Ven\\|tor (EU) |'), row);
  assert.equal(row.replaceAll('\\|', '').split('|').length, 7, 'the row keeps its five cells');
  assert.equal(fs.readFileSync(file, 'utf8').trim(), summary.trim());
});
