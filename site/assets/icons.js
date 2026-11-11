// Inline SVG icons (24x24 grid, drawn with the current text colour). No emoji, no icon font.
import { svg } from './dom.js';

const SHAPES = {
  crown: [['path', { d: 'M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z', fill: 'currentColor' }]],
  refresh: [['path', { d: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7' }]],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  lock: [['path', { d: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3' }]],
  unlock: [['path', { d: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 6.8-1.2' }]],
  more: [
    ['circle', { cx: 5, cy: 12, r: 1.6, fill: 'currentColor' }],
    ['circle', { cx: 12, cy: 12, r: 1.6, fill: 'currentColor' }],
    ['circle', { cx: 19, cy: 12, r: 1.6, fill: 'currentColor' }],
  ],
  external: [['path', { d: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5' }]],
  copy: [['rect', { x: 9, y: 9, width: 11, height: 11, rx: 2 }], ['path', { d: 'M5 15V6a2 2 0 0 1 2-2h9' }]],
  check: [['path', { d: 'M5 12.5l4.5 4.5L19 7.5' }]],
  flag: [['path', { d: 'M5 21V4M5 4h12l-2 4 2 4H5' }]],
  close: [['path', { d: 'M6 6l12 12M18 6L6 18' }]],
  alert: [['path', { d: 'M12 4l9 16H3L12 4zM12 10v4M12 17h.01' }]],
  search: [['circle', { cx: 11, cy: 11, r: 6 }], ['path', { d: 'M16 16l4 4' }]],
  trash: [['path', { d: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v5M14 11v5' }]],
  play: [['path', { d: 'M8 5.5v13l10.5-6.5z', fill: 'currentColor' }]],
  skip: [['path', { d: 'M6 6.5v11l8.5-5.5z', fill: 'currentColor' }], ['path', { d: 'M18 6v12' }]],
};

export function icon(name, size = 18) {
  return svg(
    'svg',
    {
      class: 'icon',
      viewBox: '0 0 24 24',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    (SHAPES[name] ?? []).map(([tag, attrs]) => svg(tag, attrs)),
  );
}
