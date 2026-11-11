// The character sheet: a wide dialog with gear, stats, professions, talents and recent level-ups.
import { copyText, dialog, focusByKey, focusKey, h, toast } from '../dom.js';
import { icon } from '../icons.js';
import { QUALITIES, alternateImageUrl, armoryUrl, safeImageUrl, wowheadItemUrl } from '../shared.js';
import { buildFeed, xpNeeded, xpPercent } from '../model.js';
import { dateTime, fullName, num, relTime } from '../format.js';
import { avatar, chainImage } from './media.js';
import { identityNodes, stateNote, tint } from './identity.js';

const HISTORY_LENGTH = 8;

const section = (title, ...content) =>
  h('section', null, h('h3', { class: 'sheet__heading' }, title), content);

const fact = (label, value) => (value === null || value === undefined || value === '' ? null : h('div', { class: 'facts__item' }, h('dt', null, label), h('dd', null, value)));

function hero(player, xpTable) {
  const percent = xpPercent(player, xpTable);
  const line = identityNodes(player);
  const render = safeImageUrl(player.render);
  return tint(h(
    'div',
    { class: 'sheet__hero' },
    h(
      'div',
      // A render that fails to load is replaced by the smaller avatar: keep the hero height stable.
      { class: render ? 'sheet__figure sheet__figure--render' : 'sheet__figure' },
      chainImage([render], { class: 'sheet__render', loading: 'lazy' }, () => avatar(player, { large: true })),
    ),
    h(
      'div',
      { class: 'sheet__intro stack' },
      player.label ? h('p', { class: 'muted' }, `joué par ${player.label}`) : null,
      line.length ? h('p', null, line) : null,
      player.guild?.name ? h('p', { class: 'muted' }, `<${player.guild.name}>`) : null,
      h(
        'p',
        { class: 'sheet__level' },
        h('span', { class: 'sheet__lvl-label' }, 'Niveau'),
        h('span', { class: 'sheet__lvl' }, player.level),
        percent === null ? null : h('span', { class: 'sheet__pct' }, `${percent} %`),
      ),
    ),
  ), player);
}

function xpText(player, xpTable) {
  if (typeof player.xp !== 'number') return null;
  const needed = xpNeeded(player.level, xpTable);
  return needed === null ? num(player.xp) : `${num(player.xp)} / ${num(needed)}`;
}

function facts(player, xpTable, nowMs) {
  const items = [
    fact('XP', xpText(player, xpTable)),
    fact('Niveau d’objet', player.ilvl),
    fact('Points de hauts faits', typeof player.achievementPoints === 'number' ? num(player.achievementPoints) : null),
    fact('Dernière déconnexion', player.lastLoginAt ? `${dateTime(player.lastLoginAt)} (${relTime(player.lastLoginAt, nowMs)})` : null),
    fact('Suivi depuis', player.addedAt ? dateTime(player.addedAt) : null),
  ].filter(Boolean);
  return h('dl', { class: 'facts' }, items);
}

function gearItem(item, index) {
  const icons = [safeImageUrl(item.icon), alternateImageUrl(item.icon)];
  const nameNode = item.itemId
    ? h('a', { class: 'gear__name', dataset: { key: `gear:${item.slot ?? index}:${item.itemId}` }, href: wowheadItemUrl(item.itemId), target: '_blank', rel: 'noopener noreferrer' }, item.name ?? 'Objet inconnu')
    : h('span', { class: 'gear__name' }, item.name ?? 'Objet inconnu');
  // "Rare · Tête · niv. d’objet 27": the quality is also written, not only coloured.
  const subParts = [
    QUALITIES[item.quality] ?? null,
    item.slotName,
    typeof item.ilvl === 'number' ? ['niv. d’objet ', h('b', { class: 'gear__ilvl' }, item.ilvl)] : null,
  ].filter(Boolean);
  const sub = subParts.flatMap((part, i) => (i ? [' · ', part] : [part]));
  return h(
    'li',
    { class: 'gear__item', dataset: { quality: item.quality } },
    h(
      'span',
      { class: 'gear__frame', dataset: { quality: item.quality } },
      chainImage(icons, { class: 'gear__icon', width: 40, height: 40, loading: 'lazy' }, () => h('span', { class: 'gear__icon gear__icon--empty', 'aria-hidden': 'true' }, '?')),
    ),
    h(
      'div',
      { class: 'gear__text' },
      nameNode,
      sub.length ? h('span', { class: 'gear__sub' }, sub) : null,
      item.enchant ? h('span', { class: 'gear__enchant' }, item.enchant) : null,
    ),
  );
}

function statsList(stats) {
  const rows = [
    ['Santé', stats.health],
    [stats.powerType || 'Ressource', stats.power],
    ['Force', stats.strength],
    ['Agilité', stats.agility],
    ['Endurance', stats.stamina],
    ['Intelligence', stats.intellect],
    ['Esprit', stats.spirit],
    ['Armure', stats.armor],
  ].filter(([, value]) => typeof value === 'number');
  return rows.length ? h('dl', { class: 'facts' }, rows.map(([label, value]) => fact(label, num(value)))) : null;
}

function professionRow(profession) {
  const ratio = profession.max > 0 ? Math.min(profession.skill / profession.max, 1) : 0;
  const bar = h('span', { class: 'bar', 'aria-hidden': 'true' }, h('span', { class: 'bar__fill' }));
  bar.style.setProperty('--p', ratio);
  return h(
    'li',
    { class: 'profs__row' },
    h('span', null, profession.name),
    bar,
    h('span', { class: 'profs__value' }, profession.max ? `${profession.skill} / ${profession.max}` : profession.skill),
  );
}

function body(player, ctx) {
  const { xpTable, history, nowMs } = ctx;
  const note = stateNote(player);
  const levelUps = buildFeed([player], history, HISTORY_LENGTH);
  const stats = player.stats ? statsList(player.stats) : null;
  return h(
    'div',
    { class: 'stack sheet' },
    hero(player, xpTable),
    player.source === 'roster' ? h('p', { class: 'notice notice--info' }, 'Fiche complète disponible à partir du niveau 10.') : null,
    note && player.source !== 'roster' ? h('p', { class: 'notice notice--warn' }, note) : null,
    facts(player, xpTable, nowMs),
    player.gear?.length ? section('Équipement', h('ul', { class: 'gear' }, player.gear.map((item, index) => gearItem(item, index)))) : null,
    stats ? section('Caractéristiques', stats) : null,
    player.professions?.length ? section('Métiers', h('ul', { class: 'profs' }, player.professions.map(professionRow))) : null,
    player.talents?.length
      ? section('Talents', h('p', null, player.talents.map((talent, i) => [i ? ' · ' : null, h('span', { class: 'sheet__talent' }, talent.name), ' ', h('b', null, talent.points)])))
      : null,
    levelUps.length
      ? section('Derniers niveaux', h('ul', { class: 'sheet__levels' }, levelUps.map((event) =>
        h('li', null, `Niveau ${event.to} — ${dateTime(new Date(event.t * 1000).toISOString())}`))))
      : null,
  );
}

async function copySheetLink(player) {
  const link = `${location.origin}${location.pathname}#p=${encodeURIComponent(player.id)}`;
  if (await copyText(link)) toast('Lien de la fiche copié.', { kind: 'success' });
  else toast('Copie impossible depuis ce navigateur.', { kind: 'error' });
}

/** Returns { playerId, update(player, ctx), close() }. */
export function openSheet(player, ctx, onClose) {
  const modal = dialog({
    title: tint(h('span', { class: 'sheet__name' }, fullName(player)), player),
    content: body(player, ctx),
    wide: true,
    // Read-only content: the first thing to reach is the way out, not an item link.
    focus: 'close',
    onClose,
    actions: [
      player.source === 'profile'
        ? h('a', {
          class: 'btn btn--primary',
          href: armoryUrl(player.region, player.slug),
          target: '_blank',
          rel: 'noopener noreferrer',
        }, 'Voir sur l’armurerie officielle', icon('external', 14))
        : null,
      h('button', { class: 'btn', type: 'button', on: { click: () => copySheetLink(player) } }, icon('copy', 16), 'Copier le lien de cette fiche'),
    ],
  });
  const bodyEl = modal.el.querySelector('.dialog__body');
  return {
    playerId: player.id,
    close: modal.close,
    update(next, nextCtx) {
      const scroll = bodyEl.scrollTop;
      const focused = focusKey(bodyEl);
      bodyEl.replaceChildren(body(next, nextCtx));
      bodyEl.scrollTop = scroll;
      focusByKey(focused, bodyEl);
    },
  };
}
