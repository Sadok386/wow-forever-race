import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// The environment overrides let tests and the dev server work in a sandbox without touching the repository.
export function rosterFile() {
  return process.env.TRACKER_ROSTER_FILE || path.join(ROOT, 'players.json');
}

export function dataDir() {
  return process.env.TRACKER_DATA_DIR || path.join(ROOT, 'site', 'data');
}

export function editFile() {
  return process.env.TRACKER_EDIT_FILE || path.join(ROOT, 'site', 'edit.json');
}
