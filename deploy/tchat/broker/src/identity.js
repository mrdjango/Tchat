import { canonicalJson, signedHeaders } from './signing.js';
import { accountDisabled, noAccount, upstreamUnavailable } from './errors.js';

const SUBJECT_PATH = '/api/internal/tchat/v1/subjects/resolve';

/**
 * Asks TensorGrid who this chat user is. `openidSub` carries the Gateway
 * subject directly once Django issues OIDC tokens; email is the fallback while
 * Tchat still uses local logins.
 */
export const resolveSubject = async ({ config, cache, fetchImpl = fetch, email, openidSub }) => {
  const cacheKey = `tchat:subject:${openidSub || email.toLowerCase()}`;
  const cached = await cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const body = canonicalJson({ email: email ?? '', openid_sub: openidSub ?? '' });
  const response = await request({
    fetchImpl,
    url: `${config.djangoBaseUrl}${SUBJECT_PATH}`,
    method: 'POST',
    body,
    headers: signedHeaders({
      secret: config.tchatSecret,
      method: 'POST',
      target: SUBJECT_PATH,
      body,
    }),
    timeoutMs: config.requestTimeoutMs,
  });

  if (response.status === 404) {
    throw noAccount();
  }
  if (!response.ok) {
    throw upstreamUnavailable(`identity lookup returned ${response.status}`);
  }

  const payload = await response.json();
  const data = payload?.data ?? {};
  if (data.status !== 'active') {
    throw accountDisabled();
  }
  await cache.set(cacheKey, data.subject_id, config.subjectCacheSeconds);
  return data.subject_id;
};

export const request = async ({ fetchImpl, url, method, body, headers, timeoutMs, signal }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    return await fetchImpl(url, {
      method,
      body: body ?? undefined,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...headers },
      signal: controller.signal,
      duplex: body ? 'half' : undefined,
    });
  } catch (error) {
    throw upstreamUnavailable(error.name === 'AbortError' ? 'request timed out' : error.message);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
};
