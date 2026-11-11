// Minimal Blizzard API client: client-credentials token, retry policy, status semantics of the contract.

export const LOCALES = { eu: 'fr_FR', us: 'en_US', kr: 'ko_KR', tw: 'zh_TW' };

export const profileNamespace = (region) => `profile-forever-${region}`;
export const staticNamespace = (region) => `static-forever-${region}`;

export function characterPath(slug, sub = '') {
  return `/profile/wow/character/${encodeURIComponent(slug)}${sub}`;
}

export class BlizzardAuthError extends Error {
  name = 'BlizzardAuthError';
}

const ATTEMPTS = 3;
const RETRY_WAITS_MS = [500, 1500];
const RETRY_AFTER_CAP_MS = 10_000;
const TIMEOUT_MS = 15_000;

const isTransient = (status) => status === 429 || status >= 500;

function retryAfterMs(headers) {
  const raw = headers.get('retry-after')?.trim();
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, RETRY_AFTER_CAP_MS) : null;
}

export class BlizzardClient {
  requestCount = 0;
  #token = null;

  constructor({
    clientId,
    clientSecret,
    oauthUrl = 'https://oauth.battle.net/token',
    apiTemplate = 'https://{region}.api.blizzard.com',
    log = () => {},
    // Injectable so that tests do not really wait.
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {}) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.oauthUrl = oauthUrl;
    this.apiTemplate = apiTemplate;
    this.log = log;
    this.sleep = sleep;
  }

  /** One HTTP exchange with the retry policy. Resolves { status, headers, text }; status 0 = network failure. */
  async #exchange(url, init) {
    let last;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      this.requestCount++;
      let retryAfter = null;
      try {
        const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
        last = { status: res.status, headers: res.headers, text: await res.text() };
        if (!isTransient(res.status)) return last;
        retryAfter = retryAfterMs(res.headers);
      } catch {
        last = { status: 0, headers: new Headers(), text: '' };
      }
      if (attempt < ATTEMPTS) {
        const wait = retryAfter ?? RETRY_WAITS_MS[attempt - 1];
        this.log(`Blizzard : réponse ${last.status || 'réseau'}, nouvel essai dans ${wait} ms (${attempt}/${ATTEMPTS}).`);
        await this.sleep(wait);
      }
    }
    return last;
  }

  /** Fetched once per run and shared by concurrent callers. */
  getToken() {
    this.#token ??= this.#fetchToken().catch((err) => {
      // A refusal is final for this run; anything else may succeed on a later call.
      if (!(err instanceof BlizzardAuthError)) this.#token = null;
      throw err;
    });
    return this.#token;
  }

  async #fetchToken() {
    if (!this.clientId || !this.clientSecret) throw new BlizzardAuthError('Missing Blizzard client credentials.');
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const { status, text } = await this.#exchange(this.oauthUrl, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    if (status === 200) {
      const token = parseJson(text)?.access_token;
      if (typeof token === 'string' && token) return token;
      throw new Error('Blizzard token response without access_token.');
    }
    if (status >= 400 && status < 500 && status !== 429) {
      throw new BlizzardAuthError(`Blizzard refused the client credentials (HTTP ${status}).`);
    }
    throw new Error(`Blizzard token endpoint unavailable (HTTP ${status || 'network error'}).`);
  }

  async get(region, path, namespace) {
    const token = await this.getToken();
    const query = new URLSearchParams({ namespace, locale: LOCALES[region] ?? 'en_US' });
    const url = `${this.apiTemplate.replace('{region}', region)}${path}?${query}`;
    const { status, text } = await this.#exchange(url, { headers: { Authorization: `Bearer ${token}` } });
    if (status === 401) throw new BlizzardAuthError('Blizzard rejected the access token (HTTP 401).');
    return { status, json: parseJson(text), empty: text.trim() === '' };
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
