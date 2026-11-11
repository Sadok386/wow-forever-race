// The intro: a video shown once per browser, full page on black, before the race. Watching it to
// the end, "Passer" or the Escape key close it for good (remembered in localStorage).
//
// Browsers refuse to start a video with sound before the visitor has clicked on the page, so the
// intro opens on a splash with a play button; when the browser does allow it, the video starts
// at once.
import { h } from './dom.js';
import { icon } from './icons.js';

const SEEN_KEY = 'wft.introSeen';
// Change it when the video changes, so that everyone sees the new one once.
const VERSION = '1';
const SOURCE = 'media/intro.mp4';
const LENGTH_LABEL = '2 min 45';
const FADE_MS = 500;

/** The intro must be shown once only: without working storage it is not shown at all. */
function storage() {
  try {
    const store = globalThis.localStorage;
    store.setItem('wft.probe', '1');
    store.removeItem('wft.probe');
    return store;
  } catch {
    return null;
  }
}

/** Shows the intro unless this browser has already seen it; resolves once it is gone. */
export function showIntro() {
  const store = storage();
  if (!store || store.getItem(SEEN_KEY) === VERSION) return Promise.resolve(false);

  return new Promise((resolve) => {
    let closing = false;

    const video = h('video', {
      class: 'intro__video', src: SOURCE, preload: 'auto', playsinline: true, 'aria-hidden': 'true',
    });
    const play = h(
      'button',
      { class: 'intro__play', type: 'button' },
      h('span', { class: 'intro__play-ring', 'aria-hidden': 'true' }, icon('play', 36)),
      'Lancer l’intro',
    );
    const skip = h('button', { class: 'btn intro__skip', type: 'button' }, 'Passer', icon('skip', 16));
    const el = h(
      'dialog',
      { class: 'intro', 'aria-label': 'Intro de la course' },
      video,
      h(
        'div',
        { class: 'intro__splash' },
        h('p', { class: 'site-header__eyebrow' }, 'WoW Forever'),
        h('p', { class: 'site-header__title intro__title' }, 'Que la course commence'),
        h('div', { class: 'divider', 'aria-hidden': 'true' }),
        play,
        h('p', { class: 'intro__meta' }, `${LENGTH_LABEL} · avec le son`),
      ),
      h('div', { class: 'intro__progress', 'aria-hidden': 'true' }, h('span', { class: 'intro__progress-bar' })),
      skip,
    );

    function finish(remember) {
      if (closing) return;
      closing = true;
      if (remember) {
        try {
          store.setItem(SEEN_KEY, VERSION);
        } catch {
          // Storage worked a moment ago; at worst the intro shows once more.
        }
      }
      video.pause();
      el.classList.add('is-leaving');
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      setTimeout(() => {
        // Dropping the source stops the download of a video nobody watches any more.
        video.removeAttribute('src');
        video.load();
        if (el.open) el.close();
        el.remove();
        resolve(true);
      }, reduced ? 0 : FADE_MS);
    }

    function start() {
      return video.play().then(() => {
        el.classList.add('is-playing');
        // The play button is gone: keyboard users land on "Passer".
        if (el.contains(document.activeElement)) skip.focus({ preventScroll: true });
      });
    }

    play.addEventListener('click', () => {
      start().catch(() => finish(false));
    });
    skip.addEventListener('click', () => finish(true));
    // Escape closes a modal dialog: here it means "Passer".
    el.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(true);
    });
    video.addEventListener('ended', () => finish(true));
    // A missing or unreadable video never blocks the site, and is not remembered as seen.
    video.addEventListener('error', () => finish(false));
    video.addEventListener('timeupdate', () => {
      if (video.duration > 0) el.style.setProperty('--p', Math.min(video.currentTime / video.duration, 1));
    });

    document.body.append(el);
    el.showModal();
    play.focus({ preventScroll: true });
    // Allowed by some browsers without a click; otherwise the splash waits for one.
    start().catch(() => {});
  });
}
