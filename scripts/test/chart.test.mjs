import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  linearScale, yDomain, yTicks, timeDomain, timeTicks, cleanPoints, clipSeries, linePath,
  nearestIndex, adjacentTime, dashFlags, spreadLabels, formatLevel, formatWhen, mountChart,
} from '../../site/assets/chart.js';

const HOUR = 3600;
const DAY = 86400;
const NOW = Date.UTC(2026, 10, 12, 18, 0, 0) / 1000;

describe('scales', () => {
  test('linearScale maps and inverts', () => {
    const f = linearScale(10, 20, 0, 100);
    assert.equal(f(10), 0);
    assert.equal(f(15), 50);
    assert.equal(f.invert(75), 17.5);
  });

  test('a degenerate domain maps to the middle of the range', () => {
    const f = linearScale(5, 5, 0, 100);
    assert.equal(f(5), 50);
    assert.equal(f.invert(10), 5);
  });

  test('inverted ranges work (y axis grows upwards)', () => {
    const f = linearScale(1, 11, 200, 0);
    assert.equal(f(1), 200);
    assert.equal(f(11), 0);
  });
});

describe('yDomain', () => {
  test('minimum is a multiple of 5 below the lowest value, maximum the goal', () => {
    assert.deepEqual(yDomain([26.3, 40], 60), { min: 25, max: 60 });
    assert.deepEqual(yDomain([25, 40], 60), { min: 20, max: 60 });
  });

  test('never below level 1', () => {
    assert.deepEqual(yDomain([3, 12], 60), { min: 1, max: 60 });
  });

  test('keeps at least 10 levels of height near the goal', () => {
    assert.deepEqual(yDomain([58, 59.5], 60), { min: 50, max: 60 });
  });

  test('no data gives the full axis', () => {
    assert.deepEqual(yDomain([], 60), { min: 1, max: 60 });
  });

  test('a value above the goal raises the maximum', () => {
    assert.equal(yDomain([20, 62.4], 60).max, 63);
  });

  test('small goals still give a valid axis', () => {
    const { min, max } = yDomain([], 5);
    assert.ok(max > min);
  });
});

describe('yTicks', () => {
  test('round values inside the domain, at most about six', () => {
    assert.deepEqual(yTicks(25, 60), [30, 40, 50, 60]);
    assert.deepEqual(yTicks(40, 60), [40, 45, 50, 55, 60]);
    assert.ok(yTicks(1, 60).length <= 8);
    assert.deepEqual(yTicks(1, 6), [1, 2, 3, 4, 5, 6]);
  });
});

describe('timeDomain', () => {
  const series = [[[NOW - 3 * DAY, 10], [NOW - HOUR, 20]]];

  test('Tout starts at the first observation, ends at now', () => {
    assert.deepEqual(timeDomain('all', NOW, series), { t0: NOW - 3 * DAY, t1: NOW });
  });

  test('fixed ranges count back from the right edge', () => {
    assert.deepEqual(timeDomain('24h', NOW, series), { t0: NOW - DAY, t1: NOW });
    assert.deepEqual(timeDomain('7d', NOW, series), { t0: NOW - 7 * DAY, t1: NOW });
  });

  test('a clock behind the data extends the axis to the last observation', () => {
    assert.equal(timeDomain('all', NOW - DAY, series).t1, NOW - HOUR);
  });

  test('a single fresh point gets a 10-minute span extending to the right', () => {
    assert.deepEqual(timeDomain('all', NOW, [[[NOW, 12]]]), { t0: NOW, t1: NOW + 600 });
    assert.deepEqual(timeDomain('all', NOW, []), { t0: NOW - 600, t1: NOW });
  });

  test('data covering a minute or two starts at the left edge, not squeezed at the right', () => {
    const { t0, t1 } = timeDomain('all', NOW, [[[NOW - 120, 12], [NOW - 30, 13]]]);
    assert.equal(t0, NOW - 120);
    assert.equal(t1 - t0, 600);
    assert.ok(t1 > NOW);
    assert.ok((NOW - 30 - t0) / (t1 - t0) < 1 / 3);
  });

  test('data already wider than the minimum is unchanged', () => {
    assert.deepEqual(timeDomain('all', NOW, [[[NOW - 900, 12], [NOW, 13]]]), { t0: NOW - 900, t1: NOW });
  });

  test('ticks stay sensible on the minimum span', () => {
    const { t0, t1 } = timeDomain('all', NOW, [[[NOW - 120, 12]]]);
    const ticks = timeTicks(t0, t1, 6);
    assert.ok(ticks.length >= 2 && ticks.length <= 6);
  });
});

describe('timeTicks', () => {
  const LABEL = /^(\d{2}:\d{2}|\d{1,2} \S+)$/u;

  test('empty or reversed spans give no ticks', () => {
    assert.deepEqual(timeTicks(100, 100), []);
    assert.deepEqual(timeTicks(200, 100), []);
  });

  test('hour steps are ascending, inside the range, evenly spaced and French-labelled', () => {
    const t0 = NOW - 20 * HOUR;
    const ticks = timeTicks(t0, NOW, 6);
    assert.ok(ticks.length >= 2 && ticks.length <= 6);
    for (const [i, tick] of ticks.entries()) {
      assert.ok(tick.t >= t0 && tick.t <= NOW);
      assert.match(tick.label, LABEL);
      if (i) assert.equal(tick.t - ticks[i - 1].t, ticks[1].t - ticks[0].t);
    }
  });

  test('clock labels land on whole local hours and midnight shows the date', () => {
    const ticks = timeTicks(NOW - 30 * HOUR, NOW, 8);
    for (const tick of ticks) {
      const d = new Date(tick.t * 1000);
      assert.equal(d.getMinutes(), 0);
      if (d.getHours() === 0) assert.doesNotMatch(tick.label, /^\d{2}:\d{2}$/);
      else assert.match(tick.label, /^\d{2}:\d{2}$/);
    }
  });

  test('day steps sit on local midnights with "10 nov." style labels', () => {
    const ticks = timeTicks(NOW - 12 * DAY, NOW, 6);
    assert.ok(ticks.length >= 2);
    for (const tick of ticks) {
      const d = new Date(tick.t * 1000);
      assert.equal(d.getHours() + d.getMinutes() + d.getSeconds(), 0);
      assert.match(tick.label, /^\d{1,2} \S+$/u);
    }
    assert.match(ticks.map((t) => t.label).join(' '), /nov\.|oct\./);
  });
});

describe('series helpers', () => {
  test('cleanPoints drops bad rows and sorts', () => {
    assert.deepEqual(
      cleanPoints([[5, 2], [1, 1, 100], [Number.NaN, 3], [4, null], 'x', [3, 7]]),
      [[1, 1, 100], [3, 7], [5, 2]],
    );
    assert.deepEqual(cleanPoints(undefined), []);
  });

  test('clipSeries keeps observations inside the window and flags them', () => {
    assert.deepEqual(clipSeries([[10, 1], [20, 2], [30, 3]], 0, 100), [[10, 1, true], [20, 2, true], [30, 3, true]]);
  });

  test('clipSeries interpolates the entry point when the window starts mid-segment', () => {
    assert.deepEqual(clipSeries([[0, 10], [100, 20]], 50, 200), [[50, 15, false], [100, 20, true]]);
  });

  test('clipSeries holds the last level flat when nothing happened inside the window', () => {
    assert.deepEqual(clipSeries([[0, 10], [20, 12]], 50, 100), [[50, 12, false]]);
  });

  test('clipSeries adds no synthetic point when an observation sits on the boundary', () => {
    assert.deepEqual(clipSeries([[0, 10], [50, 12]], 50, 100), [[50, 12, true]]);
  });

  test('clipSeries ignores observations after the window and handles empty input', () => {
    assert.deepEqual(clipSeries([[10, 1], [500, 9]], 0, 100), [[10, 1, true]]);
    assert.deepEqual(clipSeries([], 0, 100), []);
  });
});

describe('linePath', () => {
  const x = linearScale(0, 100, 0, 200);
  const y = linearScale(0, 10, 100, 0);

  test('no points, one point, many points', () => {
    assert.equal(linePath([], x, y), '');
    assert.equal(linePath([[50, 5]], x, y), 'M100 50');
    assert.equal(linePath([[0, 0], [50, 5], [100, 10]], x, y), 'M0 100L100 50L200 0');
  });

  test('a long gap between observations is one straight segment', () => {
    assert.equal(linePath([[0, 2], [90, 8]], x, y), 'M0 80L180 20');
  });

  test('coordinates are rounded to one decimal', () => {
    assert.equal(linePath([[1, 1.234]], x, y), 'M2 87.7');
  });

  test('the flat extension to now is a horizontal segment', () => {
    assert.equal(linePath([[40, 5], [100, 5]], x, y), 'M80 50L200 50');
  });
});

describe('nearestIndex / adjacentTime', () => {
  const pts = [[10, 1], [20, 2], [40, 3]];

  test('picks the closest observation, the earlier one on a tie', () => {
    assert.equal(nearestIndex(pts, 0), 0);
    assert.equal(nearestIndex(pts, 14), 0);
    assert.equal(nearestIndex(pts, 15), 0);
    assert.equal(nearestIndex(pts, 16), 1);
    assert.equal(nearestIndex(pts, 31), 2);
    assert.equal(nearestIndex(pts, 999), 2);
    assert.equal(nearestIndex([], 5), -1);
  });

  test('adjacentTime steps along the observation times and stops at the ends', () => {
    const times = [10, 20, 40];
    assert.equal(adjacentTime(times, 20, 1), 40);
    assert.equal(adjacentTime(times, 20, -1), 10);
    assert.equal(adjacentTime(times, 40, 1), 40);
    assert.equal(adjacentTime(times, 10, -1), 10);
    assert.equal(adjacentTime(times, 25, 1), 40);
    assert.equal(adjacentTime([], 1, 1), null);
  });
});

describe('dashFlags / spreadLabels / formatting', () => {
  test('the second use of a colour is dashed, case-insensitively', () => {
    assert.deepEqual(dashFlags(['#aaa', '#bbb', '#AAA', '#aaa']), [false, false, true, true]);
    assert.deepEqual(dashFlags([]), []);
  });

  test('spreadLabels separates collisions and respects the bounds', () => {
    assert.deepEqual(spreadLabels([50, 50, 50], 10, 0, 200), [50, 60, 70]);
    const out = spreadLabels([195, 196, 197], 10, 0, 200);
    assert.ok(Math.max(...out) <= 200 && Math.min(...out) >= 0);
    for (let i = 1; i < out.length; i++) assert.ok(out[i] - out[i - 1] >= 10);
  });

  test('spreadLabels keeps the order of the input', () => {
    const out = spreadLabels([80, 10, 12], 10, 0, 200);
    assert.deepEqual(out, [80, 10, 20]);
  });

  test('formatLevel: one French decimal only when fractional, never rounds up to the next level', () => {
    assert.equal(formatLevel(27), '27');
    assert.equal(formatLevel(27.45), '27,4');
    assert.equal(formatLevel(27.999), '27,9');
    assert.equal(formatLevel(60), '60');
  });

  test('formatWhen reads like "10 nov. à 18:07"', () => {
    assert.match(formatWhen(NOW), /^\d{1,2} \S+ à \d{2}:\d{2}$/u);
  });
});

// ---- mountChart against a minimal DOM -------------------------------------

class FakeNode {
  static width = 0;

  constructor(tag) {
    this.tag = tag;
    this.attrs = {};
    this.children = [];
    this.listeners = {};
    this.styleProps = {};
    this.style = { setProperty: (k, v) => { this.styleProps[k] = v; } };
    this.hidden = false;
    this.clientWidth = FakeNode.width;
    this.offsetWidth = 120;
    this.text = '';
  }

  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  append(...kids) { for (const k of kids) this.children.push(typeof k === 'object' ? k : { text: String(k) }); }
  replaceChildren(...kids) { this.children = []; this.append(...kids); }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  getBoundingClientRect() { return { left: 0, width: this.clientWidth }; }
  set textContent(v) { this.text = v; }
  get textContent() { return this.text || this.children.map((c) => c.textContent ?? c.text ?? '').join(''); }
  fire(type, event = {}) { for (const fn of this.listeners[type] ?? []) fn({ preventDefault() {}, ...event }); }
}

const walk = (node, out = []) => {
  out.push(node);
  for (const c of node.children ?? []) if (c instanceof FakeNode) walk(c, out);
  return out;
};
const byClass = (root, cls) => walk(root).filter((n) => (n.attrs?.class ?? '').split(' ').includes(cls));

describe('mountChart', () => {
  let observers;
  before(() => {
    observers = [];
    globalThis.document = {
      createElement: (tag) => new FakeNode(tag),
      createElementNS: (_ns, tag) => new FakeNode(tag),
    };
    globalThis.ResizeObserver = class {
      constructor(cb) { this.cb = cb; observers.push(this); }
      observe() {}
      disconnect() { this.gone = true; }
    };
  });
  after(() => {
    delete globalThis.document;
    delete globalThis.ResizeObserver;
  });

  const palette = ['#e6b450', '#59c2ff', '#aad94c', '#f07178', '#d2a6ff', '#ffb454'];
  const makePlayers = (n) => Array.from({ length: n }, (_, i) => ({ id: `eu:p${i}`, name: `Joueur${i}`, color: palette[i % palette.length], level: 20 + i }));
  const makeSeries = (players, points = 6) => Object.fromEntries(players.map((p, i) => [
    p.id,
    Array.from({ length: points }, (_, k) => [NOW - (points - k) * 2 * HOUR, 10 + i * 0.5 + k * 3.25]),
  ]));
  const mount = (width, props) => {
    FakeNode.width = width;
    const container = new FakeNode('div');
    const chart = mountChart(container, props);
    const plot = byClass(container, 'chart__plot')[0];
    return { container, chart, plot, svg: byClass(container, 'chart__svg')[0] };
  };
  const props = (players, series, extra = {}) => ({ players, series, goalLevel: 60, now: NOW * 1000, ...extra });

  test('no series at all shows the empty state and hides the plot', () => {
    const players = makePlayers(2);
    const { container, plot } = mount(600, props(players, {}));
    const [empty] = byClass(container, 'chart__empty');
    assert.equal(empty.hidden, false);
    assert.match(empty.textContent, /Pas encore assez de relevés/);
    assert.equal(plot.hidden, true);
  });

  test('no players at all does not throw', () => {
    mount(600, props([], {})).chart.destroy();
  });

  test('one player with one point is still an empty state', () => {
    const players = makePlayers(1);
    const { container } = mount(600, props(players, { [players[0].id]: [[NOW - 100, 12]] }));
    assert.equal(byClass(container, 'chart__empty')[0].hidden, false);
  });

  test('draws lines, dots and the finish line from 320 px to 1400 px', () => {
    const players = makePlayers(12);
    const series = makeSeries(players);
    for (const width of [320, 480, 768, 1400]) {
      const { container, chart, svg } = mount(width, props(players, series));
      chart.update(props(players, series));
      assert.equal(byClass(container, 'chart__empty')[0].hidden, true);
      assert.equal(byClass(svg, 'chart__line').filter((n) => !n.attrs.class.includes('chart__ext')).length, 12);
      assert.equal(byClass(svg, 'chart__finish').length, 1);
      assert.ok(byClass(svg, 'chart__dot').length >= 12);
      assert.match(svg.attrs.viewBox, new RegExp(`^0 0 ${width} \\d+$`));
      // Direct labels only when there is room for them.
      assert.equal(byClass(svg, 'chart__label').length > 0, width >= 520, `labels at ${width}`);
    }
  });

  test('players sharing a colour get a dashed stroke on the second one', () => {
    const players = makePlayers(2).map((p) => ({ ...p, color: '#59c2ff' }));
    const { svg } = mount(800, props(players, makeSeries(players)));
    const lines = byClass(svg, 'chart__line').filter((n) => !n.attrs.class.includes('chart__ext'));
    assert.equal(lines[0].attrs['stroke-dasharray'], undefined);
    assert.ok(lines[1].attrs['stroke-dasharray']);
  });

  test('a player with one point gets a dot and a faint flat extension, no line', () => {
    const [a, b] = makePlayers(2);
    const series = { [a.id]: makeSeries([a])[a.id], [b.id]: [[NOW - HOUR, 18]] };
    const { svg } = mount(800, props([a, b], series));
    assert.equal(byClass(svg, 'chart__line').filter((n) => !n.attrs.class.includes('chart__ext')).length, 1);
    assert.equal(byClass(svg, 'chart__ext').length, 2);
  });

  test('players at the goal level stay on the plot', () => {
    const players = makePlayers(2);
    const series = Object.fromEntries(players.map((p) => [p.id, [[NOW - 5 * HOUR, 58.4], [NOW - 2 * HOUR, 60]]]));
    const { svg } = mount(600, props(players, series));
    assert.equal(byClass(svg, 'chart__line').length > 0, true);
    assert.equal(byClass(svg, 'chart__finish').length, 1);
  });

  test('hiding every player shows a note instead of lines, and showing one again restores it', () => {
    const players = makePlayers(2);
    const { container, svg } = mount(600, props(players, makeSeries(players)));
    const toggles = byClass(container, 'chart__toggle');
    assert.equal(toggles.length, 2);
    toggles.forEach((t) => t.fire('click'));
    assert.equal(byClass(svg, 'chart__line').length, 0);
    assert.match(svg.textContent, /Aucun personnage affiché/);
    assert.equal(toggles[0].attrs['aria-pressed'], 'false');
    toggles[1].fire('click');
    assert.equal(byClass(svg, 'chart__line').length > 0, true);
    assert.equal(toggles[1].attrs['aria-pressed'], 'true');
  });

  test('update() keeps the selected range, the hidden players and the legend buttons', () => {
    const players = makePlayers(3);
    const { container, chart, svg } = mount(700, props(players, makeSeries(players)));
    const [r24, r7, rAll] = byClass(container, 'chart__range-btn');
    assert.equal(rAll.attrs['aria-pressed'], 'true');
    r24.fire('click');
    byClass(container, 'chart__toggle')[1].fire('click');
    const buttonBefore = byClass(container, 'chart__toggle')[0];

    chart.update(props(players, makeSeries(players), { now: (NOW + 60) * 1000 }));
    assert.equal(r24.attrs['aria-pressed'], 'true');
    assert.equal(r7.attrs['aria-pressed'], 'false');
    assert.equal(byClass(container, 'chart__toggle')[0], buttonBefore);
    assert.equal(byClass(container, 'chart__toggle')[1].attrs['aria-pressed'], 'false');
    assert.equal(byClass(svg, 'chart__line').filter((n) => !n.attrs.class.includes('chart__ext')).length, 2);
  });

  test('a changed roster rebuilds the legend', () => {
    const players = makePlayers(2);
    const { container, chart } = mount(700, props(players, makeSeries(players)));
    const more = makePlayers(3);
    chart.update(props(more, makeSeries(more)));
    assert.equal(byClass(container, 'chart__toggle').length, 3);
  });

  test('arrow keys move the read-out along observation times; Escape and blur clear it', () => {
    const players = makePlayers(2);
    const { container, plot, svg } = mount(700, props(players, makeSeries(players, 4)));
    const [readout] = byClass(container, 'chart__readout');
    assert.equal(readout.hidden, true);

    plot.fire('keydown', { key: 'ArrowLeft' });
    assert.equal(readout.hidden, false);
    const rows = byClass(readout, 'chart__row');
    assert.equal(rows.length, 2);
    assert.match(readout.textContent, /Joueur1/);
    assert.match(readout.textContent, /\d{1,2} \S+ à \d{2}:\d{2}/u);
    assert.equal(byClass(svg, 'chart__hit').length, 2);
    const first = readout.styleProps['--x'];

    plot.fire('keydown', { key: 'ArrowLeft' });
    assert.notEqual(readout.styleProps['--x'], first);
    plot.fire('keydown', { key: 'Home' });
    plot.fire('keydown', { key: 'End' });
    assert.equal(readout.styleProps['--x'], first);

    plot.fire('keydown', { key: 'Escape' });
    assert.equal(readout.hidden, true);
    plot.fire('keydown', { key: 'ArrowRight' });
    assert.equal(readout.hidden, false);
    plot.fire('blur');
    assert.equal(readout.hidden, true);
  });

  test('read-out shows one decimal for fractional levels and none for whole ones', () => {
    const [p] = makePlayers(1);
    const series = { [p.id]: [[NOW - 2 * HOUR, 27], [NOW - HOUR, 27.5]] };
    const { container, plot } = mount(600, props([p], series));
    const [readout] = byClass(container, 'chart__readout');
    plot.fire('keydown', { key: 'Home' });
    assert.match(readout.textContent, /27(?!,)/);
    plot.fire('keydown', { key: 'End' });
    assert.match(readout.textContent, /27,5/);
  });

  test('pointer movement reads the nearest observation; a mouse leaving clears it', () => {
    const players = makePlayers(2);
    const { container, plot } = mount(700, props(players, makeSeries(players, 4)));
    const [readout] = byClass(container, 'chart__readout');
    plot.fire('pointermove', { clientX: 300 });
    assert.equal(readout.hidden, false);
    plot.fire('pointerleave', { pointerType: 'touch' });
    assert.equal(readout.hidden, false);
    plot.fire('pointerleave', { pointerType: 'mouse' });
    assert.equal(readout.hidden, true);
  });

  test('a long player list is capped in the read-out', () => {
    const players = makePlayers(14);
    const { container, plot } = mount(700, props(players, makeSeries(players, 3)));
    plot.fire('keydown', { key: 'End' });
    const [readout] = byClass(container, 'chart__readout');
    assert.equal(byClass(readout, 'chart__row').length, 8);
    assert.match(readout.textContent, /\+ 6 autres/);
  });

  test('redraws when the container width changes, and destroy stops observing', () => {
    const players = makePlayers(2);
    const { container, chart, plot, svg } = mount(400, props(players, makeSeries(players)));
    chart.update(props(players, makeSeries(players)));
    assert.match(svg.attrs.viewBox, /^0 0 400 /);
    plot.clientWidth = 900;
    observers.at(-1).cb();
    assert.match(svg.attrs.viewBox, /^0 0 900 /);
    chart.destroy();
    assert.equal(observers.at(-1).gone, true);
    assert.equal(container.children.length, 0);
  });

  test('a container that is not laid out yet draws nothing and does not throw', () => {
    const players = makePlayers(2);
    const { svg } = mount(0, props(players, makeSeries(players)));
    assert.equal(svg.children.length, 0);
  });
});
