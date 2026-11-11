import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, dataDir, editFile, rosterFile } from '../lib/paths.mjs';
import {
  DEFAULT_SETTINGS,
  RosterError,
  applyOp,
  parseRoster,
  serializeRoster,
  validateEditPayload,
} from '../lib/roster.mjs';

const NOW = '2026-11-10T18:00:00Z';
const entry = (name, surname, extra = {}) => ({ region: 'eu', name, surname, ...extra });
const rosterOf = (players, settings) => parseRoster(JSON.stringify({ version: 1, settings, players })).roster;
const add = (roster, over = {}) => applyOp(roster, { op: 'add', region: 'eu', name: 'Joe', surname: 'Gun', label: '', ...over }, NOW);

test('paths: defaults and environment overrides', () => {
  const saved = { ...process.env };
  try {
    for (const k of ['TRACKER_ROSTER_FILE', 'TRACKER_DATA_DIR', 'TRACKER_EDIT_FILE']) delete process.env[k];
    assert.equal(rosterFile(), path.join(ROOT, 'players.json'));
    assert.equal(dataDir(), path.join(ROOT, 'site', 'data'));
    assert.equal(editFile(), path.join(ROOT, 'site', 'edit.json'));
    assert.ok(fs.existsSync(path.join(ROOT, 'players.json')), 'ROOT is the project root');
    process.env.TRACKER_ROSTER_FILE = 'r.json';
    process.env.TRACKER_DATA_DIR = 'd';
    process.env.TRACKER_EDIT_FILE = 'e.json';
    assert.deepEqual([rosterFile(), dataDir(), editFile()], ['r.json', 'd', 'e.json']);
  } finally {
    for (const k of ['TRACKER_ROSTER_FILE', 'TRACKER_DATA_DIR', 'TRACKER_EDIT_FILE']) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});

test('parseRoster: empty, invalid and misshapen files give an empty roster and a warning', () => {
  for (const bad of ['', '   ', '{oops', 'null', '[]', '"x"', undefined]) {
    const { roster, warnings } = parseRoster(bad);
    assert.deepEqual(roster.players, [], String(bad));
    assert.deepEqual(roster.settings, DEFAULT_SETTINGS);
    assert.equal(warnings.length, 1, String(bad));
  }
  const { roster, warnings } = parseRoster('{"players":"nope"}');
  assert.deepEqual(roster.players, []);
  assert.equal(warnings.length, 1);
});

test('parseRoster: the committed players.json parses without warnings', () => {
  const { roster, warnings } = parseRoster(fs.readFileSync(path.join(ROOT, 'players.json'), 'utf8'));
  assert.deepEqual(warnings, []);
  assert.deepEqual(roster.settings, DEFAULT_SETTINGS);
});

test('parseRoster: derives id and slug, normalises names, cleans labels', () => {
  const { roster, warnings } = parseRoster(
    JSON.stringify({ players: [entry('jOE', 'gun', { label: '  Max ', addedAt: NOW }), entry('éLéA', 'brûle')] }),
  );
  assert.deepEqual(warnings, []);
  assert.deepEqual(roster.players[0], {
    id: 'eu:joe-gun', region: 'eu', slug: 'joe-gun', name: 'Joe', surname: 'Gun', label: 'Max', addedAt: NOW,
  });
  assert.equal(roster.players[1].id, 'eu:éléa-brûle');
  assert.equal(roster.players[1].label, null);
  assert.equal(roster.players[1].addedAt, null);
});

test('parseRoster: invalid entries are skipped with French warnings', () => {
  const { roster, warnings } = parseRoster(
    JSON.stringify({
      players: [
        entry('Joe', 'Gun'),
        { region: 'xx', name: 'Bad', surname: 'Region' },
        entry('A', 'Short'),
        entry('Joe', 'Gun3'),
        'string',
        null,
        { name: 'No', surname: 'Region' },
        entry('Ana', 'Lys', { addedAt: 'not a date' }),
      ],
    }),
  );
  assert.deepEqual(roster.players.map((p) => p.id), ['eu:joe-gun', 'eu:ana-lys']);
  assert.equal(roster.players[1].addedAt, null);
  assert.equal(warnings.length, 6);
  assert.match(warnings[0], /^Entrée n°2 /);
  assert.match(warnings[1], /^Entrée n°3 .*2 à 12 lettres/);
});

test('parseRoster: duplicates keep the first, regions are distinct ids', () => {
  const { roster, warnings } = parseRoster(
    JSON.stringify({
      players: [entry('Joe', 'Gun', { label: 'First' }), entry('JOE', 'gun', { label: 'Second' }), { ...entry('Joe', 'Gun'), region: 'us' }],
    }),
  );
  assert.deepEqual(roster.players.map((p) => [p.id, p.label]), [['eu:joe-gun', 'First'], ['us:joe-gun', null]]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Doublon.*Joe Gun \(EU\)/);
});

test('parseRoster: keeps at most 50 players', () => {
  const players = Array.from({ length: 53 }, (_, i) => entry('Joe', `Nom${'abcdefghijklmnopqrstuvwxyz'[i % 26]}${'abc'[Math.floor(i / 26)]}`));
  const { roster, warnings } = parseRoster(JSON.stringify({ players }));
  assert.equal(roster.players.length, 50);
  assert.equal(warnings.length, 3);
  assert.match(warnings[0], /Limite de 50/);
});

test('parseRoster: settings defaults, validation and unknown keys', () => {
  const ok = parseRoster(JSON.stringify({ settings: { title: ' Ma course ', goalLevel: 40, xpTable: false, extra: 1, guilds: [{ region: 'eu', slug: 'Les-Copains' }] } }));
  assert.deepEqual(ok.warnings, []);
  assert.deepEqual(ok.roster.settings, {
    title: 'Ma course', goalLevel: 40, xpTable: false, extra: 1, guilds: [{ region: 'eu', slug: 'les-copains' }],
  });
  for (const goalLevel of [1, 61, 40.5, '60', null]) {
    const r = parseRoster(JSON.stringify({ settings: { goalLevel } }));
    assert.equal(r.roster.settings.goalLevel, 60, String(goalLevel));
    assert.equal(r.warnings.length, 1);
  }
  assert.equal(parseRoster(JSON.stringify({ settings: { title: 5 } })).roster.settings.title, DEFAULT_SETTINGS.title);
  assert.equal(parseRoster(JSON.stringify({ settings: 'x' })).warnings.length, 0);
  const g = parseRoster(JSON.stringify({ settings: { guilds: [{ region: 'zz', slug: 'a' }, { region: 'eu', slug: '' }, 3, { region: 'us', slug: 'b' }] } }));
  assert.deepEqual(g.roster.settings.guilds, [{ region: 'us', slug: 'b' }]);
  assert.equal(g.warnings.length, 1);
  assert.deepEqual(parseRoster('{"settings":{"guilds":"x"}}').roster.settings.guilds, []);
});

test('serializeRoster: format, omitted fields, unknown keys and round trip', () => {
  const input = {
    version: 1,
    comment: 'kept',
    settings: { title: 'T', goalLevel: 30, xpTable: [100], note: { a: 1 } },
    players: [entry('Joe', 'Gun', { label: 'Max', addedAt: NOW }), entry('Ana', 'Lys')],
  };
  const { roster } = parseRoster(JSON.stringify(input));
  const text = serializeRoster(roster);
  assert.ok(text.endsWith('}\n') && !text.endsWith('\n\n'));
  const out = JSON.parse(text);
  assert.deepEqual(Object.keys(out), ['version', 'settings', 'players', 'comment']);
  assert.deepEqual(out.players, [entry('Joe', 'Gun', { label: 'Max', addedAt: NOW }), entry('Ana', 'Lys')]);
  assert.deepEqual(out.settings, input.settings);
  assert.equal(out.comment, 'kept');
  assert.equal(text, `${JSON.stringify(out, null, 2)}\n`, '2-space indentation');
  assert.equal(serializeRoster(parseRoster(text).roster), text, 'stable round trip');
});

test('serializeRoster: works on an empty roster and drops label when null', () => {
  const { roster } = parseRoster('');
  assert.deepEqual(JSON.parse(serializeRoster(roster)), { version: 1, settings: DEFAULT_SETTINGS, players: [] });
  const r = add(roster, { label: '' }).roster;
  assert.ok(!('label' in JSON.parse(serializeRoster(r)).players[0]));
});

test('applyOp add: appends with normalised names, label and timestamp', () => {
  const base = rosterOf([]);
  const res = add(base, { name: 'jOE', surname: 'gUN', label: ' Max ' });
  assert.equal(res.changed, true);
  assert.equal(res.message, 'roster: + Joe Gun (EU)');
  assert.deepEqual(res.roster.players, [
    { id: 'eu:joe-gun', region: 'eu', slug: 'joe-gun', name: 'Joe', surname: 'Gun', label: 'Max', addedAt: NOW },
  ]);
  assert.equal(base.players.length, 0, 'input roster is not mutated');
  assert.equal(add(base, { region: 'kr' }).message, 'roster: + Joe Gun (KR)');
  assert.equal(add(base, { label: undefined }).roster.players[0].label, null);
});

test('applyOp add: duplicates and label updates', () => {
  const base = add(rosterOf([])).roster;
  const same = add(base);
  assert.equal(same.changed, false);
  assert.equal(same.roster, base);
  assert.equal(add(base, { name: 'JOE', surname: 'gun' }).changed, false, 'same id after normalisation');
  assert.equal(add(base, { region: 'us' }).changed, true, 'other region is another character');

  const labelled = add(base, { label: 'Max' });
  assert.equal(labelled.changed, true);
  assert.equal(labelled.message, 'roster: ~ Joe Gun (EU)');
  assert.equal(labelled.roster.players[0].label, 'Max');
  assert.equal(labelled.roster.players[0].addedAt, NOW);
  assert.equal(add(labelled.roster, { label: 'Max' }).changed, false, 'same label');
  assert.equal(add(labelled.roster, { label: '' }).changed, false, 'empty label never clears');
  assert.equal(add(labelled.roster, { label: 'Autre' }).roster.players[0].label, 'Autre');
});

test('applyOp add: refuses past the limit but still allows label updates', () => {
  const players = Array.from({ length: 50 }, (_, i) => entry('Joe', `N${'abcdefghijklmnopqrstuvwxyz'[i % 26]}${'ab'[Math.floor(i / 26)]}x`));
  const full = rosterOf(players);
  assert.equal(full.players.length, 50);
  assert.throws(() => add(full), (e) => e instanceof RosterError && /50/.test(e.message));
  assert.equal(add(full, { surname: players[0].surname, label: 'x' }).changed, true);
});

test('applyOp remove', () => {
  const base = rosterOf([entry('Joe', 'Gun'), entry('Ana', 'Lys')]);
  const res = applyOp(base, { op: 'remove', region: 'eu', name: 'joe', surname: 'GUN' }, NOW);
  assert.equal(res.changed, true);
  assert.equal(res.message, 'roster: − Joe Gun (EU)');
  assert.deepEqual(res.roster.players.map((p) => p.id), ['eu:ana-lys']);
  assert.equal(base.players.length, 2, 'input roster is not mutated');

  const again = applyOp(res.roster, { op: 'remove', region: 'eu', name: 'Joe', surname: 'Gun' }, NOW);
  assert.equal(again.changed, false, 'idempotent');
  assert.equal(applyOp(base, { op: 'remove', region: 'us', name: 'Joe', surname: 'Gun' }, NOW).changed, false);
});

test('applyOp: invalid input throws RosterError with a French message', () => {
  const base = rosterOf([]);
  const bads = [
    { op: 'frobnicate', region: 'eu', name: 'Joe', surname: 'Gun' },
    { op: 'add', region: 'xx', name: 'Joe', surname: 'Gun' },
    { op: 'add', region: undefined, name: 'Joe', surname: 'Gun' },
    { op: 'add', region: 'eu', name: '', surname: 'Gun' },
    { op: 'add', region: 'eu', name: 'J', surname: 'Gun' },
    { op: 'add', region: 'eu', name: 'Joe', surname: 'Gun 2' },
    { op: 'add', region: 'eu', name: 'Joe', surname: 'Abcdefghijklm' },
    { op: 'remove', region: 'eu', name: 'Joe', surname: '' },
    { op: 'remove', region: 'EU', name: 'Joe', surname: 'Gun' },
    null,
  ];
  for (const op of bads) {
    assert.throws(() => applyOp(base, op, NOW), (e) => e instanceof RosterError && e.message.length > 5, JSON.stringify(op));
  }
  assert.match(
    (() => { try { add(base, { name: '' }); } catch (e) { return e.message; } return ''; })(),
    /principal.*obligatoire/,
  );
});

test('validateEditPayload', () => {
  const iv = 'A'.repeat(16);
  const ct = 'b_-9'.repeat(10);
  assert.deepEqual(validateEditPayload(JSON.stringify({ iv, ct })), { iv, ct });
  assert.deepEqual(validateEditPayload(JSON.stringify({ iv, ct: 'c'.repeat(4000) })).ct.length, 4000);
  const bads = [
    '', 'nope', 'null', '[]', '"x"', '{}',
    JSON.stringify({ iv }),
    JSON.stringify({ ct }),
    JSON.stringify({ iv, ct, extra: 'x' }),
    JSON.stringify({ iv: 'A'.repeat(15), ct }),
    JSON.stringify({ iv: 'A'.repeat(17), ct }),
    JSON.stringify({ iv, ct: 'c'.repeat(39) }),
    JSON.stringify({ iv, ct: 'c'.repeat(4001) }),
    JSON.stringify({ iv: `${'A'.repeat(15)}=`, ct }),
    JSON.stringify({ iv, ct: `${'c'.repeat(39)}+` }),
    JSON.stringify({ iv, ct: `${'c'.repeat(39)} ` }),
    JSON.stringify({ iv: 123, ct }),
    JSON.stringify({ iv, ct: [ct] }),
  ];
  for (const bad of bads) {
    assert.throws(() => validateEditPayload(bad), RosterError, bad.slice(0, 60));
  }
});

// --- scripts/roster.mjs through a real child process ---------------------------------------------

let tmp;
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wft-'));
});
after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const CLI = path.join(ROOT, 'scripts', 'roster.mjs');

function runCli(dir, vars) {
  const env = {
    ...process.env,
    TRACKER_ROSTER_FILE: path.join(dir, 'players.json'),
    TRACKER_EDIT_FILE: path.join(dir, 'site', 'edit.json'),
    ROSTER_MESSAGE_FILE: path.join(dir, 'message.txt'),
    TRACKER_NOW: '2026-11-10T18:00:00.456Z',
    OP: '', REGION: '', NAME: '', SURNAME: '', LABEL: '', PAYLOAD: '',
    ...vars,
  };
  const r = spawnSync(process.execPath, [CLI], { env, encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n');
  return { code: r.status, stdout: r.stdout, last: lines[lines.length - 1], stderr: r.stderr };
}

const freshDir = () => fs.mkdtempSync(path.join(tmp, 'case-'));
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');

test('cli add: creates the file, writes the message, then is idempotent', () => {
  const dir = freshDir();
  const r = runCli(dir, { OP: 'add', REGION: 'eu', NAME: 'joe', SURNAME: 'GUN', LABEL: 'Max' });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.last, 'MESSAGE=roster: + Joe Gun (EU)');
  assert.equal(read(dir, 'message.txt'), 'roster: + Joe Gun (EU)\n');
  const saved = JSON.parse(read(dir, 'players.json'));
  assert.deepEqual(saved.players, [{ region: 'eu', name: 'Joe', surname: 'Gun', label: 'Max', addedAt: '2026-11-10T18:00:00Z' }]);

  fs.rmSync(path.join(dir, 'message.txt'));
  const before = read(dir, 'players.json');
  const again = runCli(dir, { OP: 'add', REGION: 'eu', NAME: 'Joe', SURNAME: 'Gun' });
  assert.equal(again.code, 0);
  assert.equal(again.last, 'MESSAGE=');
  assert.equal(fs.existsSync(path.join(dir, 'message.txt')), false, 'no message file when nothing changed');
  assert.equal(read(dir, 'players.json'), before);
});

test('cli add: without ROSTER_MESSAGE_FILE still works; region is case-insensitive; unknown keys survive', () => {
  const dir = freshDir();
  fs.writeFileSync(path.join(dir, 'players.json'), JSON.stringify({ version: 1, settings: { title: 'X', goalLevel: 30, keep: true }, players: [], other: 1 }));
  const r = runCli(dir, { OP: 'add', REGION: 'US', NAME: 'Ana', SURNAME: 'Lys', ROSTER_MESSAGE_FILE: '' });
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.last, 'MESSAGE=roster: + Ana Lys (US)');
  const saved = JSON.parse(read(dir, 'players.json'));
  assert.equal(saved.other, 1);
  assert.deepEqual(saved.settings, { title: 'X', goalLevel: 30, keep: true });
  assert.equal(fs.existsSync(path.join(dir, 'message.txt')), false);
});

test('cli remove', () => {
  const dir = freshDir();
  runCli(dir, { OP: 'add', REGION: 'eu', NAME: 'Joe', SURNAME: 'Gun' });
  const r = runCli(dir, { OP: 'remove', REGION: 'eu', NAME: 'joe', SURNAME: 'gun' });
  assert.equal(r.code, 0);
  assert.equal(r.last, 'MESSAGE=roster: − Joe Gun (EU)');
  assert.equal(read(dir, 'message.txt'), 'roster: − Joe Gun (EU)\n');
  assert.deepEqual(JSON.parse(read(dir, 'players.json')).players, []);
  const again = runCli(dir, { OP: 'remove', REGION: 'eu', NAME: 'Joe', SURNAME: 'Gun' });
  assert.equal(again.code, 0);
  assert.equal(again.last, 'MESSAGE=');
});

test('cli set-edit-key: writes edit.json and never prints the payload', () => {
  const dir = freshDir();
  const payload = JSON.stringify({ iv: 'A'.repeat(16), ct: 'secretCipher_-0'.repeat(4) });
  const r = runCli(dir, { OP: 'set-edit-key', PAYLOAD: payload });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.last, 'MESSAGE=config: lien de modification');
  assert.equal(read(dir, 'message.txt'), 'config: lien de modification\n');
  const text = read(dir, path.join('site', 'edit.json'));
  assert.ok(text.endsWith('}\n'));
  assert.deepEqual(JSON.parse(text), {
    v: 1, alg: 'A256GCM', iv: 'A'.repeat(16), ct: 'secretCipher_-0'.repeat(4), createdAt: '2026-11-10T18:00:00Z',
  });
  assert.ok(!r.stdout.includes('secretCipher') && !r.stderr.includes('secretCipher'));

  const bad = runCli(dir, { OP: 'set-edit-key', PAYLOAD: 'secretCipher not json' });
  assert.equal(bad.code, 2);
  assert.ok(!bad.stdout.includes('secretCipher') && !bad.stderr.includes('secretCipher'));
});

test('cli: invalid input gives ::error:: and exit code 2, files untouched', () => {
  const dir = freshDir();
  const cases = [
    { OP: 'add', REGION: 'eu', NAME: 'J', SURNAME: 'Gun' },
    { OP: 'add', REGION: 'xx', NAME: 'Joe', SURNAME: 'Gun' },
    { OP: 'add', REGION: 'eu', NAME: 'Joe', SURNAME: '' },
    { OP: 'set-edit-key', PAYLOAD: '{}' },
    { OP: 'sync' },
    { OP: '' },
    { OP: 'add', REGION: 'eu', NAME: 'Joe', SURNAME: 'Gun', TRACKER_NOW: 'garbage' },
  ];
  for (const vars of cases) {
    const r = runCli(dir, vars);
    assert.equal(r.code, 2, JSON.stringify(vars) + r.stdout + r.stderr);
    assert.match(r.last, /^::error::\S/);
    assert.ok(!r.stdout.includes('MESSAGE='));
  }
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('cli: refuses to rewrite an unreadable players.json', () => {
  const dir = freshDir();
  fs.writeFileSync(path.join(dir, 'players.json'), '{ "players": [ broken');
  const r = runCli(dir, { OP: 'add', REGION: 'eu', NAME: 'Joe', SURNAME: 'Gun' });
  assert.equal(r.code, 2);
  assert.match(r.last, /^::error::players\.json est illisible/);
  assert.equal(read(dir, 'players.json'), '{ "players": [ broken');
});

test('cli: warns about skipped entries and drops them on rewrite', () => {
  const dir = freshDir();
  fs.writeFileSync(path.join(dir, 'players.json'), JSON.stringify({ players: [{ region: 'eu', name: 'x', surname: 'y' }] }));
  const r = runCli(dir, { OP: 'add', REGION: 'eu', NAME: 'Joe', SURNAME: 'Gun' });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /::warning::Entrée n°1/);
  assert.equal(JSON.parse(read(dir, 'players.json')).players.length, 1);
});
