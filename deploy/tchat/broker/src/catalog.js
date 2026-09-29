import { BrokerError, upstreamUnavailable } from './errors.js';

/** Tchat-only reads of TensorGrid's public model catalog. Nothing here bills. */
export const CATALOG_PREFIX = '/tchat/catalog/';

const FREE_MODELS_PATH = '/tchat/catalog/free-models';
const CACHE_KEY = 'catalog:free-models';

const isZero = (value) => typeof value === 'number' && value === 0;

/**
 * A model is free only when every price TensorGrid lists for it is zero,
 * extra meters (per request, per image, audio) included. A model with no
 * pricing block is unknown, not free.
 */
export const isFreePricing = (pricing) => {
  if (!pricing || typeof pricing !== 'object') {
    return false;
  }
  for (const [name, value] of Object.entries(pricing)) {
    if (name === 'extra_meters') {
      if (value == null) {
        continue;
      }
      if (typeof value !== 'object' || !Object.values(value).every(isZero)) {
        return false;
      }
      continue;
    }
    if (typeof value === 'number' && value !== 0) {
      return false;
    }
  }
  return true;
};

const jsonResponse = (body) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const createCatalog = ({ config, cache, fetchImpl = fetch }) => {
  /** Survives cache expiry, so a TensorGrid outage keeps the last known list. */
  let lastGood = null;

  const load = async () => {
    const response = await fetchImpl(`${config.djangoBaseUrl}/api/model-hub/catalog/`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });
    if (!response.ok) {
      throw new Error(`catalog answered ${response.status}`);
    }
    const body = await response.json();
    const models = Array.isArray(body?.results) ? body.results : [];
    return {
      revision: typeof body?.revision === 'string' ? body.revision : '',
      free: models
        .filter((model) => typeof model?.id === 'string' && isFreePricing(model.pricing))
        .map((model) => model.id)
        .sort(),
    };
  };

  return async (request, url) => {
    if (url.pathname !== FREE_MODELS_PATH || request.method !== 'GET') {
      throw new BrokerError({
        status: 404,
        code: 'unsupported_path',
        message: `The TensorGrid broker does not serve ${url.pathname}.`,
      });
    }

    const cached = await cache.get(CACHE_KEY);
    if (cached) {
      return jsonResponse(cached);
    }
    try {
      const fresh = await load();
      lastGood = fresh;
      await cache.set(CACHE_KEY, fresh, config.catalogCacheSeconds);
      return jsonResponse(fresh);
    } catch (error) {
      if (lastGood) {
        return jsonResponse(lastGood);
      }
      throw upstreamUnavailable(`model catalog: ${error?.message ?? error}`);
    }
  };
};
