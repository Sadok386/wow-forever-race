// Relative times ("il y a 4 min") that keep ticking without a re-render.
import { h } from '../dom.js';
import { dateTime, relTime } from '../format.js';

/** `staleAfter` (minutes) and `staleTitle` turn the element into a warning once the time is old. */
export function timeEl(iso, { prefix = '', staleAfter, staleTitle } = {}) {
  if (!iso) return null;
  const el = h('time', {
    datetime: iso,
    title: dateTime(iso),
    dataset: { rel: iso, prefix, staleAfter, staleTitle },
  });
  refreshTime(el, Date.now());
  return el;
}

// A stale time says so in words ("en retard"), the orange colour only reinforces it.
const LATE = ' · en retard';

function refreshTime(el, nowMs) {
  const { rel, prefix = '', staleAfter, staleTitle } = el.dataset;
  const stale = Boolean(staleAfter) && nowMs - Date.parse(rel) > Number(staleAfter) * 60000;
  el.textContent = prefix + relTime(rel, nowMs) + (stale ? LATE : '');
  if (staleAfter) {
    el.classList.toggle('is-stale', stale);
    el.title = stale ? staleTitle : dateTime(rel);
  }
}

export function refreshTimes(root, nowMs) {
  for (const el of root.querySelectorAll('time[data-rel]')) refreshTime(el, nowMs);
}
