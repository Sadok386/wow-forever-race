// Pure French formatting helpers.

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const THIN_NBSP = '\u202f';

export function relTime(iso, nowMs = Date.now()) {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, (nowMs - then) / 1000);
  if (seconds < 60) return 'à l’instant';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${Math.floor(hours / 24)} j`;
}

/** "10 nov. à 18:07" in the viewer's time zone. */
export function dateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} à ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Integer with a narrow no-break space between thousands. */
export function num(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, THIN_NBSP);
}

export function ordinal(n) {
  return n === 1 ? '1er' : `${n}e`;
}

export function fullName(player) {
  return `${player.name ?? ''} ${player.surname ?? ''}`.trim();
}
