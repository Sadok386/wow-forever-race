// In-process fake of the Blizzard API, answering in the exact shapes of scripts/test/fixtures.
// Characters are generated deterministically from their slug and progress with simulated time,
// so tests are reproducible and a dev server shows level-ups happening.
import { CLASSES, FACTIONS, RACES, REGIONS, RULESETS, SLOT_ORDER, normalizeName } from '../../site/assets/shared.js';
import { CLASSIC_XP_TO_NEXT } from './xp.mjs';

const TOKEN = 'mock-token';
const GUILD = { name: 'Les Copains', slug: 'les-copains', id: 173003 };
const GUILD_FACTION = 'ALLIANCE';
const MIN_PROFILE_LEVEL = 10;
const MAX_LEVEL = 60;
// XP moves in steps of 1/20 of a level, so last_login_timestamp changes every few simulated minutes.
const XP_STEPS_PER_LEVEL = 20;

// Races by faction. Any class may be drawn whatever the race: the mock favours variety over lore.
const ALLIANCE_RACES = [1, 3, 4, 7];
const HORDE_RACES = [2, 5, 6, 8];

const CLASS_IDS = Object.keys(CLASSES).map(Number);
const SPECS = {
  1: ['Armes', 'Fureur', 'Protection'],
  2: ['Sacré', 'Protection', 'Vindicte'],
  3: ['Maîtrise des bêtes', 'Précision', 'Survie'],
  4: ['Assassinat', 'Combat', 'Finesse'],
  5: ['Discipline', 'Sacré', 'Ombre'],
  7: ['Élémentaire', 'Amélioration', 'Restauration'],
  8: ['Arcanes', 'Feu', 'Givre'],
  9: ['Affliction', 'Démonologie', 'Destruction'],
  11: ['Équilibre', 'Combat farouche', 'Restauration'],
};

const POWER_TYPES = { 1: { name: 'Rage', id: 1 }, 4: { name: 'Énergie', id: 3 } };
const MANA = { name: 'Mana', id: 0 };

const SLOT_NAMES = {
  HEAD: 'Tête', NECK: 'Cou', SHOULDER: 'Épaules', BACK: 'Dos', CHEST: 'Torse', SHIRT: 'Chemise', TABARD: 'Tabard',
  WRIST: 'Poignets', HANDS: 'Mains', WAIST: 'Taille', LEGS: 'Jambes', FEET: 'Pieds', FINGER_1: 'Doigt 1',
  FINGER_2: 'Doigt 2', TRINKET_1: 'Bijou 1', TRINKET_2: 'Bijou 2', MAIN_HAND: 'Main droite', OFF_HAND: 'Main gauche',
  RANGED: 'À distance',
};
const SLOT_NOUNS = {
  HEAD: 'Casque', NECK: 'Collier', SHOULDER: 'Épaulières', BACK: 'Cape', CHEST: 'Tunique', SHIRT: 'Chemise',
  TABARD: 'Tabard', WRIST: 'Brassards', HANDS: 'Gants', WAIST: 'Ceinture', LEGS: 'Jambières', FEET: 'Bottes',
  FINGER_1: 'Anneau', FINGER_2: 'Sceau', TRINKET_1: 'Talisman', TRINKET_2: 'Amulette', MAIN_HAND: 'Marteau',
  OFF_HAND: 'Bouclier', RANGED: 'Arc',
};
const ITEM_SUFFIXES = ['du vétéran', 'de l’aube', 'des cimes', 'du chasseur', 'de la tempête', 'du gardien', 'des marais'];
const QUALITIES = [
  { type: 'COMMON', name: 'Commun' },
  { type: 'UNCOMMON', name: 'Inhabituel' },
  { type: 'UNCOMMON', name: 'Inhabituel' },
  { type: 'RARE', name: 'Rare' },
  { type: 'EPIC', name: 'Épique' },
];
const PROFESSIONS = [
  { id: 186, name: 'Minage' }, { id: 164, name: 'Forge' }, { id: 182, name: 'Herboristerie' },
  { id: 171, name: 'Alchimie' }, { id: 393, name: 'Dépeçage' }, { id: 165, name: 'Travail du cuir' },
  { id: 197, name: 'Couture' }, { id: 202, name: 'Ingénierie' }, { id: 333, name: 'Enchantement' },
];
const SECONDARIES = [{ id: 129, name: 'Secourisme' }, { id: 185, name: 'Cuisine' }, { id: 356, name: 'Pêche' }];

/** 32-bit FNV-1a followed by a murmur3 finalizer: FNV alone leaves the low bits too correlated for modulo picks. */
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const pick = (list, h) => list[h % list.length];
const nameKey = (type, id) => ({ key: { href: `https://mock.invalid/${type}/${id}` }, id });

function nameParts(slug) {
  const i = slug.indexOf('-');
  if (i < 1 || i === slug.length - 1) return null;
  return { name: normalizeName(slug.slice(0, i)), surname: normalizeName(slug.slice(i + 1)) };
}

function generateCharacter(region, slug, parts) {
  const h = hash(slug);
  // A guild is one faction; characters outside it are free.
  const inGuild = !slug.startsWith('solo');
  const faction = inGuild ? GUILD_FACTION : h % 2 ? 'HORDE' : 'ALLIANCE';
  const raceId = pick(faction === 'HORDE' ? HORDE_RACES : ALLIANCE_RACES, h >>> 3);
  const gender = (h >>> 5) % 2 ? 'FEMALE' : 'MALE';
  const startLevel = slug.startsWith('debutant') ? 6 : 10 + (hash(`${slug}#start`) % 36);
  return {
    region,
    slug,
    ...parts,
    hash: h,
    id: 4_200_000 + (h % 90_000),
    faction,
    raceId,
    classId: pick(CLASS_IDS, hash(`${slug}#class`) >>> 8),
    gender,
    rulesetId: (h >>> 7) % 2 ? 1 : 2,
    startLevel,
    // Levels gained per simulated hour: at speed 60 that is one level every 30 to 75 real seconds.
    pace: 0.8 + (hash(`${slug}#pace`) % 13) / 10,
    inGuild,
  };
}

function progress(ch, nowMs, startedAt, speed) {
  const simulatedHours = (Math.max(0, nowMs - startedAt) / 1000 / 3600) * speed;
  const reached = Math.min(MAX_LEVEL, Math.floor((ch.startLevel + simulatedHours * ch.pace) * XP_STEPS_PER_LEVEL) / XP_STEPS_PER_LEVEL);
  const level = Math.floor(reached);
  const xp = level >= MAX_LEVEL ? 0 : Math.floor((reached - level) * CLASSIC_XP_TO_NEXT[level - 1]);
  const simulatedSeconds = ((reached - ch.startLevel) / ch.pace) * 3600;
  const lastLogin = Math.floor((startedAt + (simulatedSeconds / speed) * 1000) / 1000) * 1000;
  return { level, xp, lastLogin };
}

function gearOf(ch, level) {
  const slots = SLOT_ORDER.filter((s) => s !== 'SHIRT' && s !== 'TABARD')
    .sort((a, b) => hash(`${ch.slug}#slot${a}`) - hash(`${ch.slug}#slot${b}`))
    .slice(0, 8 + (ch.hash % 7))
    .sort((a, b) => SLOT_ORDER.indexOf(a) - SLOT_ORDER.indexOf(b));
  return slots.map((slot) => {
    const h = hash(`${ch.slug}#${slot}`);
    const itemId = 1000 + (h % 60_000);
    const ilvl = Math.max(1, Math.round(level * 0.9) + (h % 5) - 2);
    const quality = pick(QUALITIES, h >>> 4);
    const item = {
      item: nameKey('item', itemId),
      slot: { type: slot, name: SLOT_NAMES[slot] },
      quantity: 1,
      quality,
      name: `${SLOT_NOUNS[slot]} ${pick(ITEM_SUFFIXES, h >>> 8)}`,
      media: nameKey('media/item', itemId),
      level: { value: ilvl, display_string: `Niveau d'objet ${ilvl}` },
    };
    if (h % 5 === 0 && quality.type !== 'COMMON') {
      item.enchantments = [{ display_string: `Enchanté : Endurance +${1 + (h % 6)}`, enchantment_id: 2000 + (h % 500) }];
    }
    return item;
  });
}

function statsOf(ch, level, gearCount) {
  const stat = (salt) => {
    const effective = Math.round(10 + level * (0.5 + (hash(`${ch.slug}#${salt}`) % 10) / 10));
    return { base: effective - 4, effective };
  };
  const stamina = stat('stamina');
  const intellect = stat('intellect');
  const powerType = POWER_TYPES[ch.classId] ?? MANA;
  return {
    health: 60 + level * 38 + stamina.effective * 10,
    power: powerType === MANA ? 50 + level * 14 + intellect.effective * 5 : 100,
    power_type: { key: { href: 'https://mock.invalid/power-type' }, name: powerType.name, id: powerType.id },
    strength: stat('strength'),
    agility: stat('agility'),
    intellect,
    stamina,
    spirit: stat('spirit'),
    armor: { base: 40 + level * 18, effective: 50 + level * 20 + gearCount * 12 },
  };
}

function talentsOf(ch, level) {
  const weights = SPECS[ch.classId].map((_, i) => 1 + (hash(`${ch.slug}#talent${i}`) % 5));
  const total = Math.max(0, level - 9);
  const sum = weights.reduce((a, b) => a + b, 0);
  const points = weights.map((w) => Math.floor((total * w) / sum));
  points[0] += total - points.reduce((a, b) => a + b, 0);
  return points;
}

function professionsOf(ch, level) {
  const first = ch.hash % PROFESSIONS.length;
  const second = (first + 1 + (hash(`${ch.slug}#prof`) % (PROFESSIONS.length - 1))) % PROFESSIONS.length;
  const max = level < 10 ? 75 : level < 25 ? 150 : level < 40 ? 225 : 300;
  const entry = (p, salt) => ({
    profession: { ...nameKey('profession', p.id), name: p.name },
    tiers: [{ skill_points: Math.min(max, 1 + level * 5 + (hash(`${ch.slug}#${salt}`) % 10)), max_skill_points: max, tier: { name: p.name, id: p.id * 10 } }],
  });
  return {
    primaries: [entry(PROFESSIONS[first], 'p1'), entry(PROFESSIONS[second], 'p2')],
    secondaries: [entry(SECONDARIES[0], 's1'), entry(SECONDARIES[1 + (ch.hash % 2)], 's2')],
  };
}

const characterRef = (ch) => ({
  key: { href: `https://mock.invalid/profile/wow/character/${encodeURIComponent(ch.slug)}` },
  name: ch.name,
  id: ch.id,
  surname: ch.surname,
  slug: ch.slug,
});

function sheet(ch, kind, level, state) {
  const base = { _links: { self: { href: `https://mock.invalid/${kind}` } } };
  const withCharacter = { ...base, character: characterRef(ch) };
  const gear = gearOf(ch, level);
  switch (kind) {
    case 'profile': {
      const ilvls = gear.map((g) => g.level.value);
      const ilvl = Math.round(ilvls.reduce((a, b) => a + b, 0) / ilvls.length);
      return {
        ...base,
        id: ch.id,
        name: ch.name,
        gender: { type: ch.gender, name: ch.gender === 'MALE' ? 'Homme' : 'Femme' },
        faction: { type: ch.faction, name: FACTIONS[ch.faction] },
        race: { ...nameKey('playable-race', ch.raceId), name: RACES[ch.raceId] },
        character_class: { ...nameKey('playable-class', ch.classId), name: CLASSES[ch.classId].name },
        level,
        experience: state.xp,
        achievement_points: level * 2 + (ch.hash % 20),
        last_login_timestamp: state.lastLogin,
        average_item_level: ilvl + 1,
        equipped_item_level: ilvl,
        is_remix: false,
        surname: ch.surname,
        ruleset: { ...nameKey('ruleset', ch.rulesetId), name: RULESETS[ch.rulesetId] },
        name_search: `${ch.name} ${ch.surname}`,
        ...(ch.inGuild && {
          guild: { ...nameKey('guild', GUILD.slug), name: GUILD.name, id: GUILD.id, faction: { type: ch.faction, name: FACTIONS[ch.faction] }, slug: GUILD.slug },
        }),
      };
    }
    case 'equipment':
      return { ...withCharacter, equipped_items: gear };
    case 'character-media': {
      const dir = `https://render.worldofwarcraft.com/forever-${ch.region}/character/${ch.id % 256}/${ch.id}`;
      return {
        ...withCharacter,
        assets: [
          { key: 'main-raw', value: `${dir}-main-raw.png` },
          { key: 'avatar', value: `${dir}-avatar.jpg` },
        ],
      };
    }
    case 'professions':
      return { ...withCharacter, ...professionsOf(ch, level) };
    case 'statistics':
      return { ...base, ...statsOf(ch, level, gear.length), character: characterRef(ch) };
    case 'specializations': {
      const points = talentsOf(ch, level);
      return {
        ...withCharacter,
        specialization_groups: [
          {
            is_active: true,
            specializations: SPECS[ch.classId].map((name, i) => ({
              specialization: { ...nameKey('playable-specialization', ch.classId * 10 + i), name },
              specialization_name: name,
              spent_points: points[i],
            })),
          },
          { is_active: false },
        ],
      };
    }
    default:
      return null;
  }
}

const SUB_RESOURCES = new Set(['equipment', 'character-media', 'professions', 'statistics', 'specializations']);

const NOT_FOUND = { code: 404, type: 'BLZWEBAPI00000404', detail: 'Not Found' };
const FORBIDDEN = { code: 403, type: 'BLZWEBAPI00000403', detail: 'Forbidden' };

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json;charset=utf-8' });
  res.end(JSON.stringify(body));
}

function itemIcon(itemId) {
  return `https://render.worldofwarcraft.com/forever-eu/icons/56/${130_000 + ((itemId * 7919) % 30_000)}.jpg`;
}

export function createMockBlizzard({ now = () => Date.now(), startedAt = Date.now(), speed = 1 } = {}) {
  // Slugs asked about so far, per region: the guild roster lists exactly these.
  const registry = new Map(REGIONS.map((r) => [r, new Set()]));

  const stateOf = (ch) => progress(ch, now(), startedAt, speed);

  function guildRoster(region) {
    const members = [...registry.get(region)].flatMap((slug) => {
      const ch = generateCharacter(region, slug, nameParts(slug));
      if (!ch.inGuild) return [];
      return [{
        character: {
          key: { href: `https://mock.invalid/profile/wow/character/${encodeURIComponent(slug)}` },
          name: ch.name,
          id: ch.id,
          level: stateOf(ch).level,
          playable_class: nameKey('playable-class', ch.classId),
          playable_race: nameKey('playable-race', ch.raceId),
          faction: { type: ch.faction },
          surname: ch.surname,
          slug,
        },
        rank: ch.hash % 4,
      }];
    });
    return {
      _links: { self: { href: 'https://mock.invalid/guild/roster' } },
      guild: { ...nameKey('guild', GUILD.slug), name: GUILD.name, id: GUILD.id, faction: { type: 'ALLIANCE', name: 'Alliance' }, slug: GUILD.slug },
      members,
    };
  }

  function character(res, region, slug, sub) {
    const parts = nameParts(slug);
    if (!parts || slug.startsWith('inconnu')) return send(res, 404, NOT_FOUND);
    if (slug.startsWith('erreur')) return send(res, 500, { code: 500, type: 'BLZWEBAPI00000500', detail: 'Internal Server Error' });
    registry.get(region).add(slug);
    const ch = generateCharacter(region, slug, parts);
    const state = stateOf(ch);
    const kind = sub || 'profile';
    const unavailable = state.level < MIN_PROFILE_LEVEL || (kind === 'character-media' && slug.startsWith('sansimage'));
    if (unavailable || (kind !== 'profile' && !SUB_RESOURCES.has(kind))) return send(res, 404, NOT_FOUND);
    return send(res, 200, sheet(ch, kind, state.level, state));
  }

  function itemMedia(res, rawId) {
    const itemId = Number(rawId);
    if (!Number.isInteger(itemId) || itemId <= 0 || itemId % 7 === 0) return send(res, 404, NOT_FOUND);
    return send(res, 200, {
      _links: { self: { href: `https://mock.invalid/media/item/${itemId}` } },
      assets: [{ key: 'icon', value: itemIcon(itemId), file_data_id: 130_000 + ((itemId * 7919) % 30_000) }],
      id: itemId,
    });
  }

  async function handle(req, res, prefix = '') {
    const url = new URL(req.url, 'http://mock.invalid');
    if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) return false;
    let segments;
    try {
      segments = url.pathname.slice(prefix.length).split('/').filter(Boolean).map(decodeURIComponent);
    } catch {
      res.writeHead(404).end();
      return true;
    }
    req.resume();

    if (req.method === 'POST' && segments.join('/') === 'oauth/token') {
      if (!/^Basic\s+\S+/.test(req.headers.authorization ?? '')) {
        send(res, 401, { error: 'invalid_client', error_description: 'Client authentication failed' });
      } else {
        send(res, 200, { access_token: TOKEN, token_type: 'bearer', expires_in: 86399 });
      }
      return true;
    }

    const [region, ...rest] = segments;
    const route = rest.join('/');
    const isCharacter = route.startsWith('profile/wow/character/') && req.method === 'GET';
    const isItem = /^data\/wow\/media\/item\/[^/]+$/.test(route) && req.method === 'GET';
    const isGuild = /^data\/wow\/guild\/[^/]+\/roster$/.test(route) && req.method === 'GET';
    if (!REGIONS.includes(region) || !(isCharacter || isItem || isGuild)) {
      // What the real gateway does with a path it does not route: nothing to say.
      res.writeHead(404).end();
      return true;
    }

    const authorization = req.headers.authorization;
    if (!authorization) {
      res.writeHead(404).end();
      return true;
    }
    if (authorization !== `Bearer ${TOKEN}`) {
      send(res, 401, { error: 'invalid_token', error_description: 'Invalid access token' });
      return true;
    }
    const namespace = url.searchParams.get('namespace');
    if (namespace !== `${isItem ? 'static' : 'profile'}-forever-${region}`) {
      send(res, 403, FORBIDDEN);
      return true;
    }

    const args = rest.slice(isItem ? 4 : 3).map((s) => s.normalize('NFC'));
    if (isItem) itemMedia(res, args[0]);
    else if (isGuild) {
      if (args[0].toLowerCase() === GUILD.slug) send(res, 200, guildRoster(region));
      else send(res, 404, NOT_FOUND);
    } else character(res, region, args[0].toLowerCase(), args[1]);
    return true;
  }

  return { handle };
}
