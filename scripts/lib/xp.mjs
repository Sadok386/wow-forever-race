// XP needed to go from level L to L+1 is table[L - 1]. This is the Classic curve: that Forever uses it
// is likely but unconfirmed, hence the override in settings and the self-check below.
export const CLASSIC_XP_TO_NEXT = [400, 900, 1400, 2100, 2800, 3600, 4500, 5400, 6500, 7600, 8800, 10100, 11400, 12900, 14400, 16000, 17700, 19400, 21300, 23200, 25200, 27300, 29400, 31700, 34000, 36400, 38900, 41400, 44300, 47400, 50800, 54500, 58600, 62800, 67100, 71600, 76100, 80800, 85700, 90700, 95800, 101000, 106300, 111800, 117500, 123200, 129100, 135100, 141200, 147500, 153900, 160400, 167100, 173900, 180800, 187900, 195000, 202300, 209800];

/** True for every `xpTable` setting value that resolveXpTable understands; callers warn otherwise. */
export function isXpSetting(setting) {
  return (
    setting === undefined ||
    setting === null ||
    typeof setting === 'boolean' ||
    (Array.isArray(setting) && setting.length > 0 && setting.every((n) => Number.isFinite(n) && n > 0))
  );
}

/** undefined/true -> built-in table; false/null -> null (XP bars disabled); valid array -> itself. */
export function resolveXpTable(setting) {
  if (setting === undefined || setting === true) return CLASSIC_XP_TO_NEXT;
  if (setting === false || setting === null) return null;
  return isXpSetting(setting) ? setting : CLASSIC_XP_TO_NEXT;
}

export function xpNeeded(table, level) {
  return table?.[level - 1] ?? null;
}

/** An XP value at or above what the level needs proves the table is wrong for this game. */
export function isXpTableConsistent(table, players) {
  if (!table) return true;
  return players.every((p) => {
    const needed = xpNeeded(table, p.level);
    return needed === null || typeof p.xp !== 'number' || p.xp < needed;
  });
}
