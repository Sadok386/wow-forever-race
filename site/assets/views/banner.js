// Status banner: what the last synchronisation had to say, and a refresh failure notice.
import { h } from '../dom.js';

const TONES = { 'no-credentials': 'error', 'auth-failed': 'error', 'api-error': 'error', partial: 'warn' };

function warningList(warnings) {
  return h(
    'details',
    { class: 'notice__more' },
    h('summary', null, warnings.length === 1 ? '1 avertissement' : `${warnings.length} avertissements`),
    h('ul', null, warnings.map((warning) => h('li', null, warning))),
  );
}

export function renderBanner(ctx) {
  const status = ctx.data?.status;
  const warnings = Array.isArray(status?.warnings) ? status.warnings : [];
  const notices = [];

  if (ctx.loadError && ctx.data) {
    notices.push(h('div', { class: 'notice notice--info', role: 'status' },
      'Actualisation impossible pour l’instant : les données affichées datent du dernier relevé réussi.'));
  }
  if (status && (status.code !== 'ok' || warnings.length)) {
    const tone = TONES[status.code] ?? 'info';
    notices.push(h(
      'div',
      { class: `notice notice--${tone}` },
      status.message ? h('p', null, status.message) : null,
      warnings.length ? warningList(warnings) : null,
    ));
  }
  return notices.length ? notices : null;
}
