import { canonicalJson, signedHeaders } from './signing.js';
import { request } from './identity.js';
import { upstreamUnavailable } from './errors.js';

const base = (subject) => `/api/internal/tensorgrid/v1/users/${subject}/tokens`;

const signedCall = async ({ config, fetchImpl, method, target, payload, extraHeaders }) => {
  const body = payload === undefined ? null : canonicalJson(payload);
  const response = await request({
    fetchImpl,
    url: `${config.gatewayInternalBaseUrl}${target}`,
    method,
    body,
    headers: {
      ...signedHeaders({ secret: config.gatewaySecret, method, target, body }),
      ...extraHeaders,
    },
    timeoutMs: config.requestTimeoutMs,
  });
  if (!response.ok) {
    throw upstreamUnavailable(`gateway token API returned ${response.status}`);
  }
  const envelope = await response.json();
  if (!envelope?.success) {
    throw upstreamUnavailable(envelope?.message ?? 'gateway rejected the token request');
  }
  return envelope.data;
};

/** Gateway sends -1 or 0 for "never expires". */
const isLive = (token, nowSeconds) => {
  const expiresAt = Number(token.expires_at ?? 0);
  return expiresAt <= 0 || expiresAt > nowSeconds + 3600;
};

const findExisting = async ({ config, fetchImpl, subject }) => {
  const target = `${base(subject)}?p=1&page_size=100`;
  const data = await signedCall({ config, fetchImpl, method: 'GET', target });
  const now = Math.floor(Date.now() / 1000);
  return (data?.items ?? []).find(
    (token) => String(token.name).trim().toUpperCase() === config.tokenName && isLive(token, now),
  );
};

const reveal = ({ config, fetchImpl, subject, tokenId }) =>
  signedCall({
    config,
    fetchImpl,
    method: 'POST',
    target: `${base(subject)}/${tokenId}/reveal`,
    payload: {},
  });

const create = ({ config, fetchImpl, subject }) => {
  const expiresAt = Math.floor(Date.now() / 1000) + config.tokenLifetimeDays * 86400;
  const period = new Date().toISOString().slice(0, 7).replace('-', '');
  return signedCall({
    config,
    fetchImpl,
    method: 'POST',
    target: base(subject),
    payload: { name: config.tokenName, expires_at: expiresAt },
    // Month-scoped so a retry within the same window replays the same token,
    // but a genuinely expired token can be replaced instead of resurrected.
    extraHeaders: { 'Idempotency-Key': `tchat:${subject}:${period}` },
  });
};

/**
 * The user's own Models Gateway key, minted and held entirely server-side.
 * It is never returned to the browser and Django hides it from the user's
 * API-key list, so the only thing that can spend it is this broker.
 */
export const resolveToken = async ({ config, cache, fetchImpl = fetch, subject, forceRefresh = false }) => {
  const cacheKey = `tchat:token:${subject}`;
  if (!forceRefresh) {
    const cached = await cache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const existing = await findExisting({ config, fetchImpl, subject });
  const row = existing
    ? await reveal({ config, fetchImpl, subject, tokenId: existing.id })
    : await create({ config, fetchImpl, subject });

  const key = String(row?.key ?? '');
  if (!key || key.includes('*')) {
    throw upstreamUnavailable('gateway did not return a usable token');
  }
  await cache.set(cacheKey, key, config.tokenCacheSeconds);
  return key;
};

export const invalidateToken = ({ cache, subject }) => cache.del(`tchat:token:${subject}`);
