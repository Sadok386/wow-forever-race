// "Derniers niveaux": the level-ups observed between two synchronisations.
import { h } from '../dom.js';
import { buildFeed } from '../model.js';
import { fullName } from '../format.js';
import { tint } from './identity.js';
import { timeEl } from './time.js';

const level = (n) => h('b', { class: 'feed__level' }, n);

function entry(event, player, ctx) {
  const sentence = event.to === event.from + 1
    ? [' passe niveau ', level(event.to)]
    : [' passe du niveau ', level(event.from), ' au niveau ', level(event.to)];
  return h(
    'li',
    { class: 'feed__item' },
    h('span', { class: 'feed__tag' }, 'Ding !'),
    h(
      'span',
      { class: 'feed__text' },
      tint(h('button', { class: 'linklike feed__name', type: 'button', dataset: { key: `feed:${player.id}:${event.t}` }, on: { click: () => ctx.openSheet(player) } }, `[${fullName(player)}]`), player),
      sentence,
    ),
    timeEl(new Date(event.t * 1000).toISOString()),
  );
}

export function renderFeed(ctx, players) {
  const byId = new Map(players.map((player) => [player.id, player]));
  const events = buildFeed(players, ctx.history);
  return [
    h('h2', { class: 'section__title', id: 'feed-title' }, 'Derniers niveaux'),
    events.length
      ? h('ul', { class: 'feed card' }, events.map((event) => entry(event, byId.get(event.id), ctx)))
      : h('p', { class: 'muted' }, 'Aucun passage de niveau observé pour l’instant.'),
  ];
}
