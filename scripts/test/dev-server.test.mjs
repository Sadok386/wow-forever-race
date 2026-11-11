import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { startDevServer } from '../dev-server.mjs';

const AUTH = { Authorization: 'Bearer test', 'Content-Type': 'application/json' };
const GH = '/__mock/github/repos/local/dev/actions';

let tmp;
let server;
let base;

const readJson = (file) => JSON.parse(fs.readFileSync(path.join(tmp, file), 'utf8'));

async function dispatch(inputs) {
  const res = await fetch(`${base}${GH}/workflows/tracker.yml/dispatches`, {
    method: 'POST',
    headers: AUTH,
    body: JSON.stringify({ ref: 'main', inputs, return_run_details: true }),
  });
  assert.equal(res.status, 200);
  return (await res.json()).workflow_run_id;
}

async function waitForRun(id) {
  const deadline = Date.now() + 30000;
  for (;;) {
    const run = await (await fetch(`${base}${GH}/runs/${id}`, { headers: AUTH })).json();
    if (run.status === 'completed') return run;
    assert.ok(Date.now() < deadline, 'run did not complete in time');
    await new Promise((r) => setTimeout(r, 200));
  }
}

// fetch normalises ".." out of URLs, so traversal attempts need a raw request.
function rawGet(rawPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.port, path: rawPath }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    }).on('error', reject);
  });
}

describe('dev server', () => {
  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wft-'));
    server = await startDevServer({ port: 0, speed: 60, sandbox: tmp, quiet: true, syncIntervalMs: 3600000 });
    base = `http://127.0.0.1:${server.port}`;
  });

  after(async () => {
    await server?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('seeds the sandbox and runs a first sync', () => {
    const roster = readJson('players.json');
    assert.equal(roster.players.length, 7);
    const data = readJson('data/data.json');
    assert.equal(data.players.length, 7);
    assert.equal(data.repo.owner, 'local');
    assert.equal(data.status.code, 'ok');
  });

  test('serves static files with the right headers', async () => {
    const res = await fetch(`${base}/assets/shared.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/javascript/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.match(await res.text(), /export/);
    assert.equal((await fetch(`${base}/`)).status, 200);
    assert.equal((await fetch(`${base}/nothing-here.js`)).status, 404);
  });

  test('serves generated data and a missing edit.json as 404', async () => {
    const res = await fetch(`${base}/data/data.json`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^application\/json/);
    assert.equal((await res.json()).schema, 1);
    assert.equal((await fetch(`${base}/edit.json`)).status, 404);
  });

  test('refuses path traversal', async () => {
    for (const p of ['/../package.json', '/%2e%2e/package.json', '/..%5cpackage.json', '/data/../../package.json', '/data/%2e%2e/%2e%2e/package.json', '/a%00b']) {
      const status = await rawGet(p);
      assert.ok(status === 400 || status === 404, `${p} -> ${status}`);
    }
  });

  test('mock GitHub requires authentication and answers CORS', async () => {
    const res = await fetch(`${base}${GH}/workflows/tracker.yml`);
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.deepEqual(await res.json(), { message: 'Requires authentication' });

    const ok = await fetch(`${base}${GH}/workflows/tracker.yml`, { headers: AUTH });
    assert.equal((await ok.json()).state, 'active');
    const enable = await fetch(`${base}${GH}/workflows/tracker.yml/enable`, { method: 'PUT', headers: AUTH });
    assert.equal(enable.status, 204);
  });

  test('add dispatch updates the roster and the data', async () => {
    const id = await dispatch({ op: 'add', region: 'eu', name: 'Joe', surname: 'Gun', label: 'Test' });
    const run = await waitForRun(id);
    assert.equal(run.conclusion, 'success');
    assert.ok(readJson('players.json').players.some((p) => p.name === 'Joe' && p.surname === 'Gun' && p.label === 'Test'));
    assert.ok(readJson('data/data.json').players.some((p) => p.id === 'eu:joe-gun'));

    const list = await (await fetch(`${base}${GH}/workflows/tracker.yml/runs?per_page=1`, { headers: AUTH })).json();
    assert.equal(list.workflow_runs.length, 1);
    assert.equal(list.workflow_runs[0].id, id);
  });

  test('invalid add ends in failure', async () => {
    const run = await waitForRun(await dispatch({ op: 'add', region: 'eu', name: 'J', surname: 'Gun' }));
    assert.equal(run.conclusion, 'failure');
  });

  test('set-edit-key publishes edit.json', async () => {
    const payload = JSON.stringify({ iv: 'A'.repeat(16), ct: 'B'.repeat(60) });
    const run = await waitForRun(await dispatch({ op: 'set-edit-key', payload }));
    assert.equal(run.conclusion, 'success');
    const res = await fetch(`${base}/edit.json`);
    assert.equal(res.status, 200);
    const doc = await res.json();
    assert.equal(doc.iv, 'A'.repeat(16));
    assert.equal(doc.alg, 'A256GCM');
  });

  test('dispatch without return_run_details answers 204, unknown run 404', async () => {
    const res = await fetch(`${base}${GH}/workflows/tracker.yml/dispatches`, { method: 'POST', headers: AUTH, body: JSON.stringify({ ref: 'main', inputs: { op: 'sync' } }) });
    assert.equal(res.status, 204);
    assert.equal((await fetch(`${base}${GH}/runs/99999`, { headers: AUTH })).status, 404);
  });

  test('runSyncNow rewrites the data', async () => {
    const before = readJson('data/data.json').generatedAt;
    await new Promise((r) => setTimeout(r, 1100));
    assert.equal(await server.runSyncNow(), 0);
    assert.notEqual(readJson('data/data.json').generatedAt, before);
  });
});
