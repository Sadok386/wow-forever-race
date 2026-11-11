import {
  MAX_PLAYERS,
  REGIONS,
  cleanLabel,
  normalizeName,
  playerId,
  slugOf,
  validateName,
} from '../../site/assets/shared.js';

export const DEFAULT_SETTINGS = { title: 'RUSH 60', goalLevel: 60 };

/** The message is French and meant to be shown to the person who triggered the operation. */
export class RosterError extends Error {}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function display(p) {
  return `${p.name} ${p.surname} (${p.region.toUpperCase()})`;
}

function parseSettings(raw, warnings) {
  const src = isObject(raw) ? raw : {};
  const settings = { ...src };

  const title = typeof src.title === 'string' ? src.title.trim() : '';
  if (!title && 'title' in src) warnings.push('Réglage « title » invalide : le titre par défaut est utilisé.');
  settings.title = title || DEFAULT_SETTINGS.title;

  const goal = src.goalLevel;
  const goalOk = Number.isInteger(goal) && goal >= 2 && goal <= 60;
  if (!goalOk && 'goalLevel' in src) warnings.push('Réglage « goalLevel » invalide (entier de 2 à 60) : 60 est utilisé.');
  settings.goalLevel = goalOk ? goal : DEFAULT_SETTINGS.goalLevel;

  if ('guilds' in src) {
    const list = Array.isArray(src.guilds) ? src.guilds : [];
    const valid = list.filter((g) => isObject(g) && REGIONS.includes(g.region) && typeof g.slug === 'string' && g.slug.trim());
    if (!Array.isArray(src.guilds) || valid.length < list.length) {
      warnings.push('Réglage « guilds » : les entrées invalides sont ignorées.');
    }
    settings.guilds = valid.map((g) => ({ region: g.region, slug: g.slug.trim().toLowerCase() }));
  }

  // Keys in a stable order, whatever the hand-edited file looked like.
  const { title: t, goalLevel: g, ...rest } = settings;
  return { title: t, goalLevel: g, ...rest };
}

function parsePlayer(entry) {
  if (!isObject(entry)) return { error: 'ce n’est pas un objet' };
  if (!REGIONS.includes(entry.region)) return { error: 'région inconnue' };
  const name = normalizeName(entry.name);
  const surname = normalizeName(entry.surname);
  const problem = validateName(name, 'Le nom principal') ?? validateName(surname, 'Le nom secondaire');
  if (problem) return { error: problem };
  const addedAt = typeof entry.addedAt === 'string' && !Number.isNaN(Date.parse(entry.addedAt)) ? entry.addedAt : null;
  return {
    player: {
      id: playerId(entry.region, name, surname),
      region: entry.region,
      slug: slugOf(name, surname),
      name,
      surname,
      label: cleanLabel(entry.label),
      addedAt,
    },
  };
}

/** Tolerant by design: a hand edit of players.json must never crash the sync. */
export function parseRoster(text) {
  const warnings = [];
  let raw = {};
  if (!String(text ?? '').trim()) {
    warnings.push('players.json est vide : aucun personnage suivi.');
  } else {
    try {
      const json = JSON.parse(text);
      if (isObject(json)) raw = json;
      else warnings.push('players.json doit contenir un objet : aucun personnage suivi.');
    } catch {
      warnings.push('players.json est illisible (JSON invalide) : aucun personnage suivi.');
    }
  }

  const settings = parseSettings(raw.settings, warnings);
  const entries = Array.isArray(raw.players) ? raw.players : [];
  if (raw.players !== undefined && !Array.isArray(raw.players)) {
    warnings.push('« players » doit être une liste : aucun personnage suivi.');
  }

  const players = [];
  const seen = new Set();
  entries.forEach((entry, i) => {
    const { player, error } = parsePlayer(entry);
    if (error) {
      warnings.push(`Entrée n°${i + 1} de players.json ignorée : ${error}.`);
    } else if (seen.has(player.id)) {
      warnings.push(`Doublon ignoré dans players.json : ${display(player)}.`);
    } else if (players.length >= MAX_PLAYERS) {
      warnings.push(`Limite de ${MAX_PLAYERS} personnages atteinte : ${display(player)} est ignoré.`);
    } else {
      seen.add(player.id);
      players.push(player);
    }
  });

  return { roster: { version: 1, settings, players, raw }, warnings };
}

export function serializeRoster(roster) {
  const { version: _v, settings: _s, players: _p, ...otherKeys } = roster.raw ?? {};
  const out = {
    version: 1,
    settings: roster.settings,
    players: roster.players.map((p) => {
      const entry = { region: p.region, name: p.name, surname: p.surname };
      if (p.label) entry.label = p.label;
      if (p.addedAt) entry.addedAt = p.addedAt;
      return entry;
    }),
    ...otherKeys,
  };
  return `${JSON.stringify(out, null, 2)}\n`;
}

function checkTarget(op) {
  if (!REGIONS.includes(op.region)) throw new RosterError('Région inconnue.');
  const nameError = validateName(op.name, 'Le nom principal') ?? validateName(op.surname, 'Le nom secondaire');
  if (nameError) throw new RosterError(nameError);
  const name = normalizeName(op.name);
  const surname = normalizeName(op.surname);
  return { region: op.region, name, surname, id: playerId(op.region, name, surname) };
}

export function applyOp(roster, op, nowIso) {
  if (op?.op !== 'add' && op?.op !== 'remove') throw new RosterError('Action inconnue.');
  const target = checkTarget(op);
  const existing = roster.players.find((p) => p.id === target.id);

  if (op.op === 'remove') {
    if (!existing) return { roster, changed: false, message: `roster: ${display(target)} n’est pas suivi` };
    const players = roster.players.filter((p) => p.id !== target.id);
    return { roster: { ...roster, players }, changed: true, message: `roster: − ${display(target)}` };
  }

  // The label is the first name of the person who plays the character.
  const label = cleanLabel(op.label);
  if (existing) {
    // A tracked character can get a first name or change it; an empty one never clears it.
    if (!label || label === existing.label) {
      return { roster, changed: false, message: `roster: ${display(target)} est déjà suivi` };
    }
    const players = roster.players.map((p) => (p.id === target.id ? { ...p, label } : p));
    return { roster: { ...roster, players }, changed: true, message: `roster: ~ ${display(target)}` };
  }

  // Characters tracked before this rule may still have none; a new one must come with it.
  if (!label) {
    throw new RosterError('Le prénom du joueur est obligatoire pour ajouter un personnage, pour que tout le monde se reconnaisse.');
  }
  if (roster.players.length >= MAX_PLAYERS) {
    throw new RosterError(`La liste est pleine : ${MAX_PLAYERS} personnages au maximum.`);
  }
  const player = {
    id: target.id,
    region: target.region,
    slug: slugOf(target.name, target.surname),
    name: target.name,
    surname: target.surname,
    label,
    addedAt: nowIso,
  };
  return { roster: { ...roster, players: [...roster.players, player] }, changed: true, message: `roster: + ${display(target)}` };
}

const B64URL = /^[A-Za-z0-9_-]+$/;

/** Checks the shape only; the ciphertext is opaque here and never echoed back in errors. */
export function validateEditPayload(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new RosterError('Le lien de modification est invalide (JSON illisible).');
  }
  const keys = isObject(json) ? Object.keys(json).sort().join(',') : '';
  if (keys !== 'ct,iv') throw new RosterError('Le lien de modification est invalide (champs attendus : iv et ct).');
  const { iv, ct } = json;
  const ivOk = typeof iv === 'string' && iv.length === 16 && B64URL.test(iv);
  const ctOk = typeof ct === 'string' && ct.length >= 40 && ct.length <= 4000 && B64URL.test(ct);
  if (!ivOk || !ctOk) throw new RosterError('Le lien de modification est invalide (valeurs hors format).');
  return { iv, ct };
}
