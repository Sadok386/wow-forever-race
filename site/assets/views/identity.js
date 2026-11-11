// What every view needs to say about a character: its colour, its descriptive line, its player,
// its state note.
import { h } from '../dom.js';
import { fullName } from '../format.js';
import { CLASSES, FACTIONS, RACES, RULESETS, classColor } from '../shared.js';

export const colorOf = (player) => classColor(player.class?.id);

/** Exposes the class colour to the stylesheet as --c on this element. */
export function tint(el, player) {
  el.style.setProperty('--c', colorOf(player));
  return el;
}

/**
 * "Paladin · Humain · Alliance · Normal" as nodes, skipping whatever is unknown. The faction word
 * is wrapped so that the stylesheet can colour it; returns an empty array when nothing is known.
 */
export function identityNodes(player) {
  const faction = FACTIONS[player.faction];
  const parts = [
    player.class?.name ?? CLASSES[player.class?.id]?.name,
    player.race?.name ?? RACES[player.race?.id],
    faction ? h('span', { class: `faction--${String(player.faction).toLowerCase()}` }, faction) : null,
    player.ruleset?.name ?? RULESETS[player.ruleset?.id],
  ].filter(Boolean);
  return parts.flatMap((part, i) => (i ? [' · ', part] : [part]));
}

/**
 * "joué par Max" as nodes. Once editing is unlocked a link adds or changes the first name, and a
 * change still on its way already shows the new one. Null when there is nothing to show.
 */
export function playedByNodes(player, ctx, { leaving = false, keyPrefix = 'lane' } = {}) {
  const pendingLabel = ctx.edit.pendingLabels().get(player.id) ?? null;
  const label = pendingLabel ?? player.label;
  const canEdit = ctx.edit.isUnlocked() && !leaving;
  if (!label && !canEdit) return null;
  const edit = canEdit
    ? h('button', {
      class: 'linklike',
      type: 'button',
      'aria-label': `${label ? 'Modifier' : 'Ajouter'} le prénom du joueur : ${fullName(player)}`,
      dataset: { key: `${keyPrefix}:${player.id}:label` },
      on: { click: () => ctx.edit.editLabel(player) },
    }, label ? 'modifier' : 'Ajouter le prénom du joueur')
    : null;
  return [
    label ? `joué par ${label}` : null,
    pendingLabel ? ' (en cours…)' : null,
    label && edit ? ' · ' : null,
    edit,
  ].filter(Boolean);
}

const STATE_NOTES = {
  missing: 'Introuvable à la dernière vérification',
  error: 'Vérification impossible, nouvel essai bientôt',
  roster: 'Niveau lu dans la guilde',
};

export const stateNote = (player) => STATE_NOTES[player.state] ?? null;
