import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isFreePricing } from './catalog.js';
import { createCache } from './cache.js';
import { createApp } from './app.js';

const config = {
  sharedKey: 'broker-shared-key-value',
  djangoBaseUrl: 'http://backend:8000',
  upstreamBaseUrl: 'https://api.tensorgrid.space',
  requestTimeoutMs: 5000,
  catalogCacheSeconds: 300,
};

const silent = { error() {}, log() {} };

/** Shaped like TensorGrid's /api/model-hub/catalog/ response. */
const catalogBody = {
  status: 'ready',
  revision: 'rev-1',
  results: [
    {
      id: 'Qwen3.8-27B',
      pricing: { input_per_million_microusd: 0, output_per_million_microusd: 0, extra_meters: {} },
    },
    {
      id: 'gpt-5.6-terra',
      pricing: { input_per_million_microusd: 1250000, output_per_million_microusd: 10000000 },
    },
    {
      id: 'gemini-3-pro-image-c',
      pricing: {
        input_per_million_microusd: 0,
        output_per_million_microusd: 0,
        extra_meters: { request: 40500 },
      },
    },
    { id: 'minimaxai/minimax-m3', pricing: { input_per_million_microusd: 0 } },
    { id: 'no-pricing-model' },
  ],
};

const makeFetch = (responses) => {
  const calls = [];
  const impl = async (input) => {
    calls.push(String(input));
    const next = responses.shift();
    if (next instanceof Error) {
      throw next;
    }
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  };
  return { impl, calls };
};

const get = (path, key = config.sharedKey) =>
  new Request(`http://broker.internal${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });

test('isFreePricing needs every listed price, extra meters included, to be zero', () => {
  assert.equal(
    isFreePricing({ input_per_million_microusd: 0, output_per_million_microusd: 0 }),
    true,
  );
  assert.equal(
    isFreePricing({ input_per_million_microusd: 0, extra_meters: { request: 1 } }),
    false,
  );
  assert.equal(
    isFreePricing({ input_per_million_microusd: 0, cache_read_per_million_microusd: 5 }),
    false,
  );
  assert.equal(isFreePricing(undefined), false);
  assert.equal(isFreePricing(null), false);
});

test('free-models lists only zero-priced models from the catalog', async () => {
  const fetch = makeFetch([{ body: catalogBody }]);
  const app = createApp({ config, cache: createCache(), fetchImpl: fetch.impl, logger: silent });

  const response = await app(get('/tchat/catalog/free-models'));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    revision: 'rev-1',
    free: ['Qwen3.8-27B', 'minimaxai/minimax-m3'],
  });
  assert.deepEqual(fetch.calls, ['http://backend:8000/api/model-hub/catalog/']);
});

test('free-models needs the shared key but no user identity', async () => {
  const fetch = makeFetch([{ body: catalogBody }]);
  const app = createApp({ config, cache: createCache(), fetchImpl: fetch.impl, logger: silent });

  const refused = await app(get('/tchat/catalog/free-models', 'wrong-key'));
  assert.equal(refused.status, 401);
  assert.equal(fetch.calls.length, 0);
});

test('free-models reuses the cached list within its TTL', async () => {
  const fetch = makeFetch([{ body: catalogBody }]);
  const app = createApp({ config, cache: createCache(), fetchImpl: fetch.impl, logger: silent });

  await app(get('/tchat/catalog/free-models'));
  const second = await app(get('/tchat/catalog/free-models'));

  assert.equal(second.status, 200);
  assert.equal(fetch.calls.length, 1);
});

test('free-models keeps serving the last good list when TensorGrid fails', async () => {
  const cache = createCache();
  const fetch = makeFetch([{ body: catalogBody }, { status: 502, body: {} }]);
  const app = createApp({ config, cache, fetchImpl: fetch.impl, logger: silent });

  await app(get('/tchat/catalog/free-models'));
  await cache.del('catalog:free-models');
  const stale = await app(get('/tchat/catalog/free-models'));

  assert.equal(stale.status, 200);
  assert.deepEqual((await stale.json()).free, ['Qwen3.8-27B', 'minimaxai/minimax-m3']);
});

test('free-models answers 503 when TensorGrid has never answered', async () => {
  const fetch = makeFetch([new Error('connect ECONNREFUSED')]);
  const app = createApp({ config, cache: createCache(), fetchImpl: fetch.impl, logger: silent });

  const response = await app(get('/tchat/catalog/free-models'));

  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'tensorgrid_unavailable');
});

test('other catalog paths are refused', async () => {
  const fetch = makeFetch([]);
  const app = createApp({ config, cache: createCache(), fetchImpl: fetch.impl, logger: silent });

  const response = await app(get('/tchat/catalog/everything'));

  assert.equal(response.status, 404);
  assert.equal(fetch.calls.length, 0);
});
