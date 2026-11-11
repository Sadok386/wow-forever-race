import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGitHub, GitHubError } from '../../site/assets/github.js';

const BASE = {
  apiBase: 'https://api.github.com', owner: 'sadok', name: 'wow-forever-race',
  workflow: 'tracker.yml', branch: 'main', token: 'tok-123',
};
const ROOT = 'https://api.github.com/repos/sadok/wow-forever-race/actions';

function fake(...replies) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, ...init });
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status });
  };
  return { calls, gh: createGitHub({ ...BASE, fetchImpl }) };
}

test('every request carries the GitHub headers and no-store', async () => {
  const { gh, calls } = fake({ status: 200, body: { state: 'active', html_url: 'https://github.com/x' } });
  await gh.getWorkflow();
  assert.deepEqual(calls[0].headers, {
    Accept: 'application/vnd.github+json',
    Authorization: 'Bearer tok-123',
    'X-GitHub-Api-Version': '2022-11-28',
  });
  assert.equal(calls[0].cache, 'no-store');
  assert.equal(calls[0].body, undefined);
});

test('getWorkflow', async () => {
  const { gh, calls } = fake({ status: 200, body: { state: 'disabled_manually', html_url: 'u', id: 1 } });
  assert.deepEqual(await gh.getWorkflow(), { state: 'disabled_manually', html_url: 'u' });
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].url, `${ROOT}/workflows/tracker.yml`);
});

test('enableWorkflow', async () => {
  const { gh, calls } = fake({ status: 204 });
  assert.equal(await gh.enableWorkflow(), undefined);
  assert.equal(calls[0].method, 'PUT');
  assert.equal(calls[0].url, `${ROOT}/workflows/tracker.yml/enable`);
});

test('dispatch with run details (200)', async () => {
  const { gh, calls } = fake({ status: 200, body: { workflow_run_id: 99, run_url: 'r', html_url: 'https://github.com/run/99' } });
  const inputs = { op: 'add', region: 'eu', name: 'Joe', surname: 'Gun', label: '' };
  assert.deepEqual(await gh.dispatch(inputs), { runId: 99, htmlUrl: 'https://github.com/run/99' });
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, `${ROOT}/workflows/tracker.yml/dispatches`);
  assert.equal(calls[0].headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].body), { ref: 'main', inputs, return_run_details: true });
});

test('dispatch answered by 204', async () => {
  const { gh } = fake({ status: 204 });
  assert.deepEqual(await gh.dispatch({ op: 'sync' }), { runId: null, htmlUrl: null });
});

test('dispatch answered by 200 with an unreadable body', async () => {
  const { gh } = fake({ status: 200 });
  assert.deepEqual(await gh.dispatch({ op: 'sync' }), { runId: null, htmlUrl: null });
});

test('getRun', async () => {
  const { gh, calls } = fake({ status: 200, body: { status: 'completed', conclusion: 'failure', html_url: 'h', other: 1 } });
  assert.deepEqual(await gh.getRun(42), { status: 'completed', conclusion: 'failure', html_url: 'h' });
  assert.equal(calls[0].url, `${ROOT}/runs/42`);
});

test('listRuns defaults to 10 and honours perPage', async () => {
  const { gh, calls } = fake({ status: 200, body: { total_count: 1, workflow_runs: [{ id: 1 }] } }, { status: 200, body: {} });
  assert.deepEqual(await gh.listRuns(), [{ id: 1 }]);
  assert.equal(calls[0].url, `${ROOT}/workflows/tracker.yml/runs?per_page=10`);
  assert.deepEqual(await gh.listRuns({ perPage: 5 }), []);
  assert.equal(calls[1].url, `${ROOT}/workflows/tracker.yml/runs?per_page=5`);
});

test('a relative apiBase (dev server) is used as is, trailing slash ignored', async () => {
  const calls = [];
  const gh = createGitHub({
    ...BASE,
    apiBase: '/__mock/github/',
    fetchImpl: async (url) => { calls.push(url); return new Response('{}', { status: 200 }); },
  });
  await gh.getWorkflow();
  assert.equal(calls[0], '/__mock/github/repos/sadok/wow-forever-race/actions/workflows/tracker.yml');
});

test('owner and name are URL-encoded', async () => {
  const calls = [];
  const gh = createGitHub({
    ...BASE,
    owner: 'a b',
    name: 'c/d',
    fetchImpl: async (url) => { calls.push(url); return new Response('{}', { status: 200 }); },
  });
  await gh.getWorkflow();
  assert.ok(calls[0].startsWith('https://api.github.com/repos/a%20b/c%2Fd/'));
});

const MESSAGES = [
  [401, 'Le jeton GitHub est refusé (expiré ou supprimé).'],
  [403, 'GitHub refuse l’accès : le jeton n’a pas la permission « Actions » sur ce dépôt.'],
  [404, 'Dépôt ou workflow introuvable avec ce jeton.'],
  [422, 'GitHub a refusé la demande.'],
  [500, 'GitHub a répondu par une erreur (HTTP 500).'],
];

for (const [status, message] of MESSAGES) {
  test(`HTTP ${status} maps to a French GitHubError on every call`, async () => {
    const calls = [
      (gh) => gh.getWorkflow(),
      (gh) => gh.dispatch({ op: 'sync' }),
      (gh) => gh.getRun(1),
      (gh) => gh.enableWorkflow(),
      (gh) => gh.listRuns(),
    ];
    for (const call of calls) {
      const { gh } = fake({ status });
      await assert.rejects(call(gh), (error) => error instanceof GitHubError && error.status === status && error.message === message);
    }
  });
}

test('422 appends GitHub’s own message', async () => {
  const { gh } = fake({ status: 422, body: { message: 'Workflow does not have workflow_dispatch trigger' } });
  await assert.rejects(gh.dispatch({ op: 'sync' }), {
    message: 'GitHub a refusé la demande. Workflow does not have workflow_dispatch trigger',
  });
});

test('a network failure becomes a GitHubError with status 0', async () => {
  const { gh } = fake(new TypeError('fetch failed'));
  await assert.rejects(gh.getWorkflow(), (error) => (
    error instanceof GitHubError && error.status === 0 && error.message === 'GitHub est injoignable. Vérifie ta connexion.'
  ));
});

test('the token never appears in an error message', async () => {
  const { gh } = fake({ status: 401 });
  await assert.rejects(gh.getWorkflow(), (error) => !error.message.includes('tok-123'));
});
