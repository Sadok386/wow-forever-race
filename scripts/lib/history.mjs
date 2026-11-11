// Level/XP time series per character: { schema: 1, series: { [id]: [[unixSeconds, level, xp|null], ...] } }.

export function emptyHistory() {
  return { schema: 1, series: {} };
}

function isPoint(p) {
  return Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && (p[2] === null || Number.isFinite(p[2]));
}

/** Never throws: a hand-edited or corrupt file degrades to what can be salvaged, with a warning. */
export function parseHistory(text) {
  if (!String(text ?? '').trim()) return { history: emptyHistory(), warning: null };
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { history: emptyHistory(), warning: 'history.json est illisible : l’historique repart de zéro.' };
  }
  if (json?.schema !== 1 || !json.series || typeof json.series !== 'object' || Array.isArray(json.series)) {
    return { history: emptyHistory(), warning: 'history.json a un format inattendu : l’historique repart de zéro.' };
  }
  const history = emptyHistory();
  let dropped = 0;
  for (const [id, points] of Object.entries(json.series)) {
    if (!Array.isArray(points)) {
      dropped += 1;
      continue;
    }
    const valid = points.filter(isPoint).map(([t, level, xp]) => [t, level, xp ?? null]);
    dropped += points.length - valid.length;
    if (valid.length) history.series[id] = valid.sort((a, b) => a[0] - b[0]);
  }
  const warning = dropped ? `history.json : ${dropped} relevé(s) invalide(s) ignoré(s).` : null;
  return { history, warning };
}

export function lastPoint(history, id) {
  const points = history.series[id];
  return points?.length ? points[points.length - 1] : null;
}

/** Records a point only when (level, xp) moved, so idle characters add nothing. Returns true when appended. */
export function appendPoint(history, id, tSec, level, xp) {
  const point = [tSec, level, xp ?? null];
  const last = lastPoint(history, id);
  if (last && last[1] === point[1] && last[2] === point[2]) return false;
  (history.series[id] ??= []).push(point);
  return true;
}

export function dropSeries(history, id) {
  delete history.series[id];
}

export function pruneToRoster(history, ids) {
  const keep = new Set(ids);
  for (const id of Object.keys(history.series)) {
    if (!keep.has(id)) delete history.series[id];
  }
}

export function serializeHistory(history) {
  return `${JSON.stringify({ schema: 1, series: history.series }, null, 2)}\n`;
}
