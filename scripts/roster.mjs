// Entry point of the workflow step that edits the roster. Inputs are untrusted and arrive as
// environment variables only; see .github/workflows/tracker.yml.
import fs from 'node:fs';
import path from 'node:path';
import { editFile, rosterFile } from './lib/paths.mjs';
import { RosterError, applyOp, parseRoster, serializeRoster, validateEditPayload } from './lib/roster.mjs';

const env = process.env;

function nowIso() {
  const d = env.TRACKER_NOW ? new Date(env.TRACKER_NOW) : new Date();
  if (Number.isNaN(d.getTime())) throw new RosterError('TRACKER_NOW n’est pas une date valide.');
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function readRoster(file) {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  // Rewriting an unreadable file would silently wipe a hand edit: refuse instead.
  if (text.trim()) {
    try {
      JSON.parse(text);
    } catch {
      throw new RosterError('players.json est illisible (JSON invalide) : corrige-le avant de modifier la liste.');
    }
  }
  return parseRoster(text);
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function run() {
  const op = (env.OP ?? '').trim();

  if (op === 'add' || op === 'remove') {
    const file = rosterFile();
    const { roster, warnings } = readRoster(file);
    for (const w of warnings) console.log(`::warning::${w}`);
    const result = applyOp(
      roster,
      { op, region: (env.REGION ?? '').trim().toLowerCase(), name: env.NAME, surname: env.SURNAME, label: env.LABEL },
      nowIso(),
    );
    if (!result.changed) return '';
    writeFile(file, serializeRoster(result.roster));
    return result.message;
  }

  if (op === 'set-edit-key') {
    const { iv, ct } = validateEditPayload(env.PAYLOAD ?? '');
    const doc = { v: 1, alg: 'A256GCM', iv, ct, createdAt: nowIso() };
    writeFile(editFile(), `${JSON.stringify(doc, null, 2)}\n`);
    return 'config: lien de modification';
  }

  throw new RosterError('Action inconnue : attendu add, remove ou set-edit-key.');
}

try {
  const message = run();
  if (message && env.ROSTER_MESSAGE_FILE) writeFile(env.ROSTER_MESSAGE_FILE, `${message}\n`);
  console.log(`MESSAGE=${message}`);
} catch (err) {
  if (!(err instanceof RosterError)) throw err;
  console.log(`::error::${err.message}`);
  process.exitCode = 2;
}
