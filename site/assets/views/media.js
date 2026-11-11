// Images with fallback chains: a broken URL must never leave a broken-image icon on the page.
import { h } from '../dom.js';
import { classIconUrl, safeImageUrl } from '../shared.js';
import { tint } from './identity.js';

/** Tries each URL in turn, then swaps in whatever `fallback()` builds. Always returns a node. */
export function chainImage(urls, props, fallback) {
  const queue = urls.filter(Boolean);
  if (!queue.length) return fallback();
  const img = h('img', { alt: '', decoding: 'async', ...props, src: queue[0] });
  img.addEventListener('error', () => {
    queue.shift();
    if (queue.length) img.src = queue[0];
    else img.replaceWith(fallback());
  });
  return img;
}

/** The avatar URL with the logout time as cache buster, so a new look shows up after the next logout. */
function versioned(url, lastLoginAt) {
  const safe = safeImageUrl(url);
  const stamp = Date.parse(lastLoginAt);
  if (!safe || Number.isNaN(stamp)) return safe;
  const out = new URL(safe);
  out.searchParams.set('v', stamp);
  return out.href;
}

export function initialsDisc(name, surname) {
  const first = (s) => Array.from(s ?? '')[0] ?? '';
  return h('span', { class: 'avatar__initials', 'aria-hidden': 'true' }, (first(name) + first(surname)).toUpperCase());
}

// URLs that already loaded once: a rebuilt lane shows them at once instead of flashing the fallback.
const loaded = new Set();

/** Adds the image to `el` once it has loaded; on error it is simply dropped. `layer` keeps the stacking order whatever loads first. */
function overlay(el, url, size, layer) {
  if (!url) return;
  const img = h('img', { alt: '', decoding: 'async', width: size, height: size });
  img.style.zIndex = layer;
  if (loaded.has(url)) {
    img.src = url;
    el.append(img);
    return;
  }
  // Not attached yet, so a failure needs no cleanup; the layers below stay visible.
  img.addEventListener('load', () => {
    loaded.add(url);
    el.append(img);
  }, { once: true });
  img.src = url;
}

/**
 * Round portrait ringed in the class colour. Layers, bottom to top: initials (always there), class
 * icon, avatar; each image only appears once it has loaded, so the disc is never empty.
 */
export function avatar(player, { large = false } = {}) {
  const size = large ? 96 : 52;
  const el = tint(h('div', { class: large ? 'avatar avatar--large' : 'avatar' }), player);
  el.append(initialsDisc(player.name, player.surname));
  overlay(el, classIconUrl(player.class?.id), size, 1);
  overlay(el, versioned(player.avatar, player.lastLoginAt), size, 2);
  return el;
}
