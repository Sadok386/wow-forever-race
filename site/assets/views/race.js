// "Le classement" (lanes) and "En attente" (characters without a level yet).
import { h } from '../dom.js';
import { armorySearchUrl } from '../shared.js';
import { fullName } from '../format.js';
import { renderGhost, renderLane } from './lane.js';
import { playedByNodes, stateNote } from './identity.js';

export function renderRace(ctx, ranked) {
  const lanes = [
    ...ranked.map((player, index) => renderLane(player, index + 1, ctx)),
    ...ctx.edit.pendingAdds().map(renderGhost),
  ];
  return [
    h('h2', { class: 'section__title', id: 'race-title' }, 'Le classement'),
    lanes.length
      ? h('ol', { class: 'lanes' }, lanes)
      : h('p', { class: 'muted' }, 'Personne n’a encore de niveau connu : le classement démarre dès qu’un personnage apparaît.'),
  ];
}

function waitingRow(player, ctx) {
  const leaving = ctx.removals.has(player.id);
  const note = leaving ? 'Retrait en cours…' : stateNote(player);
  const playedBy = playedByNodes(player, ctx, { leaving, keyPrefix: 'wait' });
  return h(
    'li',
    { class: leaving ? 'waiting__row lane--leaving' : 'waiting__row' },
    h(
      'div',
      { class: 'waiting__who' },
      h('span', { class: 'waiting__name' }, fullName(player)),
      playedBy ? h('span', { class: 'muted' }, ' · ', playedBy) : null,
      note ? h('span', { class: 'lane__note' }, ` · ${note}`) : null,
    ),
    h(
      'div',
      { class: 'row' },
      h('a', {
        class: 'btn btn--small btn--ghost',
        href: armorySearchUrl(player.region, player.name, player.surname),
        target: '_blank',
        rel: 'noopener noreferrer',
        'aria-label': `Chercher sur l’armurerie : ${fullName(player)} (nouvel onglet)`,
        dataset: { key: `wait:${player.id}:search` },
      }, 'Chercher sur l’armurerie'),
      ctx.edit.isUnlocked() && !leaving
        ? h('button', {
          class: 'btn btn--small btn--ghost',
          type: 'button',
          'aria-label': `Retirer ${fullName(player)}`,
          dataset: { key: `wait:${player.id}:remove` },
          on: { click: () => ctx.edit.requestRemove(player) },
        }, 'Retirer')
        : null,
    ),
  );
}

export function renderWaiting(ctx, waiting) {
  if (!waiting.length) return null;
  return [
    h('h2', { class: 'section__title', id: 'waiting-title' }, 'En attente'),
    h('p', { class: 'parchment' }, 'Un personnage apparaît à partir du niveau 10, après s’être déconnecté une fois. Vérifie aussi l’orthographe des deux noms.'),
    h('ul', { class: 'waiting card' }, waiting.map((player) => waitingRow(player, ctx))),
  ];
}
