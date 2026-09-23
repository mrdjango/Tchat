/**
 * TinyFish (https://docs.tinyfish.ai) behind the broker, as Tchat's only web
 * search and web fetch backend.
 *
 * LibreChat has no TinyFish provider, but its built-in Tavily provider takes
 * configurable search and extract URLs. So the broker answers in Tavily's shape
 * and translates each call to TinyFish's Search and Fetch APIs, and the same
 * Fetch API is offered as a one-tool MCP server (`web_fetch`) for URLs the user
 * names directly, which the search tool has no way to open.
 *
 * The TinyFish key lives here only. tchat-api presents the broker's shared
 * ingress key, exactly as it does for inference, and never holds the real one.
 */
import { BrokerError } from './errors.js';

export const TINYFISH_PREFIX = '/tinyfish/';

/** TinyFish rejects a Fetch batch larger than this. */
const FETCH_BATCH_SIZE = 10;
/** TinyFish's ceiling for `per_url_timeout_ms`. */
const MAX_PER_URL_TIMEOUT_MS = 110_000;

const MINUTES_PER = { day: 1_440, week: 10_080, month: 43_200, year: 525_600 };

/** Tavily sends English country names; TinyFish wants ISO codes. These are the
 *  names LibreChat produces that `Intl.DisplayNames` spells differently. */
const COUNTRY_ALIASES = {
  congo: 'CG',
  'czech republic': 'CZ',
  turkey: 'TR',
  'united states': 'US',
  'united kingdom': 'GB',
};

const normalizeCountryName = (name) =>
  name
    .toLowerCase()
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s*&\s*/g, ' and ')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

const COUNTRY_CODES = (() => {
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  const map = new Map(Object.entries(COUNTRY_ALIASES));
  for (let a = 65; a <= 90; a += 1) {
    for (let b = 65; b <= 90; b += 1) {
      const code = String.fromCharCode(a, b);
      let name;
      try {
        // Retired codes (DD, YU, ...) canonicalize to their successor and would
        // otherwise claim the current country's name.
        if (Intl.getCanonicalLocales(`und-${code}`)[0] !== `und-${code}`) {
          continue;
        }
        name = names.of(code);
      } catch {
        continue;
      }
      if (name && name !== code && !map.has(normalizeCountryName(name))) {
        map.set(normalizeCountryName(name), code);
      }
    }
  }
  return map;
})();

export const countryCode = (country) => {
  if (typeof country !== 'string' || !country.trim()) {
    return undefined;
  }
  const value = country.trim();
  if (/^[a-z]{2}$/i.test(value)) {
    return value.toUpperCase();
  }
  return COUNTRY_CODES.get(normalizeCountryName(value));
};

const isHttpUrl = (value) => {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

const notConfigured = () =>
  new BrokerError({
    status: 503,
    code: 'web_search_unconfigured',
    type: 'api_error',
    message: 'Web search is not configured on this Tchat deployment.',
  });

const badRequest = (message) => new BrokerError({ status: 400, code: 'invalid_request', message });

const tinyfishFailure = (status, detail) =>
  new BrokerError({
    // A 429 is the shared per-key rate limit; pass it through so the caller
    // sees a retryable condition rather than a generic outage.
    status: status === 429 ? 429 : 502,
    code: status === 429 ? 'web_search_rate_limited' : 'web_search_upstream_error',
    type: 'api_error',
    message: `TinyFish returned ${status}${detail ? `: ${detail}` : ''}`,
  });

const readJson = async (request) => {
  try {
    return await request.json();
  } catch {
    throw badRequest('Request body must be JSON.');
  }
};

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const createTinyfish = ({ config, fetchImpl }) => {
  const call = async (url, init) => {
    if (!config.tinyfishApiKey) {
      throw notConfigured();
    }
    const response = await fetchImpl(url, {
      ...init,
      headers: { ...init.headers, 'X-API-Key': config.tinyfishApiKey },
      signal: AbortSignal.timeout(config.tinyfishTimeoutMs),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw tinyfishFailure(response.status, detail);
    }
    return response.json();
  };

  /** One TinyFish Fetch call per 10 URLs, merged back in request order. */
  const fetchPages = async (urls, { timeoutMs, purpose } = {}) => {
    const batches = [];
    for (let i = 0; i < urls.length; i += FETCH_BATCH_SIZE) {
      batches.push(urls.slice(i, i + FETCH_BATCH_SIZE));
    }
    const responses = await Promise.all(
      batches.map((batch) =>
        call(config.tinyfishFetchUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            urls: batch,
            format: 'markdown',
            ...(timeoutMs
              ? { per_url_timeout_ms: Math.min(timeoutMs, MAX_PER_URL_TIMEOUT_MS) }
              : {}),
            ...(purpose ? { purpose: purpose.slice(0, 2000) } : {}),
          }),
        }),
      ),
    );
    return {
      results: responses.flatMap((body) => body.results ?? []),
      errors: responses.flatMap((body) => body.errors ?? []),
    };
  };

  const truncate = (text) => {
    const value = typeof text === 'string' ? text : '';
    if (value.length <= config.tinyfishFetchMaxChars) {
      return value;
    }
    return `${value.slice(0, config.tinyfishFetchMaxChars)}\n\n[truncated: page is ${value.length} characters]`;
  };

  /** Tavily `POST /search` → TinyFish `GET /?query=`. */
  const tavilySearch = async (request) => {
    const body = await readJson(request);
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) {
      throw badRequest('query is required');
    }
    const params = new URLSearchParams({ query });
    if (body.topic === 'news') {
      params.set('domain_type', 'news');
    }
    const minutes = MINUTES_PER[body.time_range];
    if (minutes) {
      params.set('recency_minutes', String(minutes));
    }
    const location = countryCode(body.country);
    if (location) {
      params.set('location', location);
    }
    if (Array.isArray(body.include_domains) && body.include_domains.length) {
      params.set('include_domains', body.include_domains.join(','));
    }
    if (Array.isArray(body.exclude_domains) && body.exclude_domains.length) {
      params.set('exclude_domains', body.exclude_domains.join(','));
    }

    const data = await call(`${config.tinyfishSearchUrl}?${params}`, { method: 'GET' });
    const limit = Number.isInteger(body.max_results) ? body.max_results : 10;
    return json(200, {
      query,
      results: (data.results ?? []).slice(0, Math.max(1, limit)).map((result) => ({
        title: result.title ?? '',
        url: result.url ?? '',
        content: result.snippet ?? '',
        ...(result.date ? { published_date: result.date } : {}),
      })),
      images: [],
    });
  };

  /** Tavily `POST /extract` → TinyFish Fetch. */
  const tavilyExtract = async (request) => {
    const body = await readJson(request);
    const urls = Array.isArray(body.urls) ? body.urls.filter((url) => typeof url === 'string') : [];
    if (urls.length === 0) {
      throw badRequest('urls is required');
    }
    const valid = urls.filter(isHttpUrl);
    const invalid = urls.filter((url) => !isHttpUrl(url));
    // Tavily's `timeout` is seconds for the whole call; TinyFish budgets per URL.
    const timeoutMs =
      typeof body.timeout === 'number' ? Math.round(body.timeout * 1000) : undefined;
    const { results, errors } = valid.length
      ? await fetchPages(valid, { timeoutMs })
      : { results: [], errors: [] };
    return json(200, {
      results: results.map((result) => ({
        url: result.url,
        raw_content: truncate(result.text),
        images: [],
      })),
      failed_results: [
        ...errors.map((error) => ({ url: error.url, error: error.error ?? 'fetch_failed' })),
        ...invalid.map((url) => ({ url, error: 'invalid_url' })),
      ],
    });
  };

  const WEB_FETCH_TOOL = {
    name: 'web_fetch',
    title: 'Web fetch',
    description:
      'Fetch one or more web pages by URL and return their main content as Markdown. ' +
      'Use it when the user gives you a link, or to read a page in full after a web search. ' +
      'Only public http(s) URLs work; pages behind a login are not reachable.',
    inputSchema: {
      type: 'object',
      properties: {
        urls: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: FETCH_BATCH_SIZE,
          description: `Absolute http(s) URLs to fetch, at most ${FETCH_BATCH_SIZE}.`,
        },
        purpose: {
          type: 'string',
          description: 'Optional: what you need from these pages, which helps extraction.',
        },
      },
      required: ['urls'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  };

  const runWebFetch = async (args = {}) => {
    const urls = Array.isArray(args.urls) ? args.urls.filter((url) => typeof url === 'string') : [];
    if (urls.length === 0 || urls.length > FETCH_BATCH_SIZE) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Pass between 1 and ${FETCH_BATCH_SIZE} URLs.` }],
      };
    }
    const invalid = urls.filter((url) => !isHttpUrl(url));
    const valid = urls.filter(isHttpUrl);
    const purpose =
      typeof args.purpose === 'string' && args.purpose.trim() ? args.purpose : undefined;
    const { results, errors } = valid.length
      ? await fetchPages(valid, { purpose })
      : { results: [], errors: [] };

    const sections = results.map((result) => {
      const heading = result.title ? `# ${result.title}\n` : '';
      const source =
        result.final_url && result.final_url !== result.url ? result.final_url : result.url;
      return `${heading}Source: ${source}\n\n${truncate(result.text)}`;
    });
    for (const error of errors) {
      const status = error.status ? ` (HTTP ${error.status})` : '';
      sections.push(`Could not fetch ${error.url}: ${error.error}${status}`);
    }
    for (const url of invalid) {
      sections.push(`Could not fetch ${url}: not an absolute http(s) URL`);
    }
    return {
      isError: results.length === 0,
      content: [{ type: 'text', text: sections.join('\n\n---\n\n') }],
    };
  };

  const rpcResult = (id, result) => json(200, { jsonrpc: '2.0', id, result });
  const rpcError = (id, code, message) =>
    json(200, { jsonrpc: '2.0', id: id ?? null, error: { code, message } });

  /**
   * Stateless MCP over Streamable HTTP, JSON responses only. That is enough for
   * a server with one tool and no notifications of its own: every request gets
   * its answer in the POST response, so no session or SSE stream is needed.
   */
  const mcp = async (request) => {
    if (request.method !== 'POST') {
      return new Response(null, { status: 405, headers: { Allow: 'POST' } });
    }
    let message;
    try {
      message = await request.json();
    } catch {
      return rpcError(null, -32700, 'Parse error');
    }
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return rpcError(null, -32600, 'Invalid request');
    }
    const { id, method, params } = message;
    // Notifications (no id) and responses carry nothing to answer.
    if (id === undefined || id === null) {
      return new Response(null, { status: 202 });
    }

    switch (method) {
      case 'initialize':
        return rpcResult(id, {
          protocolVersion: params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'tchat-tinyfish', title: 'TinyFish web fetch', version: '1.0.0' },
        });
      case 'ping':
        return rpcResult(id, {});
      case 'tools/list':
        return rpcResult(id, { tools: [WEB_FETCH_TOOL] });
      case 'tools/call': {
        if (params?.name !== WEB_FETCH_TOOL.name) {
          return rpcError(id, -32602, `Unknown tool: ${params?.name}`);
        }
        try {
          return rpcResult(id, await runWebFetch(params.arguments));
        } catch (error) {
          const text = error instanceof BrokerError ? error.message : 'web fetch failed';
          return rpcResult(id, { isError: true, content: [{ type: 'text', text }] });
        }
      }
      default:
        return rpcError(id, -32601, `Method not found: ${method}`);
    }
  };

  const routes = {
    '/tinyfish/tavily/search': tavilySearch,
    '/tinyfish/tavily/extract': tavilyExtract,
    '/tinyfish/mcp': mcp,
  };

  return async (request, url) => {
    const route = routes[url.pathname];
    if (!route) {
      throw new BrokerError({
        status: 404,
        code: 'unsupported_path',
        message: `The TensorGrid broker does not serve ${url.pathname}.`,
      });
    }
    if (route !== mcp && request.method !== 'POST') {
      return new Response(null, { status: 405, headers: { Allow: 'POST' } });
    }
    return route(request);
  };
};
