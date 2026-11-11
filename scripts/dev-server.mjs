// Local demo: serves site/ with a mock Blizzard API and a mock GitHub API, so the whole
// product (sync, leaderboard, edit flows) can be tried without credentials or network.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createMockBlizzard } from './lib/mock-blizzard.mjs';
import { ROOT } from './lib/paths.mjs';

const SITE_DIR = path.join(ROOT, 'site');
const MOCK_BLIZZARD = '/__mock/blizzard';
const MOCK_GITHUB = '/__mock/github';
const RUN_START_DELAY_MS = 1500;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const DEMO_PLAYERS = [
  ['Aldric', 'Ventor', 'Max'],
  ['Brynn', 'Valcourt', 'Léa'],
  ['Corwin', 'Maelis', 'Hugo'],
  ['Dara', 'Nevers', 'Inès'],
  ['Elior', 'Sombrebois', 'Malik'],
  ['Debutant', 'Petitpas', 'Nouveau'],
  ['Inconnu', 'Fantome', 'Mystère'],
];

/**
 * The demo always races the fictional players: the mock API invents every level, so real character
 * names from the repository's roster would only show made-up progress. The repository's settings
 * (title, goal level, XP table) are kept so the demo previews them; its guilds are real ones that
 * mean nothing to the fictional players.
 */
function seedRoster(nowIso) {
  let settings = { title: 'Course au niveau 60', goalLevel: 60 };
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(ROOT, 'players.json'), 'utf8'));
    if (parsed?.settings && typeof parsed.settings === 'object' && !Array.isArray(parsed.settings)) {
      const { guilds: _realGuilds, ...kept } = parsed.settings;
      settings = { ...settings, ...kept };
    }
  } catch {
    // A missing or broken repository roster just means the default settings.
  }
  const players = DEMO_PLAYERS.map(([name, surname, label]) => ({ region: 'eu', name, surname, label, addedAt: nowIso }));
  return `${JSON.stringify({ version: 1, settings, players }, null, 2)}\n`;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function sendJson(res, status, value, headers = {}) {
  send(res, status, JSON.stringify(value), { 'Content-Type': MIME['.json'], ...headers });
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

// Resolves `urlPath` below `root`, or null when it would escape it (".." segments, encoded or not).
function resolveInside(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const file = path.resolve(root, `.${path.sep}${decoded.replace(/^[/\\]+/, '')}`);
  const rel = path.relative(root, file);
  return rel.startsWith('..') || path.isAbsolute(rel) ? null : file;
}

function serveFile(req, res, file) {
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) return send(res, 404, 'Introuvable');
    fs.readFile(file, (readErr, content) => {
      if (readErr) return send(res, 404, 'Introuvable');
      const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
      send(res, 200, req.method === 'HEAD' ? undefined : content, { 'Content-Type': type, 'Content-Length': content.length });
    });
  });
}

function runNode(args, env, label, quiet) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const relay = (stream, out) => {
      let pending = '';
      stream.setEncoding('utf8');
      stream.on('data', (text) => {
        pending += text;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop();
        if (!quiet) for (const line of lines) out.write(`[${label}] ${line}\n`);
      });
    };
    relay(child.stdout, process.stdout);
    relay(child.stderr, process.stderr);
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

export async function startDevServer({ port = 0, speed = 60, sandbox, quiet = false, syncIntervalMs = 20000 } = {}) {
  sandbox = path.resolve(sandbox ?? path.join(ROOT, '.dev'));
  const rosterPath = path.join(sandbox, 'players.json');
  const dataPath = path.join(sandbox, 'data');
  const editPath = path.join(sandbox, 'edit.json');
  fs.mkdirSync(dataPath, { recursive: true });
  if (!fs.existsSync(rosterPath)) fs.writeFileSync(rosterPath, seedRoster(new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')));

  const mock = createMockBlizzard({ speed });
  const runs = [];
  const timers = new Set();
  const tasks = new Set();
  let closed = false;
  let origin = '';
  let syncTail = Promise.resolve();
  let queuedSyncs = 0;

  const log = (message) => {
    if (!quiet) console.log(message);
  };

  const baseEnv = () => {
    const env = { ...process.env, TRACKER_ROSTER_FILE: rosterPath, TRACKER_DATA_DIR: dataPath, TRACKER_EDIT_FILE: editPath };
    // The demo must never write into a real workflow summary.
    delete env.GITHUB_STEP_SUMMARY;
    return env;
  };

  const syncEnv = () => ({
    ...baseEnv(),
    TRACKER_REPO: 'local/dev',
    TRACKER_BRANCH: 'main',
    TRACKER_API_BASE: MOCK_GITHUB,
    BLIZZARD_CLIENT_ID: 'dev',
    BLIZZARD_CLIENT_SECRET: 'dev',
    BLIZZARD_OAUTH_URL: `${origin}${MOCK_BLIZZARD}/oauth/token`,
    BLIZZARD_API_TEMPLATE: `${origin}${MOCK_BLIZZARD}/{region}`,
  });

  // Runs are chained so that two syncs never write the data directory at the same time.
  function runSyncNow() {
    queuedSyncs += 1;
    const run = syncTail.then(() => runNode([path.join(ROOT, 'scripts', 'sync.mjs')], syncEnv(), 'sync', quiet));
    syncTail = run.then(
      () => { queuedSyncs -= 1; },
      () => { queuedSyncs -= 1; },
    );
    return run;
  }

  async function executeRun(run, inputs) {
    run.status = 'in_progress';
    run.updated_at = new Date().toISOString();
    let ok = true;
    if (inputs.op !== 'sync') {
      const env = { ...baseEnv() };
      for (const [key, input] of [['OP', 'op'], ['REGION', 'region'], ['NAME', 'name'], ['SURNAME', 'surname'], ['LABEL', 'label'], ['PAYLOAD', 'payload']]) {
        env[key] = typeof inputs[input] === 'string' ? inputs[input] : '';
      }
      ok = (await runNode([path.join(ROOT, 'scripts', 'roster.mjs')], env, 'roster', quiet)) === 0;
    }
    if (ok) ok = (await runSyncNow()) === 0;
    run.status = 'completed';
    run.conclusion = ok ? 'success' : 'failure';
    run.updated_at = new Date().toISOString();
  }

  function createRun(inputs) {
    const now = new Date().toISOString();
    const run = { id: runs.length + 1, event: 'workflow_dispatch', status: 'queued', conclusion: null, created_at: now, updated_at: now, html_url: '#' };
    runs.push(run);
    const timer = setTimeout(() => {
      timers.delete(timer);
      const task = executeRun(run, inputs).catch((err) => {
        run.status = 'completed';
        run.conclusion = 'failure';
        log(`[dev] ${err.message}`);
      });
      tasks.add(task);
      task.finally(() => tasks.delete(task));
    }, RUN_START_DELAY_MS);
    timers.add(timer);
    return run;
  }

  async function handleGithub(req, res, pathname) {
    const cors = { 'Access-Control-Allow-Origin': '*' };
    if (req.method === 'OPTIONS') {
      return send(res, 204, undefined, {
        ...cors,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
        'Access-Control-Allow-Headers': 'Accept, Authorization, Content-Type, X-GitHub-Api-Version',
      });
    }
    if (!req.headers.authorization) return sendJson(res, 401, { message: 'Requires authentication' }, cors);

    const route = pathname.slice(MOCK_GITHUB.length).match(/^\/repos\/[^/]+\/[^/]+\/actions\/(workflows\/[^/]+(?:\/(enable|dispatches|runs))?|runs\/(\d+))$/);
    if (!route) return sendJson(res, 404, { message: 'Not Found' }, cors);
    const [, , action, runId] = route;

    if (runId) {
      const run = req.method === 'GET' ? runs.find((r) => r.id === Number(runId)) : null;
      return run ? sendJson(res, 200, run, cors) : sendJson(res, 404, { message: 'Not Found' }, cors);
    }
    if (!action && req.method === 'GET') {
      return sendJson(res, 200, { id: 1, name: 'Tracker', path: '.github/workflows/tracker.yml', state: 'active', html_url: '#' }, cors);
    }
    if (action === 'enable' && req.method === 'PUT') return send(res, 204, undefined, cors);
    if (action === 'runs' && req.method === 'GET') {
      const perPage = Number(new URL(req.url, 'http://x').searchParams.get('per_page')) || 30;
      return sendJson(res, 200, { total_count: runs.length, workflow_runs: [...runs].reverse().slice(0, perPage) }, cors);
    }
    if (action === 'dispatches' && req.method === 'POST') {
      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        return sendJson(res, 400, { message: 'Problems parsing JSON' }, cors);
      }
      if (!body || typeof body !== 'object' || (body.inputs !== undefined && (typeof body.inputs !== 'object' || body.inputs === null))) {
        return sendJson(res, 422, { message: 'Invalid request.' }, cors);
      }
      const run = createRun(body.inputs ?? {});
      if (!body.return_run_details) return send(res, 204, undefined, cors);
      return sendJson(res, 200, { workflow_run_id: run.id, run_url: `${MOCK_GITHUB}/repos/local/dev/actions/runs/${run.id}`, html_url: '#' }, cors);
    }
    return sendJson(res, 404, { message: 'Not Found' }, cors);
  }

  async function handle(req, res) {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === MOCK_BLIZZARD || pathname.startsWith(`${MOCK_BLIZZARD}/`)) {
      if (!(await mock.handle(req, res, MOCK_BLIZZARD))) send(res, 404, 'Introuvable');
      return;
    }
    if (pathname === MOCK_GITHUB || pathname.startsWith(`${MOCK_GITHUB}/`)) return handleGithub(req, res, pathname);

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Méthode non autorisée', { Allow: 'GET, HEAD' });
    let file;
    if (pathname.startsWith('/data/')) file = resolveInside(dataPath, pathname.slice('/data/'.length));
    else if (pathname === '/edit.json') file = editPath;
    else file = resolveInside(SITE_DIR, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    if (!file) return send(res, 400, 'Chemin refusé');
    serveFile(req, res, file);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      log(`[dev] ${err.message}`);
      if (!res.headersSent) send(res, 500, 'Erreur interne');
      else res.destroy();
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const actualPort = server.address().port;
  origin = `http://127.0.0.1:${actualPort}`;

  async function close() {
    if (closed) return;
    closed = true;
    clearInterval(interval);
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    const stopped = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections();
    await stopped;
    await Promise.all([...tasks, syncTail]);
  }

  const interval = setInterval(() => {
    if (queuedSyncs === 0) runSyncNow().catch((err) => log(`[dev] ${err.message}`));
  }, syncIntervalMs);

  try {
    await runSyncNow();
  } catch (err) {
    await close();
    throw err;
  }
  return { url: `${origin}/`, port: actualPort, close, runSyncNow };
}

async function main() {
  const { values } = parseArgs({ options: { port: { type: 'string', default: '4173' }, speed: { type: 'string', default: '60' }, reset: { type: 'boolean', default: false } } });
  const port = Number(values.port);
  const speed = Number(values.speed);
  if (!Number.isInteger(port) || port < 0 || port > 65535 || !(speed > 0)) {
    console.error('Usage : node scripts/dev-server.mjs [--port 4173] [--speed 60] [--reset]');
    process.exitCode = 2;
    return;
  }
  const sandbox = path.join(ROOT, '.dev');
  if (values.reset) fs.rmSync(sandbox, { recursive: true, force: true });

  let server;
  try {
    server = await startDevServer({ port, speed, sandbox });
  } catch (err) {
    console.error(`Impossible de démarrer le serveur : ${err.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Démo locale : ${server.url}`);
  console.log('Dans la fenêtre de configuration, n’importe quel texte fait office de jeton GitHub. Ctrl+C pour arrêter.');

  let stopping = false;
  const stop = () => {
    if (stopping) process.exit(1);
    stopping = true;
    server.close().then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
