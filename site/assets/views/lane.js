// One lane of the race: who, how far, how recently, and what you can do with it.
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { armoryUrl } from '../shared.js';
import { fractionalLevel, levelsGained, trackRatio, xpPercent } from '../model.js';
import { dateTime, fullName, ordinal } from '../format.js';
import { avatar, initialsDisc } from './media.js';
import {
  identityNodes, playedByNodes, stateNote, tint,
} from './identity.js';
import { timeEl } from './time.js';

const TICK_EVERY = 10;
const DAY_SECONDS = 86400;

// Where each marker stood at the previous render, so that a level-up slides instead of jumping.
const lastRatio = new Map();

const at = (el, ratio) => {
  el.style.setProperty('--p', ratio);
  return el;
};

function track(player, ratio, goalLevel) {
  const ticks = [];
  for (let level = TICK_EVERY; level < goalLevel; level += TICK_EVERY) {
    ticks.push(at(h('span', { class: 'track__tick' }), trackRatio(level, goalLevel)));
  }
  const el = h(
    'div',
    { class: 'track', role: 'img', 'aria-label': `Niveau ${player.level} sur ${goalLevel}` },
    h(
      'div',
      { class: 'track__inner' },
      h('span', { class: 'track__rail' }),
      h('span', { class: 'track__fill' }),
      ticks,
      h('span', { class: 'track__finish' }, goalLevel),
      h('span', { class: 'track__marker' }),
    ),
  );
  const from = lastRatio.get(player.id) ?? 0;
  lastRatio.set(player.id, ratio);
  at(el, from);
  if (from !== ratio) requestAnimationFrame(() => requestAnimationFrame(() => at(el, ratio)));
  return el;
}

/** The thin XP bar under the race bar; null when the share is unknown or the race is over. */
function xpBar(pct, finished) {
  if (finished || pct === null) return null;
  const el = h(
    'div',
    { class: 'xpbar', role: 'img', 'aria-label': `XP du niveau en cours : ${pct} %` },
    h('span', { class: 'xpbar__label' }, `${pct} %`),
    h('span', { class: 'xpbar__trough' }, h('span', { class: 'xpbar__fill' })),
  );
  el.style.setProperty('--p', Math.min(Math.max(pct, 0), 100) / 100);
  return el;
}

function levelBlock(player) {
  return h(
    'div',
    { class: 'lane__level' },
    h('span', { class: 'sr-only' }, 'Niveau '),
    h('span', { class: 'lane__lvl-label', 'aria-hidden': 'true' }, 'Niveau'),
    h('span', { class: 'lane__lvl' }, player.level),
  );
}

function rankBadge(rank) {
  return h(
    'div',
    { class: 'lane__rank', dataset: { rank: rank <= 3 ? rank : null } },
    h('span', { class: 'sr-only' }, 'Rang '),
    rank === 1 ? icon('crown', 16) : null,
    h('span', { class: rank === 1 ? 'sr-only' : null }, rank),
  );
}

function meta(player, rank, finished, gained, leaving) {
  const note = leaving ? 'Retrait en cours…' : stateNote(player);
  return h(
    'div',
    { class: 'lane__meta' },
    finished
      ? h('span', { class: 'lane__finish' }, icon('flag', 14), `Arrivé ${ordinal(rank)}${player.goalAt ? ` · ${dateTime(player.goalAt)}` : ''}`)
      : null,
    gained > 0 ? h('span', { class: 'lane__gain' }, `+${gained} niv. en 24 h`) : null,
    timeEl(player.lastLoginAt, { prefix: 'déconnecté ' }),
    note ? h('span', { class: 'lane__note' }, note) : null,
  );
}

function actions(player, ctx, leaving) {
  const name = fullName(player);
  return h(
    'div',
    { class: 'lane__actions' },
    h('button', {
      class: 'btn btn--small',
      type: 'button',
      'aria-label': `Fiche de ${name}`,
      dataset: { key: `lane:${player.id}:sheet` },
      on: { click: () => ctx.openSheet(player) },
    }, 'Fiche'),
    player.source === 'profile'
      ? h('a', {
        class: 'btn btn--small btn--ghost',
        href: armoryUrl(player.region, player.slug),
        target: '_blank',
        rel: 'noopener noreferrer',
        'aria-label': `Armurerie de ${name} (nouvel onglet)`,
        dataset: { key: `lane:${player.id}:armory` },
      }, 'Armurerie', icon('external', 14))
      : null,
    ctx.edit.isUnlocked() && !leaving
      ? h('button', {
        class: 'btn btn--small btn--ghost',
        type: 'button',
        'aria-label': `Retirer ${name}`,
        dataset: { key: `lane:${player.id}:remove` },
        on: { click: () => ctx.edit.requestRemove(player) },
      }, 'Retirer')
      : null,
  );
}

export function renderLane(player, rank, ctx) {
  const { goalLevel, xpTable, history, removals, nowMs } = ctx;
  const finished = player.level >= goalLevel;
  const leaving = removals.has(player.id);
  const ratio = trackRatio(fractionalLevel(player.level, player.xp, xpTable, goalLevel), goalLevel);
  const gained = levelsGained(history?.series?.[player.id], nowMs / 1000 - DAY_SECONDS);
  const line = identityNodes(player);
  const playedBy = playedByNodes(player, ctx, { leaving });
  const classes = ['lane', rank === 1 && 'lane--first', rank === 1 && 'ornate', finished && 'lane--finished', leaving && 'lane--leaving']
    .filter(Boolean).join(' ');

  return tint(
    h(
      'li',
      { class: classes, dataset: { id: player.id } },
      rankBadge(rank),
      h(
        'div',
        { class: 'lane__id' },
        avatar(player),
        h(
          'div',
          { class: 'lane__who' },
          h('h3', { class: 'lane__name' }, h('button', {
            class: 'lane__open',
            type: 'button',
            dataset: { key: `lane:${player.id}:open` },
            on: { click: () => ctx.openSheet(player) },
          }, fullName(player))),
          playedBy ? h('p', { class: 'lane__by' }, playedBy) : null,
          line.length ? h('p', { class: 'lane__line' }, line) : null,
          player.guild?.name ? h('p', { class: 'lane__guild' }, `<${player.guild.name}>`) : null,
        ),
      ),
      levelBlock(player),
      h('div', { class: 'lane__bars' }, track(player, ratio, goalLevel), xpBar(xpPercent(player, xpTable), finished)),
      meta(player, rank, finished, gained, leaving),
      actions(player, ctx, leaving),
    ),
    player,
  );
}

/** A requested addition that the next synchronisation has not produced yet. */
export function renderGhost(pending) {
  return h(
    'li',
    { class: 'lane lane--ghost' },
    h('div', { class: 'lane__rank', 'aria-hidden': 'true' }, '·'),
    h(
      'div',
      { class: 'lane__id' },
      h('div', { class: 'avatar' }, initialsDisc(pending.name, pending.surname)),
      h(
        'div',
        { class: 'lane__who' },
        h('h3', { class: 'lane__name' }, `${pending.name} ${pending.surname}`),
        pending.label ? h('p', { class: 'lane__by' }, `joué par ${pending.label}`) : null,
      ),
    ),
    h('p', { class: 'lane__ghost-note' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Ajout en cours…'),
  );
}
