// Entry point: owns the state, loads the data, renders the sections and wires the edit module.
import { focusByKey, focusKey, toast } from './dom.js';
import { initEdit } from './edit.js';
import { showIntro } from './intro.js';
import { mountChart } from './chart.js';
import { chartSeries, rankPlayers } from './model.js';
import { fullName } from './format.js';
import { renderHeader, setupMenuDismiss } from './views/header.js';
import { renderBanner } from './views/banner.js';
import { renderRace, renderWaiting } from './views/race.js';
import { renderFeed } from './views/feed.js';
import { renderFooter } from './views/footer.js';
import { renderEmptyRoster, renderLoadFailure, renderLoading, renderNoData } from './views/empty.js';
import { openSheet as openSheetDialog } from './views/sheet.js';
import { colorOf } from './views/identity.js';
import { refreshTimes } from './views/time.js';

const REFRESH_MS = 60_000;
const TICK_MS = 30_000;
const DEFAULT_GOAL = 60;
// Visibility changes right after a load (page start, tab restore) must not fetch the files again.
const FRESH_MS = 5_000;
const NO_HISTORY = { schema: 1, series: {} };

const state = { data: null, history: null, loadError: null, noDataYet: false };

const slot = (id) => document.getElementById(id);
const slots = {
  header: slot('header'),
  notices: slot('notices'),
  state: slot('state'),
  race: slot('race'),
  waiting: slot('waiting'),
  progress: slot('progress'),
  feed: slot('feed'),
  footer: slot('footer'),
};

let edit = null;
let chart = null;
let sheet = null;
let sheetStamp = null;
let loading = null;
let loadedAt = 0;
let renderedKey = null;
// While the intro plays, a sheet or a set-up asked for by the link waits for it to close.
let introShowing = false;

/* ---------- loading ---------- */

async function fetchJson(path) {
  const response = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

async function loadOnce() {
  try {
    const [data, history] = await Promise.all([
      fetchJson('data/data.json'),
      // The history is a nice-to-have: without it the race still renders.
      fetchJson('data/history.json').catch(() => state.history),
    ]);
    if (data && !Array.isArray(data.players)) throw new Error('data.json: unexpected shape');
    state.loadError = null;
    state.noDataYet = data === null;
    state.data = data;
    state.history = history ?? NO_HISTORY;
  } catch (error) {
    console.warn('Chargement des données impossible', error);
    state.loadError = error.message;
  }
  if (keyOf() !== renderedKey) render();
  if (state.data) edit.handleData(state.data);
  syncFromHash();
}

/** One load at a time; callers that arrive meanwhile share the running one. */
function load() {
  loading ??= loadOnce().finally(() => {
    loading = null;
    loadedAt = Date.now();
  });
  return loading;
}

/** Background refresh: skipped when the data was loaded a moment ago. */
function loadIfStale() {
  return Date.now() - loadedAt < FRESH_MS ? loading : load();
}

async function refresh(button) {
  // A disabled button loses keyboard focus: remember it and give it back afterwards.
  const hadFocus = document.activeElement === button;
  const key = hadFocus ? focusKey() : null;
  button.disabled = true;
  button.classList.add('is-busy');
  await load();
  button.disabled = false;
  button.classList.remove('is-busy');
  if (hadFocus && (!document.activeElement || document.activeElement === document.body)) {
    // A render during the load may have replaced the button: its twin carries the same key.
    if (button.isConnected) button.focus({ preventScroll: true });
    else focusByKey(key);
  }
  if (state.loadError) toast('Actualisation impossible pour l’instant.', { kind: 'error' });
}

/* ---------- rendering ---------- */

const keyOf = () => `${state.data?.generatedAt ?? ''}|${state.noDataYet}|${state.loadError ?? ''}`;

function fill(el, nodes) {
  el.hidden = !nodes?.length;
  el.replaceChildren(...(nodes ?? []));
}

function viewContext() {
  const settings = state.data?.settings ?? {};
  return {
    data: state.data,
    history: state.history,
    loadError: state.loadError,
    goalLevel: Number.isInteger(settings.goalLevel) ? settings.goalLevel : DEFAULT_GOAL,
    xpTable: Array.isArray(state.data?.xpTable) ? state.data.xpTable : null,
    edit,
    removals: edit.pendingRemovals(),
    nowMs: Date.now(),
    openSheet,
    refresh,
  };
}

function renderChart(ctx, ranked) {
  slots.progress.hidden = ranked.length === 0;
  if (!ranked.length) return;
  const props = {
    players: ranked.map((player) => ({ id: player.id, name: fullName(player), color: colorOf(player), level: player.level })),
    series: chartSeries(ranked, ctx.history, ctx.xpTable, ctx.goalLevel),
    goalLevel: ctx.goalLevel,
    now: ctx.nowMs,
  };
  // The chart keeps its own range and visibility choices, so it is updated, never rebuilt.
  if (chart) chart.update(props);
  else chart = mountChart(slot('chart'), props);
}

function renderStatePanel(ctx) {
  if (ctx.data) return null;
  if (state.noDataYet) return [renderNoData(ctx)];
  if (state.loadError) return [renderLoadFailure(ctx)];
  return [renderLoading()];
}

function render() {
  // The edit module can announce a change before app.js has finished starting up.
  if (!edit) return;
  // The slots are rebuilt: remember what had focus so that a refresh never drops it on <body>.
  const focused = focusKey();
  renderedKey = keyOf();
  const ctx = viewContext();
  const players = ctx.data?.players ?? [];
  const { ranked, waiting } = rankPlayers(players, ctx.goalLevel);
  const pendingAdds = edit.pendingAdds();
  const rosterEmpty = ctx.data !== null && players.length === 0 && pendingAdds.length === 0;
  const showRace = players.length > 0 || pendingAdds.length > 0;

  document.title = `${ctx.data?.settings?.title || 'Course au niveau 60'} · WoW Forever`;
  fill(slots.header, renderHeader(ctx));
  fill(slots.notices, renderBanner(ctx));
  fill(slots.state, renderStatePanel(ctx) ?? (rosterEmpty ? [renderEmptyRoster(ctx)] : null));
  fill(slots.race, showRace ? renderRace(ctx, ranked) : null);
  fill(slots.waiting, renderWaiting(ctx, waiting));
  fill(slots.feed, players.length ? renderFeed(ctx, players) : null);
  fill(slots.footer, renderFooter(ctx));
  renderChart(ctx, ranked);
  updateSheet(ctx);
  if (focused && (document.activeElement === document.body || !document.activeElement?.isConnected)) focusByKey(focused);
  tick();
}

/* ---------- character sheet and URL fragment ---------- */

function setHash(hash) {
  history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
}

function openSheet(player) {
  if (sheet?.playerId === player.id) return;
  sheet?.close();
  const handle = openSheetDialog(player, viewContext(), () => {
    // A sheet replaced by another one closes later than the new one opens: leave the new one alone.
    if (sheet !== handle) return;
    sheet = null;
    setHash('');
  });
  sheet = handle;
  sheetStamp = state.data?.generatedAt;
  setHash(`#p=${encodeURIComponent(player.id)}`);
}

function updateSheet(ctx) {
  if (!sheet) return;
  const player = ctx.data?.players.find((p) => p.id === sheet.playerId);
  if (!player) sheet.close();
  else if (sheetStamp !== ctx.data.generatedAt) {
    sheet.update(player, ctx);
    sheetStamp = ctx.data.generatedAt;
  }
}

/** Opens what the fragment asks for; only an actual fragment change may also close the open sheet. */
function syncFromHash({ closing = false } = {}) {
  const params = new URLSearchParams(location.hash.slice(1));
  const id = params.get('p');
  if (!state.data || introShowing) return;
  if (id) {
    const player = state.data.players.find((p) => p.id === id);
    if (player) openSheet(player);
  } else if (params.has('setup')) {
    setHash('');
    edit.openSetup();
  } else if (closing && sheet) {
    sheet.close();
  }
}

/* ---------- start ---------- */

function tick() {
  refreshTimes(document, Date.now());
}

function start() {
  // Created before the first render: it also consumes the #k= fragment.
  edit = initEdit({ getData: () => state.data, reload: load, onChange: render });
  setupMenuDismiss();
  render();
  load();
  introShowing = true;
  showIntro().then(() => {
    introShowing = false;
    syncFromHash();
  });

  setInterval(() => {
    if (document.visibilityState === 'visible') loadIfStale();
  }, REFRESH_MS);
  setInterval(tick, TICK_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    tick();
    loadIfStale();
  });
  window.addEventListener('hashchange', () => syncFromHash({ closing: true }));
}

start();
