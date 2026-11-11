import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loc,
  normalizeEquipment,
  normalizeItemMedia,
  normalizeMedia,
  normalizeProfessions,
  normalizeProfile,
  normalizeRoster,
  normalizeStatistics,
  normalizeTalents,
} from '../lib/normalize.mjs';
import { createMockBlizzard } from '../lib/mock-blizzard.mjs';
import { characterPath, profileNamespace, staticNamespace } from '../lib/blizzard.mjs';
import { SLOT_ORDER, safeImageUrl } from '../../site/assets/shared.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(fixturesDir, `${name}.json`), 'utf8'));

const GARBAGE = [undefined, null, 0, 'text', [], {}, [1, 2], { level: 'x' }, { members: 'x', equipped_items: 'x', assets: 'x' }];

test('loc accepts strings and locale maps', () => {
  assert.equal(loc('Paladin'), 'Paladin');
  assert.equal(loc({ en_US: 'Paladin', fr_FR: 'Paladin FR', en_GB: 'GB' }), 'Paladin FR');
  assert.equal(loc({ en_US: 'US', en_GB: 'GB' }), 'GB');
  assert.equal(loc({ en_US: 'US' }), 'US');
  assert.equal(loc({ de_DE: 'Hallo' }), 'Hallo');
  for (const v of [undefined, null, '', 5, [], {}, { fr_FR: '' }]) assert.equal(loc(v), null);
});

test('normalizeProfile on the fixture', () => {
  assert.deepEqual(normalizeProfile(fixture('profile')), {
    characterId: 4242017,
    name: 'Aldric',
    surname: 'Ventor',
    level: 27,
    xp: 18450,
    class: { id: 2, name: 'Paladin' },
    race: { id: 1, name: 'Humain' },
    gender: 'MALE',
    faction: 'ALLIANCE',
    ruleset: { id: 2, name: 'Normal' },
    guild: { name: 'Les Copains', slug: 'les-copains' },
    ilvl: 23,
    achievementPoints: 40,
    lastLoginAt: new Date(1794332746000).toISOString().replace('.000Z', 'Z'),
  });
});

test('normalizeProfile fallbacks and tolerance', () => {
  const base = fixture('profile');
  const noIlvl = normalizeProfile({ ...base, equipped_item_level: undefined });
  assert.equal(noIlvl.ilvl, 24);
  const bare = normalizeProfile({ level: 12 });
  assert.deepEqual(bare, {
    characterId: null, name: null, surname: null, level: 12, xp: null,
    class: { id: null, name: null }, race: { id: null, name: null }, gender: null, faction: null,
    ruleset: { id: null, name: null }, guild: null, ilvl: null, achievementPoints: null, lastLoginAt: null,
  });
  assert.equal(normalizeProfile({ ...base, guild: { name: 'Sans slug' } }).guild, null);
  assert.equal(normalizeProfile({ ...base, last_login_timestamp: 1e20 }).lastLoginAt, null);
  assert.equal(normalizeProfile({ ...base, last_login_timestamp: 'x' }).lastLoginAt, null);
  assert.equal(normalizeProfile({ ...base, name: { fr_FR: 'Aldric', en_US: 'Aldrick' } }).name, 'Aldric');
  for (const g of GARBAGE) assert.equal(normalizeProfile(g), null, JSON.stringify(g));
});

test('normalizeEquipment sorts by slot order and reads the enchant', () => {
  const gear = normalizeEquipment(fixture('equipment'));
  assert.deepEqual(gear.map((g) => g.slot), ['HEAD', 'BACK', 'CHEST', 'FINGER_1', 'MAIN_HAND']);
  assert.deepEqual(gear[0], {
    slot: 'HEAD', slotName: 'Tête', itemId: 17767, name: 'Couvre-chef d\'efflorescence', quality: 'RARE', ilvl: 27, enchant: null,
  });
  assert.equal(gear[2].enchant, 'Enchanté : Endurance +3 et Armure +24');
  assert.equal(gear[4].ilvl, 25);
});

test('normalizeEquipment puts unknown slots last and skips broken entries', () => {
  const item = (slot, id) => ({ item: { id }, slot: { type: slot, name: slot }, name: 'x', quality: { type: 'COMMON' } });
  const gear = normalizeEquipment({ equipped_items: [item('OFF_HAND', 1), item('WEIRD', 2), item('HEAD', 3), { slot: { type: 'HEAD' } }, null, item(undefined, 5)] });
  assert.deepEqual(gear.map((g) => g.itemId), [3, 1, 2]);
  assert.equal(gear[0].ilvl, null);
  assert.deepEqual(normalizeEquipment({ equipped_items: [] }), []);
});

test('normalizeMedia keeps only safe images', () => {
  assert.deepEqual(normalizeMedia(fixture('character-media')), {
    avatar: 'https://render.worldofwarcraft.com/forever-eu/character/97/4242017-avatar.jpg',
    render: 'https://render.worldofwarcraft.com/forever-eu/character/97/4242017-main-raw.png',
  });
  const hostile = { assets: [{ key: 'avatar', value: 'https://evil.example/a.jpg' }, { key: 'main-raw', value: 'javascript:alert(1)' }] };
  assert.deepEqual(normalizeMedia(hostile), { avatar: null, render: null });
});

test('normalizeProfessions lists primaries then secondaries', () => {
  assert.deepEqual(normalizeProfessions(fixture('professions')), [
    { name: 'Minage', skill: 116, max: 150 },
    { name: 'Forge', skill: 98, max: 150 },
    { name: 'Secourisme', skill: 80, max: 150 },
  ]);
  const flat = { primaries: [{ profession: { name: 'Pêche' }, skill_points: 5, max_skill_points: 75 }, { profession: {} }] };
  assert.deepEqual(normalizeProfessions(flat), [{ name: 'Pêche', skill: 5, max: 75 }]);
});

test('normalizeStatistics reads effective values', () => {
  assert.deepEqual(normalizeStatistics(fixture('statistics')), {
    health: 1480, power: 920, powerType: 'Mana', strength: 61, agility: 41, stamina: 74, intellect: 50, spirit: 43, armor: 1234,
  });
  assert.equal(normalizeStatistics({ armor: 99, strength: { base: 3 } }).armor, 99);
  assert.equal(normalizeStatistics({ strength: { base: 3 } }).strength, null);
});

test('normalizeTalents uses the active group, sorted by points', () => {
  assert.deepEqual(normalizeTalents(fixture('specializations')), [
    { name: 'Vindicte', points: 13 },
    { name: 'Protection', points: 5 },
  ]);
  assert.deepEqual(normalizeTalents({ specialization_groups: [{ is_active: false, specializations: [{ specialization_name: 'X', spent_points: 1 }] }] }), []);
  assert.deepEqual(
    normalizeTalents({ specialization_groups: [{ is_active: true, specializations: [{ specialization: { name: 'Feu' }, spent_points: 2 }] }] }),
    [{ name: 'Feu', points: 2 }],
  );
});

test('normalizeItemMedia', () => {
  assert.equal(normalizeItemMedia(fixture('item-media')), 'https://render.worldofwarcraft.com/forever-eu/icons/56/133762.jpg');
  const first = { assets: [{ key: 'other', value: 'https://render.worldofwarcraft.com/x.jpg' }] };
  assert.equal(normalizeItemMedia(first), 'https://render.worldofwarcraft.com/x.jpg');
  assert.equal(normalizeItemMedia({ assets: [{ key: 'icon', value: 'http://render.worldofwarcraft.com/x.jpg' }] }), null);
});

test('normalizeRoster', () => {
  const { guild, members } = normalizeRoster(fixture('guild-roster'));
  assert.deepEqual(guild, { name: 'Les Copains', slug: 'les-copains' });
  assert.deepEqual([...members.keys()], ['aldric-ventor', 'mira-solène', 'brakk-cendrepoing']);
  assert.deepEqual(members.get('mira-solène'), {
    name: 'Mira', surname: 'Solène', level: 6, classId: 8, raceId: 7, faction: 'ALLIANCE', characterId: 4250133,
  });
  const noSlug = normalizeRoster({ members: [{ character: { name: 'Léa', surname: 'Bella', level: 3 } }, { character: { name: 'X' } }] });
  assert.deepEqual([...noSlug.members.keys()], ['léa-bella']);
});

test('every normaliser tolerates garbage', () => {
  for (const g of GARBAGE) {
    assert.deepEqual(normalizeEquipment(g), []);
    assert.deepEqual(normalizeProfessions(g), []);
    assert.deepEqual(normalizeTalents(g), []);
    assert.deepEqual(normalizeMedia(g), { avatar: null, render: null });
    assert.equal(normalizeItemMedia(g), null);
    assert.equal(normalizeStatistics(g).health, null);
    const roster = normalizeRoster(g);
    assert.equal(roster.members.size, 0);
    assert.deepEqual(roster.guild, { name: null, slug: null });
  }
});

let server;
let base;

before(async () => {
  const mock = createMockBlizzard({ now: () => 1_000_000_000_000 + 3 * 3600 * 1000, startedAt: 1_000_000_000_000, speed: 1 });
  server = http.createServer(async (req, res) => {
    if (!(await mock.handle(req, res))) res.writeHead(500).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/eu`;
});
after(() => new Promise((resolve) => server.close(resolve)));

const call = async (apiPath, namespace = profileNamespace('eu')) => {
  const res = await fetch(`${base}${apiPath}?namespace=${namespace}&locale=fr_FR`, { headers: { Authorization: 'Bearer mock-token' } });
  return res.json();
};

test('normalisers accept what the mock generates', async () => {
  const slug = 'aldric-ventor';
  const profile = normalizeProfile(await call(characterPath(slug)));
  assert.ok(profile);
  assert.equal(profile.name, 'Aldric');
  assert.equal(profile.surname, 'Ventor');
  assert.ok(Number.isInteger(profile.level) && profile.level >= 10 && profile.level <= 60);
  assert.ok(profile.xp >= 0);
  assert.ok(profile.class.id && profile.class.name);
  assert.ok(profile.race.id && profile.race.name);
  assert.match(profile.gender, /^(MALE|FEMALE)$/);
  assert.match(profile.faction, /^(ALLIANCE|HORDE)$/);
  assert.deepEqual(profile.guild, { name: 'Les Copains', slug: 'les-copains' });
  assert.ok(profile.ilvl > 0);
  assert.match(profile.lastLoginAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);

  const gear = normalizeEquipment(await call(characterPath(slug, '/equipment')));
  assert.ok(gear.length >= 8 && gear.length <= 14);
  assert.deepEqual(gear.map((g) => SLOT_ORDER.indexOf(g.slot)), gear.map((g) => SLOT_ORDER.indexOf(g.slot)).sort((a, b) => a - b));
  for (const g of gear) assert.ok(g.itemId && g.name && g.quality && g.slotName && g.ilvl > 0);

  const media = normalizeMedia(await call(characterPath(slug, '/character-media')));
  assert.ok(media.avatar && media.render);

  const professions = normalizeProfessions(await call(characterPath(slug, '/professions')));
  assert.equal(professions.length, 4);
  for (const p of professions) assert.ok(p.name && p.skill > 0 && p.max >= p.skill);

  const stats = normalizeStatistics(await call(characterPath(slug, '/statistics')));
  for (const [key, value] of Object.entries(stats)) assert.notEqual(value, null, key);

  const talents = normalizeTalents(await call(characterPath(slug, '/specializations')));
  assert.equal(talents.length, 3);
  assert.equal(talents.reduce((sum, t) => sum + t.points, 0), profile.level - 9);

  const icon = normalizeItemMedia(await call('/data/wow/media/item/2316', staticNamespace('eu')));
  assert.ok(safeImageUrl(icon));

  const roster = normalizeRoster(await call('/data/wow/guild/les-copains/roster'));
  assert.deepEqual(roster.guild, { name: 'Les Copains', slug: 'les-copains' });
  assert.equal(roster.members.get(slug)?.level, profile.level);
});

test('strings from the API are single-line and free of control characters', () => {
  const dirty = 'Aldric\n::error::INJECTED\r\n\u0000x\u202e\u2028y\tz';
  assert.equal(loc(dirty), 'Aldric ::error::INJECTED x y z');
  assert.equal(loc({ en_US: 'Un\nDeux' }), 'Un Deux');
  assert.equal(loc({ fr_FR: '\n\t', en_US: 'ok' }), 'ok');
  assert.equal(loc('\n'), null);

  const profile = normalizeProfile({
    ...fixture('profile'),
    name: dirty,
    surname: 'Ven|tor',
    guild: { name: 'Gui\nlde', slug: 'gui\nlde' },
    faction: { type: 'AL\nLIANCE' },
  });
  assert.equal(profile.name, 'Aldric ::error::INJECTED x y z');
  assert.equal(profile.surname, 'Ven|tor');
  assert.deepEqual(profile.guild, { name: 'Gui lde', slug: 'gui lde' });
  assert.equal(profile.faction, 'AL LIANCE');

  const equipment = fixture('equipment');
  equipment.equipped_items[0].name = 'Casque\n::warning::x';
  equipment.equipped_items[0].enchantments = [{ display_string: 'Enchant\nement' }];
  const head = normalizeEquipment(equipment).find((g) => g.itemId === equipment.equipped_items[0].item.id);
  assert.equal(head.name, 'Casque ::warning::x');
  assert.equal(head.enchant, 'Enchant ement');

  const roster = fixture('guild-roster');
  roster.guild.name = 'Les\nCopains';
  roster.members[0].character.name = 'Al\ndric';
  const { guild, members } = normalizeRoster(roster);
  assert.equal(guild.name, 'Les Copains');
  assert.ok([...members.values()].some((m) => m.name === 'Al dric'));
  for (const m of members.values()) assert.doesNotMatch(`${m.name}${m.surname}`, /[\r\n]/);
});
