// Pure functions turning Blizzard API documents into the compact shapes stored in data.json.
// Every access is tolerant: a missing or malformed part yields null / [] instead of an exception.
import { SLOT_ORDER, safeImageUrl, slugOf } from '../../site/assets/shared.js';

const LOCALE_PREFERENCE = ['fr_FR', 'en_GB', 'en_US'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
// Every string from the API passes through here before it is stored or logged: single line, no control characters,
// so that it cannot forge a workflow command in a log or break a Markdown table.
const UNSAFE_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu;
const str = (v) => (typeof v === 'string' ? v.replace(UNSAFE_CHARS, ' ').trim() || null : null);

/** A localised string: either the string itself or an object keyed by locale. */
export function loc(value) {
  if (typeof value === 'string') return str(value);
  if (!isObject(value)) return null;
  for (const key of LOCALE_PREFERENCE) {
    if (str(value[key])) return str(value[key]);
  }
  for (const v of Object.values(value)) if (str(v)) return str(v);
  return null;
}

function isoSeconds(ms) {
  const n = num(ms);
  if (n === null) return null;
  const date = new Date(n);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function idName(entry) {
  return { id: num(entry?.id), name: loc(entry?.name) };
}

function guildOf(guild) {
  const slug = str(guild?.slug);
  return slug ? { name: loc(guild.name), slug } : null;
}

export function normalizeProfile(json) {
  if (!isObject(json) || num(json.level) === null) return null;
  return {
    characterId: num(json.id),
    name: loc(json.name),
    surname: loc(json.surname),
    level: json.level,
    xp: num(json.experience),
    class: idName(json.character_class),
    race: idName(json.race),
    gender: str(json.gender?.type),
    faction: str(json.faction?.type),
    ruleset: idName(json.ruleset),
    guild: guildOf(json.guild),
    ilvl: num(json.equipped_item_level) ?? num(json.average_item_level),
    achievementPoints: num(json.achievement_points),
    lastLoginAt: isoSeconds(json.last_login_timestamp),
  };
}

function slotRank(slot) {
  const i = SLOT_ORDER.indexOf(slot);
  return i === -1 ? SLOT_ORDER.length : i;
}

export function normalizeEquipment(json) {
  const items = Array.isArray(json?.equipped_items) ? json.equipped_items : [];
  return items
    .filter((it) => num(it?.item?.id) !== null && str(it?.slot?.type))
    .map((it) => ({
      slot: it.slot.type,
      slotName: loc(it.slot.name),
      itemId: it.item.id,
      name: loc(it.name),
      quality: str(it.quality?.type),
      ilvl: num(it.level?.value),
      enchant: str(Array.isArray(it.enchantments) ? it.enchantments.find((e) => str(e?.display_string))?.display_string : null),
    }))
    .sort((a, b) => slotRank(a.slot) - slotRank(b.slot));
}

function assetValue(json, key) {
  const assets = Array.isArray(json?.assets) ? json.assets : [];
  return assets.find((a) => a?.key === key)?.value;
}

export function normalizeMedia(json) {
  return {
    avatar: safeImageUrl(assetValue(json, 'avatar')),
    render: safeImageUrl(assetValue(json, 'main-raw')),
  };
}

export function normalizeProfessions(json) {
  const entries = [json?.primaries, json?.secondaries].flatMap((list) => (Array.isArray(list) ? list : []));
  return entries
    .filter((e) => loc(e?.profession?.name))
    .map((e) => {
      const tier = Array.isArray(e.tiers) ? e.tiers[0] : null;
      return {
        name: loc(e.profession.name),
        skill: num(tier?.skill_points) ?? num(e.skill_points),
        max: num(tier?.max_skill_points) ?? num(e.max_skill_points),
      };
    });
}

// A stat is either a plain number or { base, effective }.
const stat = (v) => num(v) ?? num(v?.effective);

export function normalizeStatistics(json) {
  const j = isObject(json) ? json : {};
  return {
    health: num(j.health),
    power: num(j.power),
    powerType: loc(j.power_type?.name),
    strength: stat(j.strength),
    agility: stat(j.agility),
    stamina: stat(j.stamina),
    intellect: stat(j.intellect),
    spirit: stat(j.spirit),
    armor: stat(j.armor),
  };
}

export function normalizeTalents(json) {
  const groups = Array.isArray(json?.specialization_groups) ? json.specialization_groups : [];
  const active = groups.find((g) => g?.is_active === true);
  const specs = Array.isArray(active?.specializations) ? active.specializations : [];
  return specs
    .map((s) => ({ name: loc(s?.specialization_name) ?? loc(s?.specialization?.name), points: num(s?.spent_points) ?? 0 }))
    .filter((s) => s.name)
    .sort((a, b) => b.points - a.points);
}

export function normalizeItemMedia(json) {
  const assets = Array.isArray(json?.assets) ? json.assets : [];
  const icon = assets.find((a) => a?.key === 'icon') ?? assets[0];
  return safeImageUrl(icon?.value);
}

export function normalizeRoster(json) {
  const members = new Map();
  for (const entry of Array.isArray(json?.members) ? json.members : []) {
    const c = entry?.character;
    const name = loc(c?.name);
    const surname = loc(c?.surname);
    const level = num(c?.level);
    if (!name || !surname || level === null) continue;
    const slug = (str(c.slug) ?? slugOf(name, surname)).normalize('NFC');
    members.set(slug, {
      name,
      surname,
      level,
      classId: num(c.playable_class?.id),
      raceId: num(c.playable_race?.id),
      faction: str(c.faction?.type),
      characterId: num(c.id),
    });
  }
  return { guild: { name: loc(json?.guild?.name), slug: str(json?.guild?.slug) }, members };
}
