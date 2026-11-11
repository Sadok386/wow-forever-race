// Page header: title, freshness, refresh and the edit entry points.
import { copyText, h, toast } from '../dom.js';
import { icon } from '../icons.js';
import { fullName } from '../format.js';
import { rankPlayers } from '../model.js';
import { timeEl } from './time.js';

const STALE_AFTER_MIN = 45;
const STALE_TITLE = 'Les synchronisations planifiées de GitHub prennent parfois du retard.';

function menuItem(label, onClick) {
  return h('li', null, h('button', { class: 'menu__item', type: 'button', on: { click: onClick } }, label));
}

async function copyShareLink(edit) {
  const link = edit.shareLink();
  if (!link) {
    toast('Aucun lien de modification à copier.', { kind: 'error' });
    return;
  }
  if (await copyText(link)) toast('Lien de modification copié.', { kind: 'success' });
  else toast('Copie impossible depuis ce navigateur.', { kind: 'error' });
}

/** Items close the menu and hand focus back to its button first, so dialogs return focus there. */
function editMenu(edit) {
  const run = (action) => (event) => {
    const menu = event.currentTarget.closest('details');
    menu.open = false;
    menu.querySelector('summary').focus();
    action();
  };
  return h(
    'details',
    { class: 'menu' },
    h('summary', { class: 'btn btn--icon btn--ghost', 'aria-label': 'Plus d’actions', dataset: { key: 'menu' } }, icon('more', 20)),
    h(
      'ul',
      { class: 'menu__list' },
      menuItem('Synchroniser maintenant', run(() => edit.requestSync())),
      menuItem('Copier le lien de modification', run(() => copyShareLink(edit))),
      menuItem('Verrouiller', run(() => edit.lock())),
    ),
  );
}

// Both states of the main edit button share one key: once a dialog has unlocked the site, focus
// returns to the button that took the place of the one that opened it.
function editControls(edit) {
  if (!edit.isUnlocked()) {
    return h('button', {
      class: 'btn',
      type: 'button',
      dataset: { key: 'edit' },
      on: { click: () => edit.openEdit() },
    }, icon('lock', 16), 'Modifier la liste');
  }
  return [
    h('button', {
      class: 'btn btn--primary',
      type: 'button',
      dataset: { key: 'edit' },
      on: { click: () => edit.openAdd() },
    }, icon('plus', 16), 'Ajouter un personnage'),
    editMenu(edit),
  ];
}

/** "7 personnages · en tête : Corwin Maelis, niveau 44 · objectif niveau 60 · 2 l’ont atteint"; null without a level. */
function raceSummary({ data, goalLevel }) {
  const { ranked } = rankPlayers(data?.players ?? [], goalLevel);
  if (!ranked.length) return null;
  const leader = ranked[0];
  const finishers = ranked.filter((player) => player.level >= goalLevel).length;
  return [
    ranked.length === 1 ? '1 personnage' : `${ranked.length} personnages`,
    `en tête : ${fullName(leader)}, niveau ${leader.level}`,
    `objectif niveau ${goalLevel}`,
    finishers ? (finishers === 1 ? '1 l’a atteint' : `${finishers} l’ont atteint`) : null,
  ].filter(Boolean).join(' · ');
}

export function renderHeader(ctx) {
  const { data, edit } = ctx;
  const summary = raceSummary(ctx);
  return [
    h(
      'div',
      { class: 'site-header__banner' },
      h('p', { class: 'site-header__eyebrow' }, 'WoW Forever'),
      h('h1', { class: 'site-header__title' }, data?.settings?.title || 'RUSH 60'),
      h('div', { class: 'divider', 'aria-hidden': 'true' }),
      summary ? h('p', { class: 'site-header__summary' }, summary) : null,
      h('p', { class: 'site-header__replay' }, h('button', {
        class: 'btn btn--small btn--ghost',
        type: 'button',
        dataset: { key: 'replay-intro' },
        on: { click: () => ctx.replayIntro() },
      }, icon('play', 14), 'Rejouer l’intro')),
    ),
    h(
      'div',
      { class: 'site-header__tools' },
      h(
        'p',
        { class: 'freshness' },
        data?.generatedAt
          ? timeEl(data.generatedAt, { prefix: 'Mis à jour ', staleAfter: STALE_AFTER_MIN, staleTitle: STALE_TITLE })
          : null,
      ),
      h('button', {
        class: 'btn btn--icon btn--ghost',
        type: 'button',
        'aria-label': 'Actualiser les données',
        dataset: { key: 'refresh' },
        on: { click: (event) => ctx.refresh(event.currentTarget) },
      }, icon('refresh', 20)),
      editControls(edit),
    ),
  ];
}

/** A <details> menu has no outside-click behaviour of its own. */
export function setupMenuDismiss() {
  const openMenus = () => document.querySelectorAll('details.menu[open]');
  document.addEventListener('click', (event) => {
    for (const menu of openMenus()) if (!menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    for (const menu of openMenus()) {
      menu.open = false;
      menu.querySelector('summary').focus();
    }
  });
}
