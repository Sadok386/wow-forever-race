// Rules and reference tables shared by the browser (the site) and the Node scripts.
// Pure ES module: no DOM, no Node APIs, no side effects.

export const REGIONS = ['eu', 'us', 'kr', 'tw'];
export const REGION_LABELS = { eu: 'Europe', us: 'Amériques', kr: 'Corée', tw: 'Taïwan' };

/** One name part in WoW Forever: 2 to 12 letters, nothing else (accents allowed). */
export const NAME_RE = /^\p{L}{2,12}$/u;
export const LABEL_MAX = 24;
export const MAX_PLAYERS = 50;

/** NFC, trimmed, first letter upper case and the rest lower case (the form the game itself enforces). */
export function normalizeName(value) {
  const s = String(value ?? '').normalize('NFC').trim();
  if (!s) return '';
  const chars = Array.from(s);
  return chars[0].toUpperCase() + chars.slice(1).join('').toLowerCase();
}

/** Returns null when the name part is valid, otherwise a French message. */
export function validateName(value, what = 'Ce nom') {
  const s = normalizeName(value);
  if (!s) return `${what} est obligatoire.`;
  if (!NAME_RE.test(s)) return `${what} doit contenir 2 à 12 lettres, sans espace, chiffre ni symbole.`;
  return null;
}

/** The slug Blizzard uses in its API and armory URLs: "name-surname" in lower case, accents kept. */
export function slugOf(name, surname) {
  return `${normalizeName(name)}-${normalizeName(surname)}`.toLowerCase();
}

export function playerId(region, name, surname) {
  return `${region}:${slugOf(name, surname)}`;
}

/** Optional nickname of the human player: control characters removed, at most LABEL_MAX characters. */
export function cleanLabel(value) {
  const s = String(value ?? '')
    .normalize('NFC')
    .replace(/\p{C}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return null;
  return Array.from(s).slice(0, LABEL_MAX).join('').trim() || null;
}

/**
 * Understands what a person may type or paste to designate a character:
 * "Joe Gun", "joe-gun", or an official armory URL. Returns { name, surname, region? } or null.
 */
export function parseCharacterInput(text) {
  let s = String(text ?? '').normalize('NFC').trim();
  if (!s) return null;
  let region;
  const m = /\/forever\/([a-z]{2})\/armory\/character\/([^/?#]+)/i.exec(s);
  if (m) {
    region = m[1].toLowerCase();
    try {
      s = decodeURIComponent(m[2]).normalize('NFC');
    } catch {
      s = m[2];
    }
  }
  const parts = s.split(/[\s\-_+]+/u).filter(Boolean);
  if (parts.length !== 2) return null;
  const out = { name: normalizeName(parts[0]), surname: normalizeName(parts[1]) };
  if (region && REGIONS.includes(region)) out.region = region;
  return out;
}

/** Official armory page of a character. Only link to it once the character is known to be public. */
export function armoryUrl(region, slug) {
  return `https://worldofwarcraft.blizzard.com/fr-fr/forever/${region}/armory/character/${encodeURIComponent(slug)}`;
}

/** Official armory search, for a character that is not public yet. */
export function armorySearchUrl(region, name, surname) {
  return `https://worldofwarcraft.blizzard.com/fr-fr/forever/${region}/armory?q=${encodeURIComponent(`${name} ${surname}`)}`;
}

export function wowheadItemUrl(itemId) {
  return `https://www.wowhead.com/forever/fr/item=${encodeURIComponent(String(itemId))}`;
}

/**
 * Playable classes of WoW Forever by Blizzard class id. Colours are the standard class colours,
 * except Shaman which is lightened so that it stays readable on a dark background.
 */
export const CLASSES = {
  1: { slug: 'warrior', name: 'Guerrier', color: '#C69B6D' },
  2: { slug: 'paladin', name: 'Paladin', color: '#F48CBA' },
  3: { slug: 'hunter', name: 'Chasseur', color: '#AAD372' },
  4: { slug: 'rogue', name: 'Voleur', color: '#FFF468' },
  5: { slug: 'priest', name: 'Prêtre', color: '#FFFFFF' },
  7: { slug: 'shaman', name: 'Chaman', color: '#3D94FF' },
  8: { slug: 'mage', name: 'Mage', color: '#3FC7EB' },
  9: { slug: 'warlock', name: 'Démoniste', color: '#8788EE' },
  11: { slug: 'druid', name: 'Druide', color: '#FF7C0A' },
};
export const UNKNOWN_CLASS_COLOR = '#B8C2D6';

export const RACES = {
  1: 'Humain',
  2: 'Orc',
  3: 'Nain',
  4: 'Elfe de la nuit',
  5: 'Mort-vivant',
  6: 'Tauren',
  7: 'Gnome',
  8: 'Troll',
  95: 'Éolide de l’Ordre suprême',
  96: 'Éolide sculpte-vents',
};

export const RULESETS = { 1: 'JcJ', 2: 'Normal', 3: 'Jeu de rôle', 15: 'Jeu de rôle JcJ' };
export const FACTIONS = { ALLIANCE: 'Alliance', HORDE: 'Horde' };
export const QUALITIES = {
  POOR: 'Médiocre',
  COMMON: 'Commun',
  UNCOMMON: 'Inhabituel',
  RARE: 'Rare',
  EPIC: 'Épique',
  LEGENDARY: 'Légendaire',
};

// The API sends profession names in English even with locale=fr_FR (seen on 2026-11-11), while
// everything else comes back in French. Names already in French, or unknown, are shown as they are.
const PROFESSION_NAMES = {
  Alchemy: 'Alchimie',
  Archaeology: 'Archéologie',
  Blacksmithing: 'Forge',
  Cooking: 'Cuisine',
  Enchanting: 'Enchantement',
  Engineering: 'Ingénierie',
  'First Aid': 'Secourisme',
  Fishing: 'Pêche',
  Herbalism: 'Herboristerie',
  Inscription: 'Calligraphie',
  Jewelcrafting: 'Joaillerie',
  Leatherworking: 'Travail du cuir',
  Mining: 'Minage',
  Skinning: 'Dépeçage',
  Tailoring: 'Couture',
};

export function professionName(name) {
  return Object.hasOwn(PROFESSION_NAMES, name) ? PROFESSION_NAMES[name] : name;
}

/** Display order of equipment slots (slot.type values of the Blizzard API). */
export const SLOT_ORDER = [
  'HEAD', 'NECK', 'SHOULDER', 'BACK', 'CHEST', 'SHIRT', 'TABARD', 'WRIST', 'HANDS', 'WAIST', 'LEGS', 'FEET',
  'FINGER_1', 'FINGER_2', 'TRINKET_1', 'TRINKET_2', 'MAIN_HAND', 'OFF_HAND', 'RANGED',
];

export function classColor(classId) {
  return CLASSES[classId]?.color ?? UNKNOWN_CLASS_COLOR;
}

/** Class icon served by Blizzard's render host, or null for an unknown class id. */
export function classIconUrl(classId) {
  const c = CLASSES[classId];
  return c ? `https://render.worldofwarcraft.com/us/icons/56/classicon_${c.slug}.jpg` : null;
}

/** The only host images may come from (it is also the only one allowed by the page's CSP). */
export const IMAGE_HOST = 'render.worldofwarcraft.com';

/** Returns the URL when it is an https URL on IMAGE_HOST, otherwise null. */
export function safeImageUrl(url) {
  if (typeof url !== 'string' || !url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === IMAGE_HOST ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * Some icon files exist under one regional prefix only. Returns the same URL under the other
 * prefix (forever-eu <-> forever-us), or null when there is nothing to swap.
 */
export function alternateImageUrl(url) {
  const safe = safeImageUrl(url);
  if (!safe) return null;
  if (safe.includes('/forever-eu/')) return safe.replace('/forever-eu/', '/forever-us/');
  if (safe.includes('/forever-us/')) return safe.replace('/forever-us/', '/forever-eu/');
  return null;
}
