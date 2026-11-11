import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLASSES,
  LABEL_MAX,
  MAX_PLAYERS,
  NAME_RE,
  REGIONS,
  UNKNOWN_CLASS_COLOR,
  alternateImageUrl,
  armorySearchUrl,
  armoryUrl,
  classColor,
  classIconUrl,
  cleanLabel,
  normalizeName,
  parseCharacterInput,
  playerId,
  professionName,
  safeImageUrl,
  slugOf,
  validateName,
  wowheadItemUrl,
} from '../../site/assets/shared.js';

test('constants', () => {
  assert.deepEqual(REGIONS, ['eu', 'us', 'kr', 'tw']);
  assert.equal(MAX_PLAYERS, 50);
  assert.equal(LABEL_MAX, 24);
});

test('professionName translates the English names the API sends and keeps the others', () => {
  // The three names the real API returned for the first tracked character.
  assert.equal(professionName('Herbalism'), 'Herboristerie');
  assert.equal(professionName('Cooking'), 'Cuisine');
  assert.equal(professionName('First Aid'), 'Secourisme');
  assert.equal(professionName('Leatherworking'), 'Travail du cuir');
  assert.equal(professionName('Herboristerie'), 'Herboristerie');
  assert.equal(professionName('Nouveau métier'), 'Nouveau métier');
  assert.equal(professionName('constructor'), 'constructor');
});

test('normalizeName: case, accents, NFC, trimming', () => {
  assert.equal(normalizeName('  jOE '), 'Joe');
  assert.equal(normalizeName('éLÉA'), 'Éléa');
  assert.equal(normalizeName('éléa'), 'Éléa', 'decomposed accent is composed');
  assert.equal(normalizeName(''), '');
  assert.equal(normalizeName(null), '');
  assert.equal(normalizeName(undefined), '');
});

test('validateName', () => {
  assert.equal(validateName('Joe'), null);
  assert.equal(validateName('élodie'), null);
  assert.equal(validateName('Ab'), null);
  assert.equal(validateName('Abcdefghijkl'), null, '12 letters');
  assert.match(validateName(''), /obligatoire/);
  assert.match(validateName('   ', 'Le nom'), /^Le nom est obligatoire/);
  assert.match(validateName('A'), /2 à 12 lettres/);
  assert.match(validateName('Abcdefghijklm'), /2 à 12 lettres/, '13 letters');
  assert.match(validateName('Jo e'), /2 à 12 lettres/);
  assert.match(validateName('Joe1'), /2 à 12 lettres/);
  assert.match(validateName('Jo-e'), /2 à 12 lettres/);
  assert.ok(NAME_RE.test('Ünal'));
});

test('slugOf and playerId keep accents and lower-case everything', () => {
  assert.equal(slugOf('joe', 'GUN'), 'joe-gun');
  assert.equal(slugOf('Éléa', 'Brûle'), 'éléa-brûle');
  assert.equal(playerId('eu', 'Joe', 'Gun'), 'eu:joe-gun');
});

test('cleanLabel', () => {
  assert.equal(cleanLabel('  Max  '), 'Max');
  assert.equal(cleanLabel(''), null);
  assert.equal(cleanLabel('   '), null);
  assert.equal(cleanLabel(null), null);
  assert.equal(cleanLabel('a\tb\nc'), 'a b c');
  assert.equal(cleanLabel('a\u0000b'), 'a b', 'control characters become spaces');
  assert.equal(cleanLabel('x'.repeat(40)), 'x'.repeat(24));
  assert.equal(cleanLabel(`${'x'.repeat(23)} yyyy`), 'x'.repeat(23), 'no trailing space after truncation');
  assert.equal(Array.from(cleanLabel('😀'.repeat(30))).length, 24, 'counts characters, not UTF-16 units');
});

test('parseCharacterInput: plain text forms', () => {
  assert.deepEqual(parseCharacterInput('Joe Gun'), { name: 'Joe', surname: 'Gun' });
  assert.deepEqual(parseCharacterInput('  joe   GUN '), { name: 'Joe', surname: 'Gun' });
  assert.deepEqual(parseCharacterInput('joe-gun'), { name: 'Joe', surname: 'Gun' });
  assert.deepEqual(parseCharacterInput('joe_gun'), { name: 'Joe', surname: 'Gun' });
  assert.deepEqual(parseCharacterInput('éléa-brûle'), { name: 'Éléa', surname: 'Brûle' });
});

test('parseCharacterInput: armory URL gives the region too', () => {
  const url = 'https://worldofwarcraft.blizzard.com/fr-fr/forever/eu/armory/character/aldric-ventor';
  assert.deepEqual(parseCharacterInput(url), { name: 'Aldric', surname: 'Ventor', region: 'eu' });
  assert.deepEqual(parseCharacterInput(`${url}?x=1#top`), { name: 'Aldric', surname: 'Ventor', region: 'eu' });
  assert.deepEqual(
    parseCharacterInput('https://worldofwarcraft.blizzard.com/en-us/forever/US/armory/character/%C3%A9l%C3%A9a-br%C3%BBle'),
    { name: 'Éléa', surname: 'Brûle', region: 'us' },
  );
  assert.deepEqual(parseCharacterInput(armoryUrl('tw', 'éléa-brûle')), { name: 'Éléa', surname: 'Brûle', region: 'tw' });
});

test('parseCharacterInput: unknown region is dropped, malformed escapes survive, bad input is null', () => {
  assert.deepEqual(
    parseCharacterInput('https://x.test/forever/zz/armory/character/joe-gun'),
    { name: 'Joe', surname: 'Gun' },
  );
  assert.deepEqual(
    parseCharacterInput('https://x.test/forever/eu/armory/character/joe-gun%E0%A4%A'),
    { name: 'Joe', surname: 'Gun%e0%a4%a', region: 'eu' },
    'kept raw; validateName rejects it later',
  );
  for (const bad of ['', '   ', null, undefined, 'Joe', 'Joe Gun Third', '---']) {
    assert.equal(parseCharacterInput(bad), null, String(bad));
  }
});

test('URL builders', () => {
  assert.equal(
    armoryUrl('eu', 'aldric-ventor'),
    'https://worldofwarcraft.blizzard.com/fr-fr/forever/eu/armory/character/aldric-ventor',
  );
  assert.equal(
    armoryUrl('eu', 'éléa-brûle'),
    'https://worldofwarcraft.blizzard.com/fr-fr/forever/eu/armory/character/%C3%A9l%C3%A9a-br%C3%BBle',
  );
  assert.equal(
    armorySearchUrl('us', 'Joe', 'Gun'),
    'https://worldofwarcraft.blizzard.com/fr-fr/forever/us/armory?q=Joe%20Gun',
  );
  assert.equal(wowheadItemUrl(17767), 'https://www.wowhead.com/forever/fr/item=17767');
  assert.equal(wowheadItemUrl('1/2'), 'https://www.wowhead.com/forever/fr/item=1%2F2');
});

test('class helpers', () => {
  assert.equal(classColor(2), CLASSES[2].color);
  assert.equal(classColor(6), UNKNOWN_CLASS_COLOR, 'there is no class 6 in the table');
  assert.equal(classColor(undefined), UNKNOWN_CLASS_COLOR);
  assert.equal(classIconUrl(2), 'https://render.worldofwarcraft.com/us/icons/56/classicon_paladin.jpg');
  assert.equal(classIconUrl(99), null);
});

test('safeImageUrl accepts only https on the render host', () => {
  const ok = 'https://render.worldofwarcraft.com/forever-eu/icons/56/133762.jpg';
  assert.equal(safeImageUrl(ok), ok);
  for (const bad of [
    'http://render.worldofwarcraft.com/x.jpg',
    'https://evil.example/x.jpg',
    'https://render.worldofwarcraft.com.evil.example/x.jpg',
    'https://user@evil.example/x.jpg',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    '//render.worldofwarcraft.com/x.jpg',
    '',
    null,
    undefined,
    42,
  ]) {
    assert.equal(safeImageUrl(bad), null, String(bad));
  }
});

test('alternateImageUrl swaps the regional prefix', () => {
  assert.equal(
    alternateImageUrl('https://render.worldofwarcraft.com/forever-eu/icons/56/1.jpg'),
    'https://render.worldofwarcraft.com/forever-us/icons/56/1.jpg',
  );
  assert.equal(
    alternateImageUrl('https://render.worldofwarcraft.com/forever-us/icons/56/1.jpg'),
    'https://render.worldofwarcraft.com/forever-eu/icons/56/1.jpg',
  );
  assert.equal(alternateImageUrl('https://render.worldofwarcraft.com/us/icons/56/1.jpg'), null);
  assert.equal(alternateImageUrl('https://evil.example/forever-eu/x.jpg'), null);
  assert.equal(alternateImageUrl(null), null);
});
