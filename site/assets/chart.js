// Level-over-time chart. The pure helpers come first so Node can test them;
// nothing touches the DOM until mountChart() runs.

const SVG_NS = 'http://www.w3.org/2000/svg';
const DAY = 86400;

const RANGES = [
  { id: '24h', label: '24 h', seconds: DAY },
  { id: '7d', label: '7 j', seconds: 7 * DAY },
  { id: 'all', label: 'Tout', seconds: null },
];
const TIME_STEPS = [
  300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200,
  DAY, 2 * DAY, 7 * DAY, 14 * DAY, 30 * DAY, 90 * DAY,
];
// A time axis never gets narrower than this, so the first minutes of tracking stay readable.
const MIN_SPAN = 600;
const LABEL_GAP = 13;
const LABEL_CHARS = 14;
const MAX_ROWS = 8;
const FALLBACK_COLOR = '#b8ab8f';

// hourCycle instead of hour12:false: some ICU versions print midnight as "24:00" otherwise.
const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dayFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const levelFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

const round1 = (n) => Math.round(n * 10) / 10;

/** Linear map from the domain [d0, d1] to the range [r0, r1]; `.invert` goes back. */
export function linearScale(d0, d1, r0, r1) {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  const f = (v) => (k === 0 ? (r0 + r1) / 2 : r0 + (v - d0) * k);
  f.invert = (px) => (k === 0 ? d0 : d0 + (px - r0) / k);
  return f;
}

/**
 * Y-axis bounds. The minimum sits on a multiple of 5 strictly below the lowest value
 * (so the lowest line never rides the axis) and the axis is never shorter than 10 levels.
 * The maximum is the goal, unless a value already exceeds it.
 */
export function yDomain(values, goalLevel) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const max = Math.max(goalLevel, Math.ceil(hi));
  let min = Number.isFinite(lo) ? Math.max(1, Math.floor((lo - 1) / 5) * 5) : 1;
  if (max - min < 10) min = Math.max(1, max - 10);
  return { min, max };
}

/** Round-number gridline values inside [min, max], at most about six of them. */
export function yTicks(min, max) {
  const step = [1, 2, 5, 10, 20].find((s) => (max - min) / s <= 6) ?? 20;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) ticks.push(v);
  return ticks;
}

/**
 * Time-axis bounds in seconds. The right edge is "now" (or a later observation if
 * the clock is behind); the left edge follows the selected range. Data covering less
 * than MIN_SPAN keeps its start on the left and the axis grows to the right, past
 * "now", so the lines are not squeezed against the right edge.
 */
export function timeDomain(range, nowSec, seriesList) {
  let first = Infinity;
  let last = nowSec;
  for (const points of seriesList) {
    if (!points.length) continue;
    first = Math.min(first, points[0][0]);
    last = Math.max(last, points[points.length - 1][0]);
  }
  const seconds = RANGES.find((r) => r.id === range)?.seconds;
  if (!Number.isFinite(first)) return { t0: last - MIN_SPAN, t1: last };
  const t0 = seconds ? last - seconds : Math.min(first, last);
  return { t0, t1: Math.max(last, t0 + MIN_SPAN) };
}

const offsetSec = (sec) => -new Date(sec * 1000).getTimezoneOffset() * 60;

/**
 * Tick positions with French labels, in local time: clock times for sub-day steps
 * (local midnight shows the date instead), "10 nov." for day steps and above.
 */
export function timeTicks(t0, t1, maxTicks = 6) {
  if (!(t1 > t0)) return [];
  const step = TIME_STEPS.find((s) => (t1 - t0) / s <= maxTicks) ?? TIME_STEPS[TIME_STEPS.length - 1];
  const ticks = [];
  if (step < DAY) {
    // Align on the local clock, not on UTC, so 6 h steps land on 00:00, 06:00, ...
    const off = offsetSec(t0);
    for (let local = Math.ceil((t0 + off) / step) * step; ; local += step) {
      const t = local - offsetSec(local - off);
      if (t > t1) break;
      if (t < t0) continue;
      const d = new Date(t * 1000);
      const midnight = d.getHours() === 0 && d.getMinutes() === 0;
      ticks.push({ t, label: (midnight ? dayFmt : timeFmt).format(d) });
    }
    return ticks;
  }
  const days = step / DAY;
  const start = new Date(t0 * 1000);
  start.setHours(0, 0, 0, 0);
  // Calendar arithmetic rather than += 86400 so daylight-saving changes cannot shift a tick off midnight.
  for (let d = start; d.getTime() / 1000 <= t1; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + days)) {
    const t = d.getTime() / 1000;
    if (t >= t0) ticks.push({ t, label: dayFmt.format(d) });
  }
  return ticks;
}

/** Drop bad rows and sort by time; the data is trusted to be shaped [t, level, ...]. */
export function cleanPoints(points) {
  if (!Array.isArray(points)) return [];
  return points
    .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .sort((a, b) => a[0] - b[0]);
}

/**
 * Restrict a series to [t0, t1] as [t, value, isObservation] triples. When observations
 * exist before t0, a synthetic point at t0 (interpolated, or flat when nothing follows)
 * keeps the line entering the window at the right height.
 */
export function clipSeries(points, t0, t1) {
  const out = [];
  let before = null;
  for (const p of points) {
    if (p[0] < t0) before = p;
    else if (p[0] <= t1) out.push([p[0], p[1], true]);
  }
  if (before && out[0]?.[0] !== t0) {
    const next = out[0];
    const value = next
      ? before[1] + ((next[1] - before[1]) * (t0 - before[0])) / (next[0] - before[0])
      : before[1];
    out.unshift([t0, value, false]);
  }
  return out;
}

/** SVG path through the points with straight segments; a single point gives a bare "M". */
export function linePath(points, x, y) {
  return points.map((p, i) => `${i ? 'L' : 'M'}${round1(x(p[0]))} ${round1(y(p[1]))}`).join('');
}

/** Index of the point closest in time to t (earlier one on a tie); -1 for an empty series. */
export function nearestIndex(points, t) {
  if (!points.length) return -1;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid][0] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && t - points[lo - 1][0] <= points[lo][0] - t ? lo - 1 : lo;
}

/** Next (dir > 0) or previous (dir < 0) observation time; stays on the boundary at the ends. */
export function adjacentTime(times, current, dir) {
  if (!times.length) return null;
  if (dir > 0) return times.find((t) => t > current) ?? times[times.length - 1];
  for (let i = times.length - 1; i >= 0; i--) if (times[i] < current) return times[i];
  return times[0];
}

/** One flag per colour: true when an earlier entry already uses it (that one is drawn dashed). */
export function dashFlags(colors) {
  const seen = new Set();
  return colors.map((c) => {
    const key = String(c).toLowerCase();
    const dup = seen.has(key);
    seen.add(key);
    return dup;
  });
}

/**
 * Push label positions apart so neighbours keep `gap` pixels, staying inside [lo, hi].
 * The caller guarantees that n * gap fits in the range.
 */
export function spreadLabels(ys, gap, lo, hi) {
  const order = ys.map((_, i) => i).sort((a, b) => ys[a] - ys[b]);
  const out = ys.slice();
  let prev = lo - gap;
  for (const i of order) {
    out[i] = Math.max(ys[i], prev + gap);
    prev = out[i];
  }
  let next = hi + gap;
  for (const i of order.reverse()) {
    out[i] = Math.min(out[i], next - gap);
    next = out[i];
  }
  return out;
}

/** "27" or "27,4": one decimal only when fractional, truncated so 27.99 never reads as 28. */
export function formatLevel(value) {
  return levelFmt.format(Math.floor(value * 10 + 1e-6) / 10);
}

export function formatWhen(sec) {
  const d = new Date(sec * 1000);
  return `${dayFmt.format(d)} à ${timeFmt.format(d)}`;
}

const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const safeColor = (c) => (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : FALLBACK_COLOR);
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

function el(tag, className, attrs = {}, ...children) {
  const node = document.createElement(tag);
  if (className) node.setAttribute('class', className);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

function svgEl(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

/**
 * props = { players: [{ id, name, color, level }], series: { [id]: [[tSec, value], ...] }, goalLevel, now (ms) }
 * Range and hidden players are kept in the closure, so update() can run every minute
 * without resetting what the viewer chose.
 */
export function mountChart(container, initialProps) {
  let props = initialProps;
  let range = 'all';
  let cursor = null; // pointed time in seconds, or null
  let view = null; // geometry of the last draw, reused by the pointer handlers
  let legendKey = null;
  let lastWidth = 0;
  const hidden = new Set();
  const legendItems = new Map();

  const rangeButtons = RANGES.map((r) => {
    const button = el('button', 'btn btn--small btn--ghost chart__range-btn', { type: 'button' }, r.label);
    button.addEventListener('click', () => {
      range = r.id;
      draw();
    });
    return [r.id, button];
  });
  const rangeGroup = el('div', 'chart__range', { role: 'group', 'aria-label': 'Période' }, ...rangeButtons.map(([, b]) => b));
  const legend = el('ul', 'chart__legend', { 'aria-label': 'Personnages' });
  const bar = el('div', 'chart__bar', {}, legend, rangeGroup);
  const svg = svgEl('svg', { class: 'chart__svg', 'aria-hidden': 'true' });
  const readout = el('div', 'chart__readout');
  readout.hidden = true;
  const plot = el('div', 'chart__plot', {
    tabindex: '0',
    role: 'group',
    'aria-label': 'Niveau de chaque personnage au fil du temps. Flèches gauche et droite pour parcourir les relevés.',
  }, svg, readout);
  const live = el('p', 'sr-only', { 'aria-live': 'polite' });
  const empty = el('p', 'chart__empty muted', {}, 'Pas encore assez de relevés pour tracer une courbe.');
  empty.hidden = true;
  container.replaceChildren(el('div', 'chart', {}, bar, plot, empty, live));

  function syncLegend(players, dashed) {
    const key = players.map((p) => [p.id, p.name, p.color].join('\u0000')).join('\u0001');
    // Rebuilt only when the roster changes: replacing the buttons every minute would drop keyboard focus.
    if (key !== legendKey) {
      legendKey = key;
      legendItems.clear();
      legend.replaceChildren(...players.map((p) => {
        const swatch = el('span', 'chart__swatch');
        swatch.style.setProperty('--c', safeColor(p.color));
        const button = el('button', 'btn btn--small chart__toggle', { type: 'button' }, swatch, p.name);
        button.addEventListener('click', () => {
          if (!hidden.delete(p.id)) hidden.add(p.id);
          draw();
        });
        legendItems.set(p.id, { button, swatch });
        return el('li', '', {}, button);
      }));
    }
    for (const [id, { button, swatch }] of legendItems) {
      button.setAttribute('aria-pressed', String(!hidden.has(id)));
      swatch.setAttribute('class', dashed.has(id) ? 'chart__swatch is-dashed' : 'chart__swatch');
    }
  }

  function draw() {
    for (const [id, button] of rangeButtons) button.setAttribute('aria-pressed', String(id === range));
    const players = props.players ?? [];
    const goal = props.goalLevel;
    const series = new Map(players.map((p) => [p.id, cleanPoints(props.series?.[p.id])]));
    const hasCurve = [...series.values()].some((s) => s.length >= 2);
    empty.hidden = hasCurve;
    bar.hidden = !hasCurve;
    plot.hidden = !hasCurve;
    view = null;
    if (!hasCurve) {
      cursor = null;
      readout.hidden = true;
      return;
    }
    const W = Math.round(plot.clientWidth);
    if (W < 1) return; // not laid out yet; the ResizeObserver calls draw() again
    lastWidth = W;

    const nowSec = props.now / 1000;
    const { t0, t1 } = timeDomain(range, nowSec, [...series.values()]);
    const shown = players.filter((p) => !hidden.has(p.id) && series.get(p.id).length);
    const dashes = dashFlags(shown.map((p) => p.color));
    const lines = shown.map((p, i) => ({
      player: p,
      color: safeColor(p.color),
      dash: dashes[i],
      points: series.get(p.id),
      clipped: clipSeries(series.get(p.id), t0, t1),
    }));
    syncLegend(players, new Set(shown.filter((_, i) => dashes[i]).map((p) => p.id)));

    // With every player hidden keep the axis of the whole data set instead of collapsing it.
    const domainSource = lines.length
      ? lines.map((l) => l.clipped)
      : players.map((p) => clipSeries(series.get(p.id), t0, t1));
    const { min, max } = yDomain(domainSource.flatMap((c) => c.map((p) => p[1])), goal);

    const H = W < 480 ? 260 : 340;
    const box = { l: 34, t: 18, b: 26, r: 18 };
    // Direct labels need room on the right and enough height to stack; otherwise the legend carries identity.
    const showLabels = W >= 520 && lines.length > 0 && lines.length * LABEL_GAP <= H - box.t - box.b;
    if (showLabels) {
      const longest = Math.min(LABEL_CHARS, Math.max(...lines.map((l) => l.player.name.length)));
      box.r = 22 + Math.ceil(longest * 7.5);
    }
    const right = W - box.r;
    const x = linearScale(t0, t1, box.l, right);
    const yScale = linearScale(min, max, H - box.b, box.t);
    const y = (v) => yScale(clamp(v, min, max));
    const yGoal = y(goal);

    const grid = svgEl('g');
    for (const v of yTicks(min, max)) {
      const py = y(v);
      if (Math.abs(py - yGoal) < 11) continue; // the finish line owns this spot
      grid.append(
        svgEl('line', { class: 'chart__grid', x1: box.l, x2: right, y1: py, y2: py }),
        svgEl('text', { class: 'chart__tick', x: box.l - 6, y: py + 4, 'text-anchor': 'end' }, String(v)),
      );
    }
    grid.append(svgEl('line', { class: 'chart__axis', x1: box.l, x2: right, y1: H - box.b, y2: H - box.b }));
    const tickCount = clamp(Math.floor((right - box.l) / 72), 2, 8);
    for (const tick of timeTicks(t0, t1, tickCount)) {
      const px = round1(x(tick.t));
      grid.append(
        svgEl('line', { class: 'chart__axis', x1: px, x2: px, y1: H - box.b, y2: H - box.b + 4 }),
        svgEl('text', { class: 'chart__tick', x: px, y: H - 8, 'text-anchor': 'middle' }, tick.label),
      );
    }
    grid.append(
      svgEl('line', { class: 'chart__finish', x1: box.l, x2: right, y1: yGoal, y2: yGoal }),
      svgEl('text', { class: 'chart__finish-label', x: box.l - 6, y: yGoal + 4, 'text-anchor': 'end' }, String(goal)),
      svgEl('text', { class: 'chart__finish-label', x: box.l + 6, y: yGoal - 6 }, 'Objectif'),
    );

    const marks = svgEl('g');
    // Dots on a dense series would merge into a thick line, so they appear only when they have room.
    const dotsFit = (l) => l.clipped.length * 7 <= right - box.l;
    for (const l of lines) {
      const dash = l.dash ? { 'stroke-dasharray': '6 4' } : {};
      const last = l.clipped[l.clipped.length - 1];
      if (l.clipped.length > 1) {
        marks.append(svgEl('path', { class: 'chart__line', stroke: l.color, d: linePath(l.clipped, x, y), ...dash }));
      }
      if (last[0] < nowSec) {
        marks.append(svgEl('path', { class: 'chart__line chart__ext', stroke: l.color, d: linePath([last, [nowSec, last[1]]], x, y), ...dash }));
      }
      for (const p of l.clipped) {
        if (p[2] && (dotsFit(l) || p === last)) {
          marks.append(svgEl('circle', { class: 'chart__dot', cx: round1(x(p[0])), cy: round1(y(p[1])), r: p === last ? 4 : 2.5, fill: l.color }));
        }
      }
    }
    if (showLabels) {
      const ys = spreadLabels(lines.map((l) => y(l.clipped[l.clipped.length - 1][1])), LABEL_GAP, box.t + 4, H - box.b - 4);
      lines.forEach((l, i) => {
        marks.append(
          svgEl('circle', { cx: right + 6, cy: round1(ys[i]), r: 3, fill: l.color }),
          svgEl('text', { class: 'chart__label', x: right + 14, y: round1(ys[i]) + 4 }, truncate(l.player.name, LABEL_CHARS)),
        );
      });
    }
    if (!lines.length) {
      marks.append(svgEl('text', { class: 'chart__note', x: (box.l + right) / 2, y: (box.t + H - box.b) / 2 }, 'Aucun personnage affiché.'));
    }

    const cursorLayer = svgEl('g');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.replaceChildren(grid, marks, cursorLayer);
    const times = [...new Set(lines.flatMap((l) => l.points.map((p) => p[0]).filter((t) => t >= t0 && t <= t1)))].sort((a, b) => a - b);
    view = { W, H, box, right, x, y, t0, t1, lines, times, cursorLayer };
    drawCursor(false);
  }

  function drawCursor(announce) {
    readout.hidden = true;
    if (!view) return;
    view.cursorLayer.replaceChildren();
    if (cursor === null || !view.lines.length) return;
    const t = clamp(cursor, view.t0, view.t1);
    const px = round1(view.x(t));
    const rows = view.lines
      .map((l) => ({ l, p: l.points[nearestIndex(l.points, t)] }))
      .sort((a, b) => b.p[1] - a.p[1]);
    const listed = rows.slice(0, MAX_ROWS);

    view.cursorLayer.append(svgEl('line', { class: 'chart__cursor', x1: px, x2: px, y1: view.box.t, y2: view.H - view.box.b }));
    for (const { l, p } of listed) {
      // An observation older than the window has no place on the plot; the panel still reports it.
      if (p[0] < view.t0 || p[0] > view.t1) continue;
      view.cursorLayer.append(svgEl('circle', { class: 'chart__hit', cx: round1(view.x(p[0])), cy: round1(view.y(p[1])), r: 5, fill: l.color }));
    }

    readout.replaceChildren(
      ...listed.map(({ l, p }) => {
        const swatch = el('span', 'chart__swatch');
        swatch.style.setProperty('--c', l.color);
        const row = el('div', 'chart__row', {}, swatch,
          el('span', 'chart__row-name', {}, l.player.name),
          el('strong', 'chart__row-level', {}, formatLevel(p[1])),
          el('span', 'chart__row-date muted', {}, formatWhen(p[0])));
        // The name is lit in its class colour, like the line it describes.
        row.style.setProperty('--c', l.color);
        return row;
      }),
      ...(rows.length > listed.length ? [el('div', 'chart__row-more muted', {}, `+ ${rows.length - listed.length} autres`)] : []),
    );
    readout.hidden = false;
    // --x first: the panel's width depends on where it is anchored.
    readout.style.setProperty('--x', `${px}px`);
    // Flip to the side of the crosshair that has room for the panel.
    const width = readout.offsetWidth || 0;
    const side = px + 12 + width <= view.W || px - 12 - width < 0 ? 'right' : 'left';
    readout.setAttribute('data-side', side);

    if (announce) {
      live.textContent = `${formatWhen(t)} : ${listed.map(({ l, p }) => `${l.player.name} niveau ${formatLevel(p[1])}`).join(', ')}`;
    }
  }

  function setCursor(t, announce = false) {
    cursor = t;
    drawCursor(announce);
  }

  plot.addEventListener('pointermove', (e) => {
    const rect = svg.getBoundingClientRect();
    if (!view || !rect.width) return;
    const px = (e.clientX - rect.left) * (view.W / rect.width);
    setCursor(view.x.invert(clamp(px, view.box.l, view.right)));
  });
  plot.addEventListener('pointerleave', (e) => {
    // A finger lifting off must not erase what it just read.
    if (e.pointerType === 'mouse') setCursor(null);
  });
  plot.addEventListener('blur', () => setCursor(null));
  plot.addEventListener('keydown', (e) => {
    if (!view || !view.times.length) return;
    const { times } = view;
    let next;
    if (e.key === 'Escape') {
      setCursor(null);
      return;
    }
    if (e.key === 'Home') next = times[0];
    else if (e.key === 'End') next = times[times.length - 1];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      next = cursor === null ? times[times.length - 1] : adjacentTime(times, cursor, e.key === 'ArrowRight' ? 1 : -1);
    } else return;
    e.preventDefault();
    setCursor(next, true);
  });

  const observer = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => {
      if (Math.round(plot.clientWidth) !== lastWidth) draw();
    })
    : null;
  observer?.observe(plot);
  draw();

  return {
    update(next) {
      props = next;
      draw();
    },
    destroy() {
      observer?.disconnect();
      container.replaceChildren();
    },
  };
}
