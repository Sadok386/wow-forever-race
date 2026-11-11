// Minimal GitHub REST client: only what the edit flows need (dispatch a workflow and follow it).
// Messages are French because they are shown to people as they are.

export class GitHubError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

const NETWORK_MESSAGE = 'GitHub est injoignable. Vérifie ta connexion.';

async function toError(response) {
  const { status } = response;
  if (status === 401) return new GitHubError('Le jeton GitHub est refusé (expiré ou supprimé).', status);
  if (status === 403) return new GitHubError('GitHub refuse l’accès : le jeton n’a pas la permission « Actions » sur ce dépôt.', status);
  if (status === 404) return new GitHubError('Dépôt ou workflow introuvable avec ce jeton.', status);
  if (status === 422) {
    const body = await response.json().catch(() => null);
    const detail = typeof body?.message === 'string' ? ` ${body.message}` : '';
    return new GitHubError(`GitHub a refusé la demande.${detail}`, status);
  }
  return new GitHubError(`GitHub a répondu par une erreur (HTTP ${status}).`, status);
}

export function createGitHub({ apiBase, owner, name, workflow, branch, token, fetchImpl = fetch }) {
  const base = String(apiBase).replace(/\/+$/, '');
  const repo = `${base}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/actions`;
  const workflowUrl = `${repo}/workflows/${encodeURIComponent(workflow)}`;

  async function request(method, url, body) {
    const headers = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
      });
    } catch {
      throw new GitHubError(NETWORK_MESSAGE);
    }
    if (!response.ok) throw await toError(response);
    return response;
  }

  // 204 and unreadable bodies both mean "nothing to report".
  const readJson = (response) => (response.status === 204 ? null : response.json().catch(() => null));

  return {
    async getWorkflow() {
      const json = await readJson(await request('GET', workflowUrl));
      return { state: json?.state ?? null, html_url: json?.html_url ?? null };
    },

    async enableWorkflow() {
      await request('PUT', `${workflowUrl}/enable`);
    },

    async dispatch(inputs) {
      const response = await request('POST', `${workflowUrl}/dispatches`, {
        ref: branch,
        inputs,
        return_run_details: true,
      });
      const json = await readJson(response);
      return { runId: json?.workflow_run_id ?? null, htmlUrl: json?.html_url ?? null };
    },

    async getRun(runId) {
      const json = await readJson(await request('GET', `${repo}/runs/${encodeURIComponent(runId)}`));
      return { status: json?.status ?? null, conclusion: json?.conclusion ?? null, html_url: json?.html_url ?? null };
    },

    async listRuns({ perPage = 10 } = {}) {
      const json = await readJson(await request('GET', `${workflowUrl}/runs?per_page=${perPage}`));
      return Array.isArray(json?.workflow_runs) ? json.workflow_runs : [];
    },
  };
}

/** A link to a workflow run is only worth showing when it points at github.com over https. */
export function safeRunUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'github.com' ? parsed.href : null;
  } catch {
    return null;
  }
}

/** A finished run that did not succeed ("cancelled" is a choice, not a failure). */
export function isFailedRun(run) {
  return run?.status === 'completed' && ['failure', 'timed_out', 'startup_failure'].includes(run.conclusion);
}

/**
 * A pending sync is done when the data is newer than the dispatch, or when its run was seen
 * succeeding (`runSucceeded`, only set before a reload) - the visitor's clock may run ahead of the server's.
 */
export function isSyncResolved(op, generatedAt) {
  return Date.parse(generatedAt) > op.at || op.runSucceeded === true;
}
