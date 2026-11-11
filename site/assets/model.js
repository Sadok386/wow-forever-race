// Pure race logic: ranking, progress ratios, feed and chart series. No DOM, so it runs in Node tests.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function time(iso) {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** Compares two optional numbers; a missing value always sorts last, whatever the direction. */
function compareOptional(a, b, direction = 1) {
  const aMissing = !isNum(a);
  const bMissing = !isNum(b);
  if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1;
  return (a - b) * direction;
}

const displayName = (p) => `${p.name ?? ''} ${p.surname ?? ''}`;

/** XP needed to leave `level`, or null when the table or the level is unknown. */
export function xpNeeded(level, xpTable) {
  const needed = isNum(level) ? xpTable?.[level - 1] : null;
  return isNum(needed) && needed > 0 ? needed : null;
}

export function rankPlayers(players, goalLevel) {
  const waiting = players.filter((p) => !isNum(p.level));
  const finished = (p) => p.level >= goalLevel;
  const ranked = players
    .filter((p) => isNum(p.level))
    .sort((a, b) => {
      if (finished(a) !== finished(b)) return finished(a) ? -1 : 1;
      if (finished(a)) {
        const byGoal = compareOptional(time(a.goalAt), time(b.goalAt));
        if (byGoal) return byGoal;
      }
      return (
        b.level - a.level ||
        compareOptional(a.xp, b.xp, -1) ||
        compareOptional(time(a.levelAt), time(b.levelAt)) ||
        displayName(a).localeCompare(displayName(b), 'fr')
      );
    });
  return { ranked, waiting };
}

/** Level plus the share of the current level already earned, so that the race track moves between level-ups. */
export function fractionalLevel(level, xp, xpTable, goalLevel) {
  if (!isNum(level)) return null;
  if (level >= goalLevel) return goalLevel;
  const needed = xpNeeded(level, xpTable);
  if (!isNum(xp) || needed === null) return level;
  return level + Math.min(Math.max(xp / needed, 0), 0.999);
}

export function trackRatio(value, goalLevel) {
  if (!isNum(value) || goalLevel <= 1) return 0;
  return Math.min(Math.max((value - 1) / (goalLevel - 1), 0), 1);
}

/** Levels gained since `sinceSec`; points are [unixSeconds, level, xp] ascending. */
export function levelsGained(points, sinceSec) {
  if (!Array.isArray(points) || points.length === 0) return 0;
  let before = points[0][1];
  for (const point of points) {
    if (point[0] > sinceSec) break;
    before = point[1];
  }
  return Math.max(0, points[points.length - 1][1] - before);
}

/** Level-ups between consecutive observations, newest first. `t` is in unix seconds. */
export function buildFeed(players, history, limit = 20) {
  const events = [];
  for (const player of players) {
    const points = history?.series?.[player.id];
    if (!Array.isArray(points)) continue;
    for (let i = 1; i < points.length; i++) {
      if (points[i][1] > points[i - 1][1]) {
        events.push({ id: player.id, t: points[i][0], from: points[i - 1][1], to: points[i][1] });
      }
    }
  }
  return events.sort((a, b) => b.t - a.t).slice(0, limit);
}

export function chartSeries(players, history, xpTable, goalLevel) {
  const out = {};
  for (const player of players) {
    if (!isNum(player.level)) continue;
    const points = history?.series?.[player.id];
    out[player.id] = Array.isArray(points)
      ? points.map(([t, level, xp]) => [t, fractionalLevel(level, xp, xpTable, goalLevel)])
      : [];
  }
  return out;
}

/** Whole percent of the current level earned, or null when unknown. */
export function xpPercent(player, xpTable) {
  const needed = xpNeeded(player.level, xpTable);
  if (needed === null || !isNum(player.xp)) return null;
  return Math.min(100, Math.max(0, Math.floor((player.xp / needed) * 100)));
}
