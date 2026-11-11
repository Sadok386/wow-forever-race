// The sync: roster + Blizzard API + previous snapshot -> data.json, history.json, media.json.
// It is driven only by its `env` argument so that tests can run several syncs with different settings in one process.
import fs from 'node:fs';
import path from 'node:path';
import { CLASSES, RACES } from '../../site/assets/shared.js';
import { BlizzardAuthError, BlizzardClient, characterPath, profileNamespace, staticNamespace } from './blizzard.mjs';
import { appendPoint, dropSeries, parseHistory, pruneToRoster, serializeHistory } from './history.mjs';
import {
  normalizeEquipment,
  normalizeItemMedia,
  normalizeMedia,
  normalizeProfessions,
  normalizeProfile,
  normalizeRoster,
  normalizeStatistics,
  normalizeTalents,
} from './normalize.mjs';
import { ROOT } from './paths.mjs';
import { parseRoster } from './roster.mjs';
import { isXpSetting, isXpTableConsistent, resolveXpTable } from './xp.mjs';

const PROFILE_CONCURRENCY = 4;
const ICON_CONCURRENCY = 6;
const MAX_ICON_LOOKUPS = 60;
const MAX_GUILDS = 6;
const ICON_RETRY_SEC = 24 * 3600;
const RETENTION_MS = 30 * 24 * 3600 * 1000;

const MESSAGES = {
  noCredentials: 'L’API Blizzard n’est pas encore configurée : ajoute les secrets BLIZZARD_CLIENT_ID et BLIZZARD_CLIENT_SECRET au dépôt.',
  authFailed: 'Blizzard a refusé les identifiants de l’API : vérifie les deux secrets du dépôt.',
  unreachable: 'L’API Blizzard ne répond pas pour le moment : nouvel essai à la prochaine synchronisation.',
  apiError: 'L’API Blizzard a renvoyé des erreurs pour tous les personnages : nouvel essai à la prochaine synchronisation.',
  partial: 'Certains personnages n’ont pas pu être vérifiés ; nouvel essai à la prochaine synchronisation.',
  xpInconsistent: 'La table d’XP ne correspond pas aux valeurs observées : les barres d’XP sont désactivées.',
};

// Key order of a player in data.json. Everything from `characterId` down is what the API told us.
const EMPTY_PLAYER = {
  id: null, region: null, slug: null, name: null, surname: null, label: null, addedAt: null,
  state: 'pending', source: null, checkedAt: null, seenAt: null,
  characterId: null, level: null, xp: null, changedAt: null, levelAt: null, goalAt: null,
  class: null, race: null, gender: null, faction: null, ruleset: null, guild: null,
  ilvl: null, achievementPoints: null, lastLoginAt: null, avatar: null, render: null,
  gear: null, professions: null, stats: null, talents: null,
};
const PLAYER_KEYS = Object.keys(EMPTY_PLAYER);
const API_KEYS = PLAYER_KEYS.slice(PLAYER_KEYS.indexOf('characterId'));

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const hasLevel = (p) => p.state === 'ok' || p.state === 'roster';

// paths.mjs reads process.env; the sync must honour the env it was given instead.
function locations(env) {
  return {
    roster: env.TRACKER_ROSTER_FILE || path.join(ROOT, 'players.json'),
    dir: env.TRACKER_DATA_DIR || path.join(ROOT, 'site', 'data'),
  };
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return '';
    throw err;
  }
}

function previousPlayers(text, warnings) {
  if (!text.trim()) return new Map();
  try {
    const list = JSON.parse(text)?.players;
    const valid = (Array.isArray(list) ? list : []).filter((p) => p && typeof p === 'object' && typeof p.id === 'string');
    return new Map(valid.map((p) => [p.id, p]));
  } catch {
    warnings.push('data.json est illisible : les données précédentes sont ignorées.');
    return new Map();
  }
}

function parseMedia(text, warnings) {
  const media = { schema: 1, items: {} };
  if (!text.trim()) return media;
  try {
    const items = JSON.parse(text)?.items;
    for (const [id, entry] of Object.entries(items && typeof items === 'object' ? items : {})) {
      if (entry && Number.isFinite(entry.at) && (entry.icon === null || typeof entry.icon === 'string')) {
        media.items[id] = { icon: entry.icon, at: entry.at };
      }
    }
  } catch {
    warnings.push('media.json est illisible : les icônes seront relues.');
  }
  return media;
}

function startPlayer(rosterEntry, prev) {
  const p = {};
  for (const key of PLAYER_KEYS) p[key] = prev?.[key] ?? EMPTY_PLAYER[key];
  Object.assign(p, {
    id: rosterEntry.id,
    region: rosterEntry.region,
    slug: rosterEntry.slug,
    label: rosterEntry.label,
    addedAt: rosterEntry.addedAt,
  });
  // The API spelling wins once a character has been seen.
  if (p.characterId === null) Object.assign(p, { name: rosterEntry.name, surname: rosterEntry.surname });
  return p;
}

const snapshot = (p) => ({ level: p.level, xp: p.xp, lastLoginAt: p.lastLoginAt, ilvl: p.ilvl });

function wipeApiData(p) {
  for (const key of API_KEYS) p[key] = null;
  p.source = null;
  p.seenAt = null;
}

async function pool(items, limit, worker) {
  let next = 0;
  const lane = async () => {
    while (next < items.length) await worker(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

// 404 with a JSON body is a real "no such document"; an empty 404 is the gateway refusing the request.
const isNotFound = (res) => res.status === 404 && !res.empty && res.json !== null;

function applyProfile(p, profile) {
  Object.assign(p, {
    state: 'ok',
    source: 'profile',
    name: profile.name ?? p.name,
    surname: profile.surname ?? p.surname,
    characterId: profile.characterId,
    level: profile.level,
    xp: profile.xp,
    class: profile.class,
    race: profile.race,
    gender: profile.gender,
    faction: profile.faction,
    ruleset: profile.ruleset,
    guild: profile.guild,
    ilvl: profile.ilvl,
    achievementPoints: profile.achievementPoints,
    lastLoginAt: profile.lastLoginAt,
  });
}

const gearItem = (it) => ({
  slot: it.slot, slotName: it.slotName, itemId: it.itemId, name: it.name, quality: it.quality,
  ilvl: it.ilvl, icon: null, enchant: it.enchant,
});

async function fetchSubResources(client, p, { changed, full }) {
  const get = (sub) => client.get(p.region, characterPath(p.slug, sub), profileNamespace(p.region));
  const wanted = (field) => full || changed || p[field] === null;
  const jobs = [];
  const job = (sub, apply) => jobs.push(get(sub).then((res) => res.status === 200 && res.json && apply(res.json)));

  if (wanted('gear')) job('/equipment', (j) => { p.gear = normalizeEquipment(j).map(gearItem); });
  if (wanted('professions')) job('/professions', (j) => { p.professions = normalizeProfessions(j); });
  if (wanted('stats')) job('/statistics', (j) => { p.stats = normalizeStatistics(j); });
  if (wanted('talents')) job('/specializations', (j) => { p.talents = normalizeTalents(j); });
  // Renders can take hours to appear, so a missing avatar is retried on every run.
  if (full || changed || p.avatar === null) {
    job('/character-media', (j) => {
      const media = normalizeMedia(j);
      p.avatar = media.avatar ?? p.avatar;
      p.render = media.render ?? p.render;
    });
  }
  await Promise.all(jobs);
}

async function syncProfile(client, p, ctx) {
  const info = ctx.info.get(p.id);
  p.checkedAt = ctx.nowIso;
  const res = await client.get(p.region, characterPath(p.slug), profileNamespace(p.region));
  const profile = res.status === 200 ? normalizeProfile(res.json) : null;

  if (!profile) {
    p.state = isNotFound(res) ? (p.level === null ? 'pending' : 'missing') : 'error';
    return;
  }
  if (p.characterId !== null && profile.characterId !== null && p.characterId !== profile.characterId) {
    // The name now belongs to another character: nothing we know applies to it.
    wipeApiData(p);
    info.before = snapshot(p);
    info.reset = true;
  }
  const changed = ['level', 'xp', 'lastLoginAt', 'ilvl'].some((k) => info.before[k] !== profile[k]);
  applyProfile(p, profile);
  p.seenAt = ctx.nowIso;
  await fetchSubResources(client, p, { changed, full: ctx.full });
}

const seeking = (p) => p.state === 'pending' || p.state === 'missing';

// Explicit settings first, then the guild stored on any tracked player whatever its state in this run (a guild-mate
// that is in error, or a player found through a roster earlier, still points to the roster to read).
// The cap applies last, once the guilds nobody is looking for have been dropped.
function guildCandidates(players, settings) {
  const keys = new Map();
  const add = (region, slug) => keys.set(`${region}:${slug}`, { region, slug });
  for (const g of settings.guilds ?? []) add(g.region, g.slug);
  for (const p of players) if (p.guild?.slug) add(p.region, p.guild.slug);
  return [...keys.values()].filter((g) => players.some((p) => seeking(p) && p.region === g.region)).slice(0, MAX_GUILDS);
}

async function syncGuildRosters(client, players, settings, ctx) {
  const guilds = guildCandidates(players, settings);
  await pool(guilds, PROFILE_CONCURRENCY, async ({ region, slug }) => {
    const res = await client.get(region, `/data/wow/guild/${encodeURIComponent(slug)}/roster`, profileNamespace(region));
    if (res.status !== 200) return;
    const { guild, members } = normalizeRoster(res.json);
    for (const p of players.filter((q) => seeking(q) && q.region === region)) {
      const member = members.get(p.slug);
      if (!member) continue;
      if (p.characterId !== null && member.characterId !== null && p.characterId !== member.characterId) {
        // Same as in syncProfile: the name was re-created, nothing we know applies to it.
        wipeApiData(p);
        const info = ctx.info.get(p.id);
        info.before = snapshot(p);
        info.reset = true;
      }
      Object.assign(p, {
        state: 'roster',
        source: 'roster',
        seenAt: ctx.nowIso,
        name: member.name,
        surname: member.surname,
        level: member.level,
        xp: null,
        class: { id: member.classId, name: CLASSES[member.classId]?.name ?? null },
        race: { id: member.raceId, name: RACES[member.raceId] ?? null },
        faction: member.faction ?? p.faction,
        guild: guild.slug ? guild : p.guild,
        characterId: member.characterId ?? p.characterId,
      });
    }
  });
}

async function fillIcons(client, players, media, nowSec) {
  const items = players.flatMap((p) => (Array.isArray(p.gear) ? p.gear.map((item) => ({ item, region: p.region })) : []));
  const apply = () => {
    for (const { item } of items) item.icon ??= media.items[item.itemId]?.icon ?? null;
  };
  apply();

  const lookups = new Map();
  for (const { item, region } of items) {
    const cached = media.items[item.itemId];
    if (item.icon || lookups.has(item.itemId)) continue;
    if (!cached || !(nowSec - cached.at < ICON_RETRY_SEC)) lookups.set(item.itemId, region);
  }
  await pool([...lookups].slice(0, MAX_ICON_LOOKUPS), ICON_CONCURRENCY, async ([itemId, region]) => {
    const res = await client.get(region, `/data/wow/media/item/${itemId}`, staticNamespace(region));
    // Only a real "not rendered yet" is cached; any technical failure leaves the entry alone so the next run retries.
    if (res.status === 200) media.items[itemId] = { icon: normalizeItemMedia(res.json), at: nowSec };
    else if (isNotFound(res)) media.items[itemId] = { icon: null, at: nowSec };
  });
  apply();
}

async function queryBlizzard(client, players, settings, media, ctx) {
  await pool(players, PROFILE_CONCURRENCY, async (p) => {
    try {
      await syncProfile(client, p, ctx);
    } catch (err) {
      if (err instanceof BlizzardAuthError) throw err;
      ctx.log(`Blizzard : échec inattendu pour ${p.id} (${err.message}).`);
      p.state = 'error';
    }
  });
  await syncGuildRosters(client, players, settings, ctx);
  await fillIcons(client, players, media, ctx.nowSec);
}

function trackProgress(players, history, goalLevel, ctx) {
  for (const p of players.filter(hasLevel)) {
    const { before, reset } = ctx.info.get(p.id);
    const known = before.level !== null;
    const levelUp = known && p.level > before.level;
    const moved = known && (p.level !== before.level || (before.xp !== null && p.xp !== null && p.xp !== before.xp));
    if (moved) p.changedAt = ctx.nowIso;
    if (levelUp) p.levelAt = ctx.nowIso;
    if (p.level >= goalLevel) p.goalAt ??= ctx.nowIso;
    else p.goalAt = null;
    if (reset) dropSeries(history, p.id);
    appendPoint(history, p.id, ctx.nowSec, p.level, p.xp);
  }
}

// Blizzard's API terms forbid keeping data that has not been refreshed for 30 days.
function purgeStale(players, history, ctx, warnings) {
  for (const p of players.filter((q) => !hasLevel(q) && q.seenAt !== null)) {
    if (ctx.nowMs - Date.parse(p.seenAt) <= RETENTION_MS) continue;
    const { name, surname } = ctx.roster.get(p.id);
    wipeApiData(p);
    Object.assign(p, { state: 'pending', name, surname });
    dropSeries(history, p.id);
    warnings.push(`Les données de ${name} ${surname} ont été effacées : personnage introuvable depuis 30 jours.`);
  }
}

function resolveXp(settings, players, warnings) {
  if (!isXpSetting(settings.xpTable)) warnings.push('Réglage « xpTable » invalide : la table d’XP intégrée est utilisée.');
  const table = resolveXpTable(settings.xpTable);
  if (isXpTableConsistent(table, players)) return table;
  warnings.push(MESSAGES.xpInconsistent);
  return null;
}

function repoInfo(env) {
  const [owner, name] = (env.TRACKER_REPO || env.GITHUB_REPOSITORY || '').split('/');
  if (!owner || !name) return null;
  return {
    owner,
    name,
    branch: env.TRACKER_BRANCH || env.GITHUB_REF_NAME || 'main',
    workflow: 'tracker.yml',
    apiBase: env.TRACKER_API_BASE || 'https://api.github.com',
  };
}

function runStatus(players, unavailable) {
  if (unavailable) return unavailable;
  const failed = players.filter((p) => p.state === 'error').length;
  if (failed === 0) return { code: 'ok', message: null };
  if (failed === players.length) return { code: 'api-error', message: MESSAGES.apiError };
  return { code: 'partial', message: MESSAGES.partial };
}

const STATE_LABELS = { ok: 'ok', roster: 'guilde', pending: 'en attente', missing: 'introuvable', error: 'erreur' };

// Names come from the API: keep them from breaking out of their table cell.
const cell = (text) => text.replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|');

function summarize({ players, status, warnings, requests, nowIso }) {
  const rows = players.map((p) => {
    const who = cell(`${p.name} ${p.surname} (${p.region.toUpperCase()})`);
    return `| ${who} | ${STATE_LABELS[p.state]} | ${p.level ?? '—'} | ${p.xp ?? '—'} | ${p.changedAt ?? '—'} |`;
  });
  return [
    `## Synchronisation du ${nowIso}`,
    '',
    '| Personnage | État | Niveau | XP | Changement |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
    `Requêtes Blizzard : ${requests}. Statut : ${status.code}${status.message ? ` — ${status.message}` : ''}`,
    ...(warnings.length ? ['', ...warnings.map((w) => `- ${w}`)] : []),
    '',
  ].join('\n');
}

function annotate(status, log) {
  if (status.code === 'no-credentials') log(`::warning::${status.message}`);
  else if (status.code === 'auth-failed' || status.code === 'api-error') log(`::error::${status.message}`);
}

export async function runSync({ env = process.env, now = new Date(), log: emit = console.log } = {}) {
  // A line break coming from data would start a new line that the runner could parse as a workflow command.
  const log = (message) => emit(String(message).replace(/[\r\n]+/g, ' '));
  const where = locations(env);
  const tracked = new Date(env.TRACKER_NOW ?? NaN);
  const nowMs = (Number.isNaN(tracked.getTime()) ? now : tracked).getTime();
  const ctx = { nowMs, nowSec: Math.floor(nowMs / 1000), nowIso: iso(nowMs), full: env.TRACKER_FULL === '1', log, info: new Map(), roster: new Map() };

  fs.mkdirSync(where.dir, { recursive: true });
  const { roster, warnings } = parseRoster(readText(where.roster));
  const previous = previousPlayers(readText(path.join(where.dir, 'data.json')), warnings);
  const parsedHistory = parseHistory(readText(path.join(where.dir, 'history.json')));
  if (parsedHistory.warning) warnings.push(parsedHistory.warning);
  const { history } = parsedHistory;
  const media = parseMedia(readText(path.join(where.dir, 'media.json')), warnings);

  const players = roster.players.map((entry) => {
    const p = startPlayer(entry, previous.get(entry.id));
    ctx.info.set(p.id, { before: snapshot(p), reset: false });
    ctx.roster.set(p.id, entry);
    return p;
  });
  const initial = players.map((p) => ({ ...p }));

  let unavailable = null;
  let requests = 0;
  if (!env.BLIZZARD_CLIENT_ID || !env.BLIZZARD_CLIENT_SECRET) {
    unavailable = { code: 'no-credentials', message: MESSAGES.noCredentials };
  } else {
    const client = new BlizzardClient({
      clientId: env.BLIZZARD_CLIENT_ID,
      clientSecret: env.BLIZZARD_CLIENT_SECRET,
      oauthUrl: env.BLIZZARD_OAUTH_URL || undefined,
      apiTemplate: env.BLIZZARD_API_TEMPLATE || undefined,
      log,
    });
    try {
      await client.getToken();
      await queryBlizzard(client, players, roster.settings, media, ctx);
    } catch (err) {
      if (err instanceof BlizzardAuthError) {
        unavailable = { code: 'auth-failed', message: MESSAGES.authFailed };
      } else {
        log(`Blizzard : ${err.message}`);
        unavailable = { code: 'api-error', message: MESSAGES.unreachable };
      }
      players.splice(0, players.length, ...initial);
    }
    requests = client.requestCount;
  }

  if (unavailable) {
    for (const p of players) p.state = p.level === null ? 'pending' : 'error';
  } else {
    trackProgress(players, history, roster.settings.goalLevel, ctx);
  }
  purgeStale(players, history, ctx, warnings);
  pruneToRoster(history, players.map((p) => p.id));
  const xpTable = resolveXp(roster.settings, players, warnings);
  const status = { ...runStatus(players, unavailable), warnings };

  const data = {
    schema: 1,
    generatedAt: ctx.nowIso,
    settings: { title: roster.settings.title, goalLevel: roster.settings.goalLevel },
    repo: repoInfo(env),
    status: { code: status.code, message: status.message, warnings },
    xpTable,
    players,
  };
  fs.writeFileSync(path.join(where.dir, 'data.json'), `${JSON.stringify(data, null, 2)}\n`);
  fs.writeFileSync(path.join(where.dir, 'history.json'), serializeHistory(history));
  fs.writeFileSync(path.join(where.dir, 'media.json'), `${JSON.stringify(media, null, 2)}\n`);

  const summary = summarize({ players, status, warnings, requests, nowIso: ctx.nowIso });
  if (env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${summary}\n`);
    } catch (err) {
      log(`::warning::Résumé de synchronisation non écrit (${err.message}).`);
    }
  }
  log(`Synchronisation : ${status.code}, ${players.length} personnage(s), ${requests} requête(s).`);
  for (const p of players) log(`  ${p.name} ${p.surname} (${p.region}) : ${STATE_LABELS[p.state]}, niveau ${p.level ?? '—'}`);
  annotate(status, log);

  return { data, history, media, summary };
}
