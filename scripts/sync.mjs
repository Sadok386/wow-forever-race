// Entry point of the workflow step that queries Blizzard; see scripts/lib/sync-core.mjs.
import { runSync } from './lib/sync-core.mjs';

try {
  await runSync({});
} catch (err) {
  // Only reached when the data files cannot be read or written: API problems end up in data.json instead.
  console.log(`::error::La synchronisation a échoué : ${err.message}`);
  process.exitCode = 1;
}
