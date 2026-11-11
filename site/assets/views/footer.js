import { h } from '../dom.js';

export function renderFooter(ctx) {
  const repo = ctx.data?.repo;
  return [
    h('div', { class: 'divider divider--small', 'aria-hidden': 'true' }),
    h(
      'p',
      null,
      'Les niveaux viennent de l’API officielle de Blizzard et sont relevés environ toutes les 15 minutes. Un personnage n’est mis à jour que lorsqu’il se déconnecte.',
    ),
    h(
      'p',
      { class: 'row site-footer__links' },
      repo
        ? h('a', {
          href: `https://github.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`,
          target: '_blank',
          rel: 'noopener noreferrer',
        }, 'Code source')
        : null,
      h('button', { class: 'linklike', type: 'button', dataset: { key: 'setup' }, on: { click: () => ctx.edit.openSetup() } }, 'Configuration'),
    ),
    h('p', { class: 'site-footer__motto' }, 'Que le meilleur atteigne le 60.'),
    h('p', { class: 'site-footer__legal' }, 'Site de fans, sans lien avec Blizzard Entertainment.'),
  ];
}
