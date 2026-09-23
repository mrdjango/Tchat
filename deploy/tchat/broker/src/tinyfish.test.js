import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCache } from './cache.js';
import { createApp } from './app.js';
import { countryCode } from './tinyfish.js';

const config = {
  port: 8081,
  sharedKey: 'broker-shared-key-value',
  tchatSecret: 'tchat-broker-test-secret-32-bytes-minimum',
  gatewaySecret: 'gateway-test-secret-32-bytes-minimum-value',
  djangoBaseUrl: 'http://backend:8000',
  gatewayInternalBaseUrl: 'http://models-gateway:3000',
  upstreamBaseUrl: 'https://api.tensorgrid.space',
  tokenName: 'TCHAT',
  tokenLifetimeDays: 30,
  subjectCacheSeconds: 900,
  tokenCacheSeconds: 3600,
  requestTimeoutMs: 5000,
  tinyfishApiKey: 'sk-tinyfish-test',
  tinyfishSearchUrl: 'https://api.search.tinyfish.ai',
  tinyfishFetchUrl: 'https://api.fetch.tinyfish.ai',
  tinyfishTimeoutMs: 5000,
  tinyfishFetchMaxChars: 100,
};

const silent = { error() {}, log() {} };

const jsonOk = (body) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

/** Stands in for TinyFish Search and Fetch. */
const makeFetch = ({ searchStatus = 200 } = {}) => {
  const calls = [];
  const impl = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    if (url.startsWith(config.tinyfishSearchUrl)) {
      if (searchStatus !== 200) {
        return new Response('slow down', { status: searchStatus });
      }
      return jsonOk({
        query: 'q',
        results: [
          {
            position: 1,
            title: 'One',
            url: 'https://one.example',
            snippet: 'first',
            date: 'May 1, 2026',
          },
          { position: 2, title: 'Two', url: 'https://two.example', snippet: 'second' },
          { position: 3, title: 'Three', url: 'https://three.example', snippet: 'third' },
        ],
      });
    }
    if (url.startsWith(config.tinyfishFetchUrl)) {
      const { urls } = JSON.parse(init.body);
      return jsonOk({
        results: urls
          .filter((page) => !page.includes('broken'))
          .map((page) => ({
            url: page,
            final_url: page,
            title: `Title of ${page}`,
            text: `body of ${page}`,
          })),
        errors: urls
          .filter((page) => page.includes('broken'))
          .map((page) => ({ url: page, error: 'page_not_found', status: 404 })),
      });
    }
    throw new Error(`unexpected call to ${url}`);
  };
  return { impl, calls };
};

const post = (path, body, key = config.sharedKey) =>
  new Request(`http://broker.internal${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });

const appWith = (fetchImpl, overrides = {}) =>
  createApp({
    config: { ...config, ...overrides },
    cache: createCache(),
    fetchImpl,
    logger: silent,
  });

test('web search needs the shared key and never reaches TinyFish without it', async () => {
  const { impl, calls } = makeFetch();
  const response = await appWith(impl)(post('/tinyfish/tavily/search', { query: 'x' }, 'wrong'));

  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});

test('web search needs no chat identity, and the TinyFish key never leaves the broker', async () => {
  const { impl, calls } = makeFetch();
  const response = await appWith(impl)(post('/tinyfish/tavily/search', { query: 'hello world' }));

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers['X-API-Key'], 'sk-tinyfish-test');
  assert.ok(!('Authorization' in calls[0].init.headers));
  assert.ok(!(await response.text()).includes('sk-tinyfish-test'));
});

test('a Tavily search is translated to TinyFish and answered in Tavily shape', async () => {
  const { impl, calls } = makeFetch();
  const response = await appWith(impl)(
    post('/tinyfish/tavily/search', {
      query: 'election results',
      topic: 'news',
      time_range: 'week',
      country: 'united kingdom',
      max_results: 2,
      include_domains: ['bbc.co.uk', 'reuters.com'],
    }),
  );

  const params = new URL(calls[0].url).searchParams;
  assert.equal(params.get('query'), 'election results');
  assert.equal(params.get('domain_type'), 'news');
  assert.equal(params.get('recency_minutes'), '10080');
  assert.equal(params.get('location'), 'GB');
  assert.equal(params.get('include_domains'), 'bbc.co.uk,reuters.com');

  const body = await response.json();
  assert.deepEqual(body.results, [
    { title: 'One', url: 'https://one.example', content: 'first', published_date: 'May 1, 2026' },
    { title: 'Two', url: 'https://two.example', content: 'second' },
  ]);
});

test('Tavily country names map to the ISO codes TinyFish expects', () => {
  assert.equal(countryCode('united states'), 'US');
  assert.equal(countryCode('germany'), 'DE');
  assert.equal(countryCode('czech republic'), 'CZ');
  assert.equal(countryCode('bosnia and herzegovina'), 'BA');
  assert.equal(countryCode('fr'), 'FR');
  assert.equal(countryCode('atlantis'), undefined);
  assert.equal(countryCode(undefined), undefined);
});

test('a TinyFish rate limit surfaces as 429, not an outage', async () => {
  const { impl } = makeFetch({ searchStatus: 429 });
  const response = await appWith(impl)(post('/tinyfish/tavily/search', { query: 'x' }));

  assert.equal(response.status, 429);
  assert.equal((await response.json()).error.code, 'web_search_rate_limited');
});

test('without a TinyFish key the routes say so instead of calling out', async () => {
  const { impl, calls } = makeFetch();
  const response = await appWith(impl, { tinyfishApiKey: '' })(
    post('/tinyfish/tavily/search', { query: 'x' }),
  );

  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'web_search_unconfigured');
  assert.equal(calls.length, 0);
});

test('a Tavily extract batches by ten and reports per-URL failures', async () => {
  const { impl, calls } = makeFetch();
  const urls = Array.from({ length: 12 }, (_, i) => `https://site.example/${i}`);
  urls.push('https://site.example/broken', 'file:///etc/passwd');

  const response = await appWith(impl)(post('/tinyfish/tavily/extract', { urls, timeout: 20 }));
  const body = await response.json();

  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(calls[0].init.body).urls.length, 10);
  assert.equal(JSON.parse(calls[0].init.body).per_url_timeout_ms, 20000);
  assert.equal(body.results.length, 12);
  assert.equal(body.results[0].raw_content, 'body of https://site.example/0');
  assert.deepEqual(body.failed_results, [
    { url: 'https://site.example/broken', error: 'page_not_found' },
    { url: 'file:///etc/passwd', error: 'invalid_url' },
  ]);
  assert.ok(!calls.some((call) => call.init.body.includes('file://')));
});

const rpc = (message) => post('/tinyfish/mcp', message);

test('the MCP endpoint completes a handshake and lists web_fetch', async () => {
  const { impl } = makeFetch();
  const app = appWith(impl);

  const init = await (
    await app(
      rpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26' },
      }),
    )
  ).json();
  assert.equal(init.result.protocolVersion, '2025-03-26');
  assert.deepEqual(init.result.capabilities, { tools: { listChanged: false } });

  const notified = await app(rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }));
  assert.equal(notified.status, 202);

  const list = await (await app(rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }))).json();
  assert.deepEqual(
    list.result.tools.map((tool) => tool.name),
    ['web_fetch'],
  );
});

test('web_fetch returns each page as Markdown and truncates long pages', async () => {
  const { impl } = makeFetch();
  const longPage = `https://site.example/${'x'.repeat(200)}`;
  const response = await appWith(impl)(
    rpc({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'web_fetch',
        arguments: { urls: ['https://site.example/a', longPage, 'https://site.example/broken'] },
      },
    }),
  );
  const { result } = await response.json();
  const text = result.content[0].text;

  assert.equal(result.isError, false);
  assert.match(
    text,
    /# Title of https:\/\/site\.example\/a\nSource: https:\/\/site\.example\/a\n\nbody of/,
  );
  assert.match(text, /\[truncated: page is \d+ characters\]/);
  assert.match(
    text,
    /Could not fetch https:\/\/site\.example\/broken: page_not_found \(HTTP 404\)/,
  );
});

test('web_fetch refuses non-http URLs without calling TinyFish', async () => {
  const { impl, calls } = makeFetch();
  const response = await appWith(impl)(
    rpc({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'web_fetch', arguments: { urls: ['javascript:alert(1)'] } },
    }),
  );
  const { result } = await response.json();

  assert.equal(result.isError, true);
  assert.equal(calls.length, 0);
});

test('the MCP endpoint rejects GET, since it offers no server-sent stream', async () => {
  const { impl } = makeFetch();
  const response = await appWith(impl)(
    new Request('http://broker.internal/tinyfish/mcp', {
      headers: { Authorization: `Bearer ${config.sharedKey}` },
    }),
  );
  assert.equal(response.status, 405);
});

test('unknown TinyFish paths are refused rather than relayed', async () => {
  const { impl, calls } = makeFetch();
  const response = await appWith(impl)(post('/tinyfish/automation/run', {}));

  assert.equal(response.status, 404);
  assert.equal(calls.length, 0);
});
