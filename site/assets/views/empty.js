// Full-section states shown instead of the race: loading, no data yet, failure, empty roster.
import { h } from '../dom.js';
import { icon } from '../icons.js';

const card = (...children) => h('div', { class: 'empty ornate stack' }, children);

export function renderLoading() {
  return card(h('p', { class: 'row' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Chargement…'));
}

export function renderNoData(ctx) {
  return card(
    h('h2', { class: 'empty__title' }, 'Première synchronisation'),
    h('p', null, 'Le suivi démarre : la première synchronisation est en cours. Recharge la page dans une minute.'),
    h('p', null, h('button', { class: 'btn', type: 'button', dataset: { key: 'refresh-state' }, on: { click: (event) => ctx.refresh(event.currentTarget) } }, icon('refresh', 16), 'Vérifier maintenant')),
  );
}

export function renderLoadFailure(ctx) {
  return card(
    h('h2', { class: 'empty__title' }, 'Chargement impossible'),
    h('p', null, 'Les données du suivi n’ont pas pu être chargées. Vérifie ta connexion puis réessaie.'),
    h('p', null, h('button', { class: 'btn', type: 'button', dataset: { key: 'refresh-state' }, on: { click: (event) => ctx.refresh(event.currentTarget) } }, icon('refresh', 16), 'Réessayer')),
  );
}

/** The next step depends on how far the owner got: nothing set up, set up but locked, or unlocked. */
export function renderEmptyRoster({ edit }) {
  let text;
  let button;
  if (edit.isUnlocked()) {
    text = 'Ajoute le premier personnage pour lancer le rush.';
    button = h('button', { class: 'btn btn--primary', type: 'button', dataset: { key: 'add-empty' }, on: { click: () => edit.openAdd() } }, icon('plus', 16), 'Ajouter un personnage');
  } else if (edit.isConfigured()) {
    text = 'Déverrouille la modification avec ton lien pour ajouter les premiers personnages.';
    button = h('button', { class: 'btn', type: 'button', dataset: { key: 'unlock-empty' }, on: { click: () => edit.openEdit() } }, icon('lock', 16), 'Modifier la liste');
  } else {
    text = 'Commence par activer le lien de modification, puis ajoute tes amis au rush.';
    button = h('button', { class: 'btn btn--primary', type: 'button', dataset: { key: 'setup-empty' }, on: { click: () => edit.openEdit() } }, 'Configurer le site');
  }
  return card(
    h('h2', { class: 'empty__title' }, 'Le rush n’a pas encore commencé'),
    h('p', null, text),
    h('p', null, button),
  );
}
