// Shared editing: unlock with the edit link, add / remove characters and trigger syncs by
// dispatching the repository workflow, follow the dispatched operations, and the owner set-up.
// The token lives in memory only; the key (kept in localStorage) never goes anywhere.

import { h, dialog, confirm, toast, copyText } from './dom.js';
import { icon } from './icons.js';
import { fullName } from './format.js';
import {
  decryptToken, encryptToken, extractKey, generateKey, keyCandidates, parseFragmentKey, settleKeys,
} from './crypto.js';
import {
  createGitHub, GitHubError, isFailedRun, isSyncResolved, safeRunUrl,
} from './github.js';
import {
  REGIONS, REGION_LABELS, LABEL_MAX, armorySearchUrl, cleanLabel, normalizeName, parseCharacterInput, playerId, validateName,
} from './shared.js';

const KEY_STORAGE = 'wft.editKey';
const NEXT_KEY_STORAGE = 'wft.editKeyNext';
const REGION_STORAGE = 'wft.region';
const PENDING_STORAGE = 'wft.pending';
const AUTO_SYNC_STORAGE = 'wft.autoSyncAt';

const POLL_MS = 5000;
const OPERATION_TTL_MS = 10 * 60 * 1000;
const STALE_DATA_MS = 25 * 60 * 1000;
const AUTO_SYNC_COOLDOWN_MS = 10 * 60 * 1000;
const ACTIVATION_TTL_MS = 10 * 60 * 1000;
const BUSY_RUN_STATUSES = new Set(['queued', 'in_progress', 'requested', 'waiting', 'pending']);

const MSG = {
  notActive: 'La modification partagée n’est pas encore activée sur ce site.',
  wrongKey: 'Cette clé ne correspond pas à ce site.',
  notLiveYet: 'Le nouveau lien n’est pas encore actif : réessaie dans une minute.',
  noKeyInLink: 'Ce lien ne contient pas de clé de modification.',
  expired: 'Le lien de modification a expiré : demande au propriétaire du site de le renouveler.',
  noData: 'Le site n’a pas encore de données : réessaie dans une minute.',
  unreadable: 'Impossible de lire la configuration du site. Vérifie ta connexion.',
  locked: 'La modification n’est pas déverrouillée.',
  duplicate: 'Ce personnage est déjà suivi.',
  generic: 'Une erreur est survenue. Réessaie dans un instant.',
  workflowOff: 'Le suivi automatique est désactivé sur GitHub.',
};

/** A failure whose French message can be shown as it is. */
class EditError extends Error {}

const messageOf = (error) => (error instanceof EditError || error instanceof GitHubError ? error.message : MSG.generic);

/* ---------- storage (every access may throw: private mode, blocked site data) ---------- */

function storageOf(kind) {
  try {
    return globalThis[kind] ?? null;
  } catch {
    return null;
  }
}

function readStore(kind, name) {
  try {
    return storageOf(kind)?.getItem(name) ?? null;
  } catch {
    return null;
  }
}

function writeStore(kind, name, value) {
  try {
    if (value === null) storageOf(kind)?.removeItem(name);
    else storageOf(kind)?.setItem(name, value);
  } catch {
    // Without storage the feature still works for this page view.
  }
}

function loadPending() {
  try {
    const list = JSON.parse(readStore('sessionStorage', PENDING_STORAGE) ?? '[]');
    return Array.isArray(list)
      ? list.filter((op) => op && ['add', 'remove', 'sync'].includes(op.kind) && Number.isFinite(op.at))
      : [];
  } catch {
    return [];
  }
}

/* ---------- small form kit ---------- */

let uid = 0;

function field({ label, control, hint }) {
  const id = `edit-field-${++uid}`;
  const error = h('p', { class: 'field__error', id: `${id}-error`, hidden: true });
  control.id = id;
  control.setAttribute('aria-describedby', `${id}-error`);
  return {
    control,
    el: h('div', { class: 'field' }, h('label', { for: id }, label), control, hint ? h('p', { class: 'field__hint' }, hint) : null, error),
    setError(message) {
      error.hidden = !message;
      error.textContent = message ?? '';
      if (message) control.setAttribute('aria-invalid', 'true');
      else control.removeAttribute('aria-invalid');
    },
  };
}

// Buttons that had keyboard focus when they were disabled: a disabled button drops it.
const focusedWhenBusy = new WeakSet();

function setBusy(button, busy, label) {
  if (busy && document.activeElement === button) focusedWhenBusy.add(button);
  button.disabled = busy;
  button.replaceChildren(...(busy ? [h('span', { class: 'spinner', 'aria-hidden': 'true' }), label] : [label]));
  if (!busy && focusedWhenBusy.delete(button) && button.isConnected
    && (!document.activeElement || document.activeElement === document.body)) {
    button.focus({ preventScroll: true });
  }
}

/** A real <form>: Enter submits it, the submit button sits in the dialog's action bar. */
function formDialog({ title, body, submitLabel, onSubmit, onClose }) {
  const formId = `edit-form-${++uid}`;
  const errorBox = h('div', { class: 'notice notice--error', role: 'alert', hidden: true });
  const submit = h('button', { class: 'btn btn--primary', type: 'submit', form: formId }, submitLabel);
  const cancel = h('button', { class: 'btn btn--ghost', type: 'button', on: { click: () => modal.close() } }, 'Annuler');
  let busy = false;
  let done = false;

  const showError = (message) => {
    errorBox.hidden = !message;
    errorBox.textContent = message ?? '';
  };
  const form = h('form', {
    class: 'stack',
    id: formId,
    novalidate: true,
    on: {
      async submit(event) {
        event.preventDefault();
        if (busy || done) return;
        busy = true;
        showError(null);
        setBusy(submit, true, submitLabel);
        try {
          await onSubmit();
        } catch (error) {
          showError(messageOf(error));
        } finally {
          busy = false;
          setBusy(submit, false, submitLabel);
        }
      },
    },
  }, ...body, errorBox);
  const modal = dialog({ title, content: form, actions: [cancel, submit], onClose });
  return {
    modal, form, submit, cancel, showError, finish() { done = true; },
  };
}

function infoDialog(title, ...content) {
  const modal = dialog({
    title,
    content: h('div', { class: 'stack' }, content),
    actions: [h('button', { class: 'btn btn--primary', type: 'button', on: { click: () => modal.close() } }, 'Fermer')],
  });
  return modal;
}

/** A token is printable ASCII without spaces; anything else was copied wrongly and would break the header. */
function tokenProblem(secret) {
  if (!secret) return 'Colle le jeton créé à l’étape 1.';
  return /^[!-~]+$/.test(secret) ? null : 'Ce jeton n’a pas l’air valide : copie-le en entier, sans rien ajouter.';
}

/* ---------- module ---------- */

async function loadEditFile() {
  let response;
  try {
    response = await fetch(`edit.json?t=${Date.now()}`, { cache: 'no-store' });
  } catch {
    throw new EditError(MSG.unreadable);
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new EditError(MSG.unreadable);
  const json = await response.json().catch(() => null);
  return typeof json?.iv === 'string' && typeof json?.ct === 'string' ? json : null;
}

/** Takes the key out of the URL fragment (it must not stay in the address bar or the history). */
function consumeFragmentKey() {
  try {
    const { present, key, rest } = parseFragmentKey(location.hash);
    if (!present) return { present: false, key: null };
    history.replaceState(null, '', `${location.pathname}${location.search}${rest ? `#${rest}` : ''}`);
    return { present, key };
  } catch {
    return { present: false, key: null };
  }
}

export function initEdit(ctx) {
  let editFile; // undefined: not read yet, null: the site has no edit.json
  let key = null;
  let nextKey = null; // renewal key whose edit.json may not be live yet
  let token = null;
  let workflowState = null;
  let pending = loadPending();
  let timer = null;
  let ticking = false;
  let unlocking = null;
  let routing = false;
  let activationTimer = null;
  let releaseData;
  const dataReady = new Promise((resolve) => { releaseData = resolve; });

  const isUnlocked = () => token !== null;
  const repoOf = () => ctx.getData()?.repo ?? null;

  function client(withToken = token) {
    const repo = repoOf();
    return withToken && repo ? createGitHub({ ...repo, token: withToken }) : null;
  }

  /* ----- pending operations ----- */

  const hasPlayer = (id) => Boolean(ctx.getData()?.players?.some((player) => player.id === id));

  function persist() {
    writeStore('sessionStorage', PENDING_STORAGE, pending.length ? JSON.stringify(pending) : null);
    if (pending.length && !timer) timer = setInterval(tick, POLL_MS);
    else if (!pending.length && timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function drop(op) {
    pending = pending.filter((item) => item !== op);
  }

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      await ctx.reload();
      await checkRuns();
      expire();
    } finally {
      ticking = false;
    }
  }

  async function checkRuns() {
    const github = client();
    if (!github) return;
    for (const op of [...pending]) {
      if (!op.runId) continue;
      const run = await github.getRun(op.runId).catch(() => null);
      if (!run || !pending.includes(op)) continue;
      if (run.status === 'completed' && run.conclusion === 'success' && !op.runSucceeded) {
        // Resolved by the next reload, which proves the data is the one that run produced.
        op.runSucceeded = true;
        persist();
        continue;
      }
      if (!isFailedRun(run)) continue;
      drop(op);
      const href = safeRunUrl(op.htmlUrl ?? run.html_url);
      toast('L’opération a échoué côté GitHub.', { kind: 'error', action: href ? { label: 'Voir l’exécution', href } : undefined });
      persist();
      ctx.onChange();
    }
  }

  function expire() {
    const expired = pending.filter((op) => Date.now() - op.at > OPERATION_TTL_MS);
    if (!expired.length) return;
    for (const op of expired) drop(op);
    if (expired.some((op) => !op.silent)) {
      toast('Toujours rien après 10 minutes : regarde l’onglet Actions du dépôt.', { kind: 'info', timeout: 10000 });
    }
    persist();
    ctx.onChange();
  }

  function settle(data) {
    let changed = false;
    for (const op of [...pending]) {
      const label = `${op.name} ${op.surname}`;
      let message = null;
      if (op.kind === 'add' && hasPlayer(op.id)) message = `${label} est sur la ligne de départ.`;
      else if (op.kind === 'remove' && !hasPlayer(op.id)) message = `${label} a été retiré.`;
      else if (op.kind === 'sync' && isSyncResolved(op, data.generatedAt)) message = 'Données à jour.';
      else continue;
      drop(op);
      changed = true;
      if (!op.silent) toast(message, { kind: 'success' });
    }
    if (changed) {
      persist();
      ctx.onChange();
    }
  }

  async function record(kind, inputs, details = {}) {
    const github = client();
    if (!github) throw new EditError(MSG.locked);
    const at = Date.now();
    const { runId, htmlUrl } = await github.dispatch(inputs);
    pending.push({ kind, id: null, region: null, name: '', surname: '', label: null, ...details, at, runId, htmlUrl });
    persist();
    ctx.onChange();
  }

  async function autoSync(data) {
    const age = Date.now() - Date.parse(data.generatedAt);
    const lastAttempt = Number(readStore('sessionStorage', AUTO_SYNC_STORAGE)) || 0;
    if (!isUnlocked() || pending.length || !(age > STALE_DATA_MS) || Date.now() - lastAttempt < AUTO_SYNC_COOLDOWN_MS) return;
    writeStore('sessionStorage', AUTO_SYNC_STORAGE, String(Date.now()));
    try {
      const runs = await client().listRuns({ perPage: 5 });
      if (runs.some((run) => BUSY_RUN_STATUSES.has(run.status))) return;
      await record('sync', { op: 'sync' }, { silent: true });
    } catch {
      // Best effort: the scheduled run will come, and the next attempt is allowed in 10 minutes.
    }
  }

  /* ----- unlocking ----- */

  function storeKeys(next) {
    key = next.stored;
    nextKey = next.next;
    writeStore('localStorage', KEY_STORAGE, next.stored);
    writeStore('localStorage', NEXT_KEY_STORAGE, next.next);
  }

  /** `candidates` are tried in order against the live edit.json; storage only changes on what that proves. */
  async function runUnlock(candidates, quiet) {
    editFile = await loadEditFile();
    if (!editFile) throw new EditError(MSG.notActive);
    let secret = null;
    let ok = null;
    const failed = [];
    for (const candidate of candidates) {
      try {
        secret = await decryptToken(candidate, editFile);
        ok = candidate;
        break;
      } catch {
        failed.push(candidate);
      }
    }
    const before = { stored: readStore('localStorage', KEY_STORAGE), next: readStore('localStorage', NEXT_KEY_STORAGE) };
    storeKeys(settleKeys({ ...before, ok, failed }));
    if (!ok) throw new EditError(failed.length && failed.every((candidate) => candidate === before.next) ? MSG.notLiveYet : MSG.wrongKey);
    if (!repoOf()) {
      if (!quiet) throw new EditError(MSG.noData);
      await dataReady;
    }
    let workflow;
    try {
      workflow = await client(secret).getWorkflow();
    } catch (error) {
      throw error instanceof GitHubError && error.status === 401 ? new EditError(MSG.expired) : error;
    }
    token = secret;
    workflowState = workflow.state;
    ctx.onChange();
    return failed;
  }

  function unlock(candidates, { quiet = false } = {}) {
    unlocking ??= runUnlock(candidates, quiet).finally(() => {
      unlocking = null;
    });
    return unlocking;
  }

  async function unlockQuietly(candidates, urlKey) {
    try {
      const failed = await unlock(candidates, { quiet: true });
      // Another stored key got us in, but the link itself was not the right one.
      if (urlKey && failed.includes(urlKey)) toast(MSG.wrongKey, { kind: 'error', timeout: 8000 });
      else if (urlKey) toast('Modification déverrouillée.', { kind: 'success' });
    } catch (error) {
      // A visitor who only has a remembered key did not ask for anything: stay locked without a word.
      // Someone who just opened an edit link expects access, so tell them why it failed.
      if (urlKey) toast(messageOf(error), { kind: 'error', timeout: 8000 });
    }
  }

  function lock() {
    token = null;
    workflowState = null;
    storeKeys({ stored: null, next: null });
    ctx.onChange();
  }

  /**
   * The "Modifier la liste" entry point: add when unlocked, ask for the link when the site has one,
   * and lead to the set-up when it has none (there is no link to paste yet). edit.json is read again
   * at the click, so a set-up finished elsewhere a minute ago counts, and a start-up that could not
   * read it never sends a friend to the owner's set-up.
   */
  async function openEdit() {
    if (isUnlocked()) return openAdd();
    if (routing) return undefined;
    routing = true;
    const wasConfigured = Boolean(editFile);
    try {
      editFile = await loadEditFile();
    } catch (error) {
      toast(messageOf(error), { kind: 'error' });
      return undefined;
    } finally {
      routing = false;
    }
    if (Boolean(editFile) !== wasConfigured) ctx.onChange();
    if (editFile) openUnlock();
    else openSetup();
    return undefined;
  }

  function openUnlock() {
    if (isUnlocked()) return;
    const input = h('input', {
      class: 'input', type: 'text', autocomplete: 'off', spellcheck: 'false', autofocus: true, placeholder: 'https://…#k=…',
    });
    const linkField = field({
      label: 'Lien ou clé de modification',
      control: input,
      hint: 'Colle le lien complet que le propriétaire t’a envoyé, ou seulement la clé.',
    });
    const renew = h('button', {
      class: 'linklike',
      type: 'button',
      on: {
        click() {
          form.modal.close();
          openSetup();
        },
      },
    }, 'en créer un nouveau');
    const form = formDialog({
      title: 'Modifier la liste',
      body: [
        linkField.el,
        h('p', { class: 'muted' }, 'Pas de lien ? Demande-le à la personne qui gère le site. Si c’est toi, tu peux ', renew, '.'),
      ],
      submitLabel: 'Déverrouiller',
      async onSubmit() {
        linkField.setError(null);
        const candidate = extractKey(input.value);
        if (!candidate) {
          linkField.setError(MSG.noKeyInLink);
          input.focus();
          return;
        }
        try {
          await unlock([candidate]);
        } catch (error) {
          linkField.setError(messageOf(error));
          input.focus();
          return;
        }
        form.modal.close();
        toast('Modification déverrouillée.', { kind: 'success' });
      },
    });
  }

  /* ----- workflow state ----- */

  function workflowNotice(onEnabled) {
    if (workflowState === null || workflowState === 'active') return null;
    const button = h('button', { class: 'btn btn--small', type: 'button' }, 'Réactiver');
    const box = h('div', { class: 'notice notice--warn stack' }, h('p', null, MSG.workflowOff), button);
    button.addEventListener('click', async () => {
      setBusy(button, true, 'Réactiver');
      try {
        await client().enableWorkflow();
        workflowState = 'active';
        box.remove();
        toast('Suivi automatique réactivé.', { kind: 'success' });
        await onEnabled?.();
      } catch (error) {
        toast(messageOf(error), { kind: 'error' });
        setBusy(button, false, 'Réactiver');
      }
    });
    return box;
  }

  /* ----- add / remove / sync ----- */

  function openAdd() {
    if (!isUnlocked()) return openEdit();

    const nameInput = h('input', {
      class: 'input', type: 'text', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'words', autofocus: true, placeholder: 'Joe',
    });
    const surnameInput = h('input', {
      class: 'input', type: 'text', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'words', placeholder: 'Gun',
    });
    const regionSelect = h('select', { class: 'select' }, REGIONS.map((code) => h('option', { value: code }, REGION_LABELS[code])));
    const labelInput = h('input', { class: 'input', type: 'text', autocomplete: 'off', maxlength: LABEL_MAX, placeholder: 'Max' });
    const storedRegion = readStore('localStorage', REGION_STORAGE);
    regionSelect.value = REGIONS.includes(storedRegion) ? storedRegion : 'eu';

    const nameField = field({ label: 'Nom principal', control: nameInput, hint: 'Tu peux aussi coller « Joe Gun » ou le lien de l’armurerie.' });
    const surnameField = field({ label: 'Nom secondaire', control: surnameInput });
    const regionField = field({ label: 'Région', control: regionSelect });
    const labelField = field({ label: 'Pseudo du joueur (facultatif)', control: labelInput });
    const armoryLink = h('a', {
      class: 'btn btn--small btn--ghost', target: '_blank', rel: 'noopener noreferrer', hidden: true,
    }, 'Vérifier sur l’armurerie', icon('external', 14));

    /** Validates the form; messages for empty fields only appear on submit, after the first attempt. */
    function validate(final) {
      const name = nameInput.value.trim();
      const surname = surnameInput.value.trim();
      const nameError = name || final ? validateName(name, 'Le nom principal') : null;
      let surnameError = surname || final ? validateName(surname, 'Le nom secondaire') : null;
      const region = regionSelect.value;
      const valid = name && surname && !nameError && !surnameError;
      if (valid) {
        const id = playerId(region, name, surname);
        if (hasPlayer(id) || pendingAdds().some((add) => add.id === id)) surnameError = MSG.duplicate;
      }
      nameField.setError(nameError);
      surnameField.setError(surnameError);
      const checkable = name && surname && !validateName(name) && !validateName(surname);
      armoryLink.hidden = !checkable;
      if (checkable) armoryLink.href = armorySearchUrl(region, normalizeName(name), normalizeName(surname));
      return nameError || surnameError ? null : { region, name, surname, label: cleanLabel(labelInput.value) };
    }

    function fillFrom(text) {
      const parsed = parseCharacterInput(text);
      if (!parsed) return false;
      nameInput.value = parsed.name;
      surnameInput.value = parsed.surname;
      if (parsed.region) regionSelect.value = parsed.region;
      validate(false);
      labelInput.focus();
      return true;
    }

    // Typing "Joe Gun" key by key must not split the field, so only paste and blur are interpreted.
    nameInput.addEventListener('paste', (event) => {
      if (fillFrom(event.clipboardData?.getData('text') ?? '')) event.preventDefault();
    });
    nameInput.addEventListener('change', () => fillFrom(nameInput.value));
    for (const input of [nameInput, surnameInput]) input.addEventListener('input', () => validate(false));
    regionSelect.addEventListener('change', () => {
      writeStore('localStorage', REGION_STORAGE, regionSelect.value);
      validate(false);
    });

    const notice = workflowNotice();
    const form = formDialog({
      title: 'Ajouter un personnage',
      body: [
        notice,
        h('div', { class: 'row edit__pair' }, nameField.el, surnameField.el),
        h('div', { class: 'row edit__pair' }, regionField.el, labelField.el),
        h('div', null, armoryLink),
      ],
      submitLabel: 'Ajouter',
      async onSubmit() {
        const entry = validate(true);
        if (!entry) {
          (nameField.control.hasAttribute('aria-invalid') ? nameInput : surnameInput).focus();
          return;
        }
        const name = normalizeName(entry.name);
        const surname = normalizeName(entry.surname);
        await record('add', {
          op: 'add', region: entry.region, name, surname, label: entry.label ?? '',
        }, { id: playerId(entry.region, name, surname), region: entry.region, name, surname, label: entry.label });
        form.modal.close();
        toast('Ajout demandé.', { kind: 'success' });
      },
    });
  }

  async function requestRemove(player) {
    if (!isUnlocked()) return openEdit();
    if (pendingRemovals().has(player.id)) return undefined;
    const agreed = await confirm({
      title: 'Retirer du suivi',
      message: `Retirer ${fullName(player)} du suivi ? Son historique sera effacé.`,
      confirmLabel: 'Retirer',
      danger: true,
    });
    if (!agreed) return undefined;
    try {
      await record('remove', {
        op: 'remove', region: player.region, name: player.name, surname: player.surname,
      }, { id: player.id, region: player.region, name: player.name, surname: player.surname });
      toast('Retrait demandé.', { kind: 'success' });
    } catch (error) {
      toast(messageOf(error), { kind: 'error' });
    }
    return undefined;
  }

  async function dispatchSync() {
    try {
      await record('sync', { op: 'sync' });
      toast('Synchronisation demandée.', { kind: 'success' });
    } catch (error) {
      toast(messageOf(error), { kind: 'error' });
    }
  }

  async function requestSync() {
    if (!isUnlocked()) return openEdit();
    let modal = null;
    const notice = workflowNotice(async () => {
      modal.close();
      await dispatchSync();
    });
    if (notice) {
      modal = infoDialog('Synchroniser maintenant', notice);
      return undefined;
    }
    await dispatchSync();
    return undefined;
  }

  /* ----- owner set-up ----- */

  function runLink(url) {
    const href = safeRunUrl(url);
    return href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, 'Voir l’exécution') : null;
  }

  /** Polls edit.json until the new ciphertext is live; a run that failed ends the wait early. */
  function waitForActivation({ ct, status, github, run }) {
    const started = Date.now();
    const poll = async () => {
      try {
        const file = await loadEditFile();
        if (file?.ct === ct) {
          editFile = file;
          // The new key now decrypts the live file: it becomes the stored key.
          storeKeys({ stored: nextKey ?? key, next: null });
          status.replaceChildren(h('p', { class: 'notice notice--success' }, 'C’est activé.'));
          ctx.onChange();
          return;
        }
      } catch {
        // Keep trying: the site may be redeploying.
      }
      if (run.runId) {
        const state = await github.getRun(run.runId).catch(() => null);
        if (isFailedRun(state)) {
          status.replaceChildren(h('p', { class: 'notice notice--error' }, 'L’activation a échoué côté GitHub. ', runLink(run.htmlUrl ?? state.html_url)));
          return;
        }
      }
      if (Date.now() - started > ACTIVATION_TTL_MS) {
        status.replaceChildren(h('p', { class: 'notice notice--warn' }, 'Toujours pas actif : regarde l’onglet Actions du dépôt.'));
        return;
      }
      activationTimer = setTimeout(poll, POLL_MS);
    };
    activationTimer = setTimeout(poll, POLL_MS);
  }

  function showShareLink({ form, link, ct, github, run }) {
    const status = h('div', { role: 'status' }, h('p', { class: 'row' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Activation en cours…'));
    const linkInput = h('input', { class: 'input edit__link', type: 'text', readonly: true, value: link, 'aria-label': 'Lien de modification' });
    linkInput.addEventListener('focus', () => linkInput.select());
    form.form.replaceChildren(
      h('div', { class: 'stack' },
        h('p', null, 'Envoie ce lien à tes amis dès que « C’est activé. » s’affiche en bas de cette fenêtre (une ou deux minutes) : il leur suffira de l’ouvrir pour modifier la liste.'),
        h('div', { class: 'row edit__share' }, linkInput,
          h('button', {
            class: 'btn',
            type: 'button',
            on: { async click() { toast((await copyText(link)) ? 'Lien copié.' : 'Copie impossible : sélectionne le lien à la main.', { kind: 'info' }); } },
          }, icon('copy', 16), 'Copier le lien')),
        h('p', null, 'Sur cet appareil, c’est déjà déverrouillé : une fois cette fenêtre fermée, utilise « Ajouter un personnage » en haut de la page, ou « Retirer » sur la ligne d’un personnage.'),
        h('p', { class: 'muted' }, 'Toute personne qui a ce lien peut ajouter ou retirer des personnages et lancer une synchronisation. Pour le couper, supprime le jeton sur GitHub.'),
        status),
    );
    form.submit.hidden = true;
    form.cancel.textContent = 'Fermer';
    form.finish();
    waitForActivation({ ct, status, github, run });
  }

  function openSetup() {
    const repo = repoOf();
    if (!repo) {
      infoDialog('Configuration', h('p', null, 'Le site n’a pas encore de données : la première synchronisation doit se terminer avant de pouvoir le configurer. Recharge la page dans une minute.'));
      return;
    }
    const tokenUrl = 'https://github.com/settings/personal-access-tokens/new?name=WoW+Forever+tracker'
      + '&description=Lien+de+modification+du+site+de+suivi'
      + `&target_name=${encodeURIComponent(repo.owner)}&expires_in=90&actions=write`;
    const tokenInput = h('input', {
      class: 'input', type: 'password', autocomplete: 'off', spellcheck: 'false', autofocus: true, placeholder: 'github_pat_…',
    });
    const tokenField = field({ label: 'Jeton', control: tokenInput });
    const keepInput = isUnlocked() && key ? h('input', { type: 'checkbox', checked: true }) : null;
    // null is a site that answered "no edit.json"; undefined (not read, or unreadable) claims nothing.
    const firstTime = editFile === null;
    const replaces = Boolean(editFile) && !keepInput;
    // Only the local demo serves the GitHub API from the site's own origin.
    const localDemo = String(repo.apiBase ?? '').startsWith('/');

    const form = formDialog({
      title: firstTime ? 'Activer la modification' : 'Configuration du lien de modification',
      submitLabel: 'Activer',
      onClose: () => clearTimeout(activationTimer),
      body: [
        firstTime
          ? h('p', null, 'La modification n’est pas encore activée sur ce site. Si c’est ton site, active-la ici, une fois : tu obtiendras un lien à envoyer à tes amis, et chacun pourra ajouter ou retirer des personnages depuis cette page. Sinon, demande à la personne qui gère le site de le faire.')
          : null,
        replaces
          ? h('p', { class: 'notice notice--warn' }, 'Un lien de modification existe déjà. En activer un nouveau le remplace : l’ancien cessera de fonctionner, et il faudra envoyer le nouveau à tes amis.')
          : null,
        localDemo
          ? h('p', { class: 'notice notice--info' }, 'Démonstration locale : pas besoin de vrai jeton. Écris n’importe quel mot dans le champ « Jeton », puis clique sur « Activer ».')
          : null,
        h('ol', { class: 'edit__steps stack' },
          h('li', null,
            h('p', null, h('a', { href: tokenUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Créer le jeton sur GitHub')),
            h('p', { class: 'muted' }, `Dans « Repository access », choisis « Only select repositories » puis ${repo.name}. La permission « Actions : Read and write » est déjà cochée.`)),
          h('li', null, tokenField.el),
          h('li', null,
            keepInput ? h('div', { class: 'field' }, h('label', null, keepInput, ' Garder le même lien')) : null,
            h('p', { class: 'muted' }, 'Le jeton est chiffré dans ton navigateur : seule sa version chiffrée est enregistrée sur le dépôt.'))),
      ],
      async onSubmit() {
        const secret = tokenInput.value.trim();
        const problem = tokenProblem(secret);
        if (problem) return showTokenError(problem);
        const github = client(secret);
        try {
          await github.getWorkflow();
        } catch (error) {
          return showTokenError(messageOf(error));
        }
        tokenField.setError(null);
        const useKey = keepInput?.checked ? key : generateKey();
        const { iv, ct } = await encryptToken(useKey, secret);
        const run = await github.dispatch({ op: 'set-edit-key', payload: JSON.stringify({ iv, ct }) });
        token = secret;
        // The old key keeps working until the new edit.json is live, so a reload now loses nothing.
        if (useKey !== key) {
          nextKey = useKey;
          writeStore('localStorage', NEXT_KEY_STORAGE, useKey);
        }
        ctx.onChange();
        showShareLink({ form, link: `${location.origin}${location.pathname}#k=${useKey}`, ct, github, run });
        return undefined;
      },
    });

    function showTokenError(message) {
      tokenField.setError(message);
      tokenInput.focus();
    }
  }

  /* ----- api ----- */

  const pendingAdds = () => pending
    .filter((op) => op.kind === 'add' && !hasPlayer(op.id))
    .map(({ id, region, name, surname, label }) => ({ id, region, name, surname, label }));

  const pendingRemovals = () => new Set(pending.filter((op) => op.kind === 'remove' && hasPlayer(op.id)).map((op) => op.id));

  // Start: consume the key from the URL, learn whether the site has an edit link, unlock silently.
  const fragment = consumeFragmentKey();
  const urlKey = fragment.key;
  const savedKey = extractKey(readStore('localStorage', KEY_STORAGE));
  const savedNext = extractKey(readStore('localStorage', NEXT_KEY_STORAGE));
  // The link's key is kept at once: if GitHub or the network fails right now, a reload must not lose it.
  if (urlKey && urlKey !== savedKey) writeStore('localStorage', KEY_STORAGE, urlKey);
  if (fragment.present && !urlKey) toast(MSG.noKeyInLink, { kind: 'error', timeout: 8000 });
  const candidates = keyCandidates({ nextKey: savedNext, urlKey, storedKey: savedKey });
  loadEditFile()
    .then((file) => { editFile = file; ctx.onChange(); })
    .catch(() => { /* Unreadable for now: it stays unknown and is read again when someone asks to edit. */ })
    .then(() => (candidates.length ? unlockQuietly(candidates, urlKey) : undefined));
  persist();

  return {
    isConfigured: () => Boolean(editFile),
    isUnlocked,
    pendingAdds,
    pendingRemovals,
    openEdit,
    openAdd,
    openSetup,
    requestRemove,
    requestSync,
    lock,
    shareLink: () => (isUnlocked() && (nextKey ?? key) ? `${location.origin}${location.pathname}#k=${nextKey ?? key}` : null),
    handleData(data) {
      if (data.repo) releaseData();
      settle(data);
      expire();
      autoSync(data);
    },
  };
}
