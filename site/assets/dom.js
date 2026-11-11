// Tiny DOM toolkit. Content is only ever built with createElement / textContent (the CSP forbids
// inline styles and scripts, and dynamic data must never be parsed as HTML).

import { icon } from './icons.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const isProps = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Node);

function applyProps(el, props) {
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'dataset') applyDataset(el, value);
    else if (key === 'on') for (const [type, fn] of Object.entries(value)) el.addEventListener(type, fn);
    // An inline style attribute would be blocked by the CSP; CSSOM writes are the way to style.
    else if (key !== 'style') el.setAttribute(key, value === true ? '' : String(value));
  }
}

function applyDataset(el, dataset) {
  for (const [name, value] of Object.entries(dataset)) {
    if (value !== null && value !== undefined) el.dataset[name] = value;
  }
}

function appendChildren(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) appendChildren(el, child);
    else el.append(child instanceof Node ? child : String(child));
  }
}

function build(el, props, children) {
  if (isProps(props)) applyProps(el, props);
  else children.unshift(props);
  appendChildren(el, children);
  return el;
}

export function h(tag, props, ...children) {
  return build(document.createElement(tag), props, children);
}

export function svg(tag, attrs, ...children) {
  return build(document.createElementNS(SVG_NS, tag), attrs, children);
}

export function clear(el) {
  el.replaceChildren();
}

/** The stable key of the element holding focus (its nearest [data-key]), or null. */
export function focusKey(root = document) {
  const active = document.activeElement;
  if (!active || !root.contains(active)) return null;
  return active.closest('[data-key]')?.dataset.key ?? null;
}

/** Focuses the element carrying `key` inside `root`; true when there is one. */
export function focusByKey(key, root = document) {
  if (!key) return false;
  const target = [...root.querySelectorAll('[data-key]')].find((el) => el.dataset.key === key);
  if (!target) return false;
  target.focus({ preventScroll: true });
  return true;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let dialogCount = 0;

/**
 * A modal <dialog>. Escape (native) and a click on the backdrop close it; focus goes to the first
 * field or button (or to the close button with `focus: 'close'`, for read-only content) and returns
 * to the opener afterwards. `title` may be a string or a node.
 */
export function dialog({ title, content, actions, wide = false, focus = 'content', onClose } = {}) {
  const opener = document.activeElement;
  const openerKey = opener instanceof HTMLElement ? opener.closest('[data-key]')?.dataset.key ?? null : null;
  const titleId = `dialog-title-${++dialogCount}`;
  // Last in the DOM so that focus starts on the content, but drawn in the top corner.
  const closeButton = h('button', {
    class: 'btn btn--icon btn--primary dialog__close',
    type: 'button',
    'aria-label': 'Fermer',
    on: { click: () => el.close() },
  }, icon('close', 14));
  const el = h(
    'dialog',
    { class: wide ? 'dialog dialog--wide ornate' : 'dialog ornate', 'aria-labelledby': titleId },
    h('h2', { class: 'dialog__title', id: titleId }, title),
    h('div', { class: 'divider dialog__rule', 'aria-hidden': 'true' }),
    h('div', { class: 'dialog__body' }, content),
    actions && actions.length ? h('div', { class: 'dialog__actions' }, actions) : null,
    // Toasts are announced here while the dialog is open (the page behind it is inert).
    h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite', dataset: { live: '' } }),
    closeButton,
  );

  // A click that targets the element itself landed on the backdrop or on bare dialog surface (the
  // divider leaves some): only a pointer outside the dialog's box closes it.
  el.addEventListener('click', (event) => {
    if (event.target !== el) return;
    const box = el.getBoundingClientRect();
    const outside = event.clientX < box.left || event.clientX > box.right
      || event.clientY < box.top || event.clientY > box.bottom;
    if (outside) el.close();
  });
  el.addEventListener('close', () => {
    el.remove();
    // A page refresh may have replaced the opener: use its twin, else the main landmark.
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    else if (!focusByKey(openerKey)) document.getElementById('main')?.focus({ preventScroll: true });
    onClose?.();
  });

  document.body.append(el);
  el.showModal();
  const body = el.querySelector('.dialog__body');
  const first = focus === 'close'
    ? closeButton
    : body.querySelector('[autofocus]') ?? body.querySelector(FOCUSABLE) ?? el.querySelector(FOCUSABLE);
  first?.focus({ preventScroll: true });
  return { el, close: () => el.open && el.close() };
}

/** Resolves true only when the confirm button is used; Escape, backdrop and "Annuler" resolve false. */
export function confirm({ title, message, confirmLabel = 'Confirmer', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    const modal = dialog({
      title,
      content: h('p', null, message),
      actions: [
        h('button', { class: 'btn btn--ghost', type: 'button', on: { click: () => modal.close() } }, 'Annuler'),
        h('button', {
          class: danger ? 'btn btn--danger' : 'btn btn--primary',
          type: 'button',
          on: { click: () => { answer = true; modal.close(); } },
        }, confirmLabel),
      ],
      onClose: () => resolve(answer),
    });
  });
}

// Toasts live in a popover so that they are drawn above an open modal dialog (top layer).
let toastHost = null;

function getToastHost() {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts', popover: 'manual' });
    document.body.append(toastHost);
  }
  return toastHost;
}

// One persistent, visually hidden live region receives the text of every toast: a region that exists
// before its content changes is announced reliably, unlike a popover that appears with its text.
// Open dialogs carry their own (everything outside a modal dialog is inert).
const pageLive = typeof document === 'undefined'
  ? null
  : h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite', dataset: { live: '' } });
if (pageLive) document.body.append(pageLive);

function announce(message) {
  for (const region of document.querySelectorAll('[data-live]')) {
    region.textContent = '';
    setTimeout(() => { region.textContent = message; }, 50);
  }
}

function raiseToasts(host) {
  try {
    if (host.matches(':popover-open')) host.hidePopover();
    host.showPopover();
  } catch {
    // Browsers without the Popover API still show the toasts, just not above a modal.
  }
}

/** Errors and toasts with a link stay until closed: they must be read, and the link reached. */
export function toast(message, { kind = 'info', timeout = 5000, action } = {}) {
  const host = getToastHost();
  announce(message);
  const item = h(
    'div',
    { class: `toast toast--${kind}` },
    h('span', { class: 'toast__text' }, message),
    action ? h('a', { class: 'toast__action', href: action.href, target: '_blank', rel: 'noopener noreferrer' }, action.label) : null,
  );
  const dismiss = () => {
    item.remove();
    if (!host.children.length) try { host.hidePopover(); } catch { /* already hidden */ }
  };
  item.append(h('button', { class: 'toast__close', type: 'button', 'aria-label': 'Fermer la notification', on: { click: dismiss } }, icon('close', 14)));
  host.append(item);
  raiseToasts(host);
  if (timeout > 0 && kind !== 'error' && !action) setTimeout(dismiss, timeout);
  return dismiss;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = h('textarea', { class: 'sr-only', 'aria-hidden': 'true', tabindex: '-1', readonly: true });
    area.value = text;
    document.body.append(area);
    area.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    area.remove();
    return copied;
  }
}
