import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { test } from 'node:test';

import { canonicalJson, signedHeaders } from './signing.js';
import { createCache } from './cache.js';
import { createApp } from './app.js';

const SUBJECT = '11111111-2222-3333-4444-555555555555';

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
};

const silent = { error() {}, log() {} };

const jsonOk = (body) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

/** Stands in for Django + Gateway + the public inference API. */
const makeFetch = (overrides = {}) => {
  const calls = [];
  const state = {
    tokens: overrides.tokens ?? [],
    upstreamStatuses: overrides.upstreamStatuses ?? [200],
  };
  const impl = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });

    if (url.endsWith('/api/internal/tchat/v1/subjects/resolve')) {
      if (overrides.subjectStatus === 404) {
        return new Response(JSON.stringify({ success: false, code: 'account_not_found' }), {
          status: 404,
        });
      }
      return jsonOk({
        success: true,
        data: { subject_id: SUBJECT, status: overrides.subjectStatus ?? 'active' },
      });
    }
    if (url.includes('/tokens?')) {
      return jsonOk({ success: true, data: { total: state.tokens.length, items: state.tokens } });
    }
    if (url.endsWith('/reveal')) {
      return jsonOk({
        success: true,
        data: { id: '43', name: 'TCHAT', key: 'sk-revealed-user-token' },
      });
    }
    if (url.endsWith(`/users/${SUBJECT}/tokens`)) {
      return jsonOk({
        success: true,
        created: true,
        data: { id: '44', name: 'TCHAT', key: 'sk-minted-user-token' },
      });
    }
    const status = state.upstreamStatuses.shift() ?? 200;
    return new Response(JSON.stringify({ ok: status === 200 }), { status });
  };
  return { impl, calls };
};

const chatRequest = (headers = {}) =>
  new Request('http://broker.internal/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.sharedKey}`,
      'X-Tchat-User-Email': 'chat-user@example.com',
      'X-Tchat-User-Id': 'lc-user-1',
      ...headers,
    },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages: [] }),
  });

test('a request without the shared key never reaches TensorGrid', async () => {
  const { impl, calls } = makeFetch();
  const app = createApp({ config, cache: createCache(), fetchImpl: impl, logger: silent });

  const response = await app(chatRequest({ Authorization: 'Bearer wrong-key' }));

  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, 'broker_unauthorized');
  assert.equal(calls.length, 0);
});

test('the Anthropic x-api-key header authenticates the same as a bearer token', async () => {
  const { impl } = makeFetch();
  const app = createApp({ config, cache: createCache(), fetchImpl: impl, logger: silent });

  const request = new Request('http://broker.internal/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': config.sharedKey,
      'X-Tchat-User-Email': 'chat-user@example.com',
    },
    body: '{}',
  });

  assert.equal((await app(request)).status, 200);
});

test('a chat session with no TensorGrid identity is refused', async () => {
  const { impl, calls } = makeFetch();
  const app = createApp({ config, cache: createCache(), fetchImpl: impl, logger: silent });

  const response = await app(chatRequest({ 'X-Tchat-User-Email': '', 'X-Tchat-User-Openid': '' }));

  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, 'identity_missing');
  assert.equal(calls.length, 0);
});

test('a chat user with no TensorGrid account gets an actionable error, not a 500', async () => {
  const { impl } = makeFetch({ subjectStatus: 404 });
  const app = createApp({ config, cache: createCache(), fetchImpl: impl, logger: silent });

  const response = await app(chatRequest());

  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.code, 'tensorgrid_account_required');
  assert.match(body.error.message, /tensorgrid\.space/);
});

test('the subject-resolve call is signed exactly the way Django verifies it', async () => {
  const { impl, calls } = makeFetch();
  const app = createApp({ config, cache: createCache(), fetchImpl: impl, logger: silent });

  await app(chatRequest());

  const call = calls.find((entry) => entry.url.endsWith('/subjects/resolve'));
  const body = call.init.body;
  const timestamp = call.init.headers['X-TensorGrid-Timestamp'];
  const path = '/api/internal/tchat/v1/subjects/resolve';
  const canonical = `${timestamp}\nPOST\n${path}\n${createHash('sha256').update(body).digest('hex')}`;
  const expected = createHmac('sha256', config.tchatSecret).update(canonical).digest('hex');

  assert.equal(call.init.headers['X-TensorGrid-Signature'], `sha256=${expected}`);
  assert.equal(body.toString(), '{"email":"chat-user@example.com","openid_sub":""}');
});

test('an existing live token is revealed instead of minting a duplicate', async () => {
  const { impl, calls } = makeFetch({
    tokens: [
      { id: '42', name: 'Production', key: 'sk-abc***', expires_at: -1 },
      { id: '43', name: 'TCHAT', key: 'sk-tch***', expires_at: -1 },
    ],
  });
  const app = createApp({ config, cache: createCache(), fetchImpl: impl, logger: silent });

  await app(chatRequest());

  assert.ok(calls.some((entry) => entry.url.endsWith('/tokens/43/reveal')));
  assert.ok(!calls.some((entry) => entry.init.headers?.['Idempotency-Key']));
});

test('an expiring token is replaced rather than reused', async () => {
  const nearlyExpired = Math.floor(Date.now() / 1000) + 60;
  const { impl, calls } = makeFetch({
    tokens: [{ id: '43', name: 'TCHAT', key: 'sk-tch***', expires_at: nearlyExpired }],
  });
  const app = createApp({ config, cache: createCache(), fetchImpl: impl, logger: silent });

  await app(chatRequest());

  const mint = calls.find((entry) => entry.init.headers?.['Idempotency-Key']);
  assert.ok(mint, 'expected a fresh token to be minted');
  assert.match(mint.init.headers['Idempotency-Key'], new RegExp(`^tchat:${SUBJECT}:\\d{6}$`));
});

test('the resolved token is cached across requests', async () => {
  const cache = createCache();
  const { impl, calls } = makeFetch();
  const app = createApp({ config, cache, fetchImpl: impl, logger: silent });

  await app(chatRequest());
  const afterFirst = calls.length;
  await app(chatRequest());

  const secondRoundTrips = calls
    .slice(afterFirst)
    .filter((entry) => !entry.url.includes('api.tensorgrid.space'));
  assert.deepEqual(secondRoundTrips, []);
});

test('a 401 from the gateway refreshes the token once and retries', async () => {
  const cache = createCache();
  const { impl, calls } = makeFetch({ upstreamStatuses: [401, 200] });
  const app = createApp({ config, cache, fetchImpl: impl, logger: silent });

  const response = await app(chatRequest());

  assert.equal(response.status, 200);
  const upstreamCalls = calls.filter((entry) =>
    entry.url.startsWith('https://api.tensorgrid.space'),
  );
  assert.equal(upstreamCalls.length, 2);
});

test('the user token replaces the shared key and no identity headers leak upstream', async () => {
  const { impl, calls } = makeFetch();
  const app = createApp({ config, cache: createCache(), fetchImpl: impl, logger: silent });

  await app(chatRequest({ 'X-Tchat-User-Openid': SUBJECT }));

  const upstream = calls.find((entry) => entry.url.startsWith('https://api.tensorgrid.space'));
  assert.equal(upstream.init.headers.get('authorization'), 'Bearer sk-minted-user-token');
  assert.equal(upstream.init.headers.get('x-api-key'), null);
  assert.equal(upstream.init.headers.get('x-tchat-user-email'), null);
  assert.equal(upstream.init.headers.get('x-tchat-user-openid'), null);
  assert.equal(upstream.init.headers.get('x-tchat-user-id'), null);
});

test('the broker refuses to relay paths outside the inference surface', async () => {
  const { impl, calls } = makeFetch();
  const app = createApp({ config, cache: createCache(), fetchImpl: impl, logger: silent });

  const response = await app(
    new Request('http://broker.internal/api/internal/tensorgrid/v1/catalog', {
      method: 'GET',
      headers: { Authorization: `Bearer ${config.sharedKey}`, 'X-Tchat-User-Email': 'a@b.c' },
    }),
  );

  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, 'unsupported_path');
  assert.equal(calls.length, 0);
});

test("image generation relays on the signed-in user's own Gateway token", async () => {
  const { impl, calls } = makeFetch({ tokens: [{ id: '43', name: 'TCHAT' }] });
  const app = createApp({ config, cache: createCache(), fetchImpl: impl, logger: silent });

  const response = await app(
    new Request('http://broker.internal/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.sharedKey}`,
        'X-Tchat-User-Email': 'chat-user@example.com',
      },
      body: JSON.stringify({ model: 'gpt-image-1', prompt: 'a teal grid' }),
    }),
  );

  assert.equal(response.status, 200);
  const upstream = calls.at(-1);
  assert.equal(upstream.url, 'https://api.tensorgrid.space/v1/images/generations');
  // The shared ingress key never leaves the broker; the user's token pays.
  assert.equal(upstream.init.headers.get('authorization'), 'Bearer sk-revealed-user-token');
  assert.equal(JSON.parse(upstream.init.body).prompt, 'a teal grid');
});

test('image edits keep the multipart body and its boundary intact', async () => {
  const { impl, calls } = makeFetch({ tokens: [{ id: '43', name: 'TCHAT' }] });
  const app = createApp({ config, cache: createCache(), fetchImpl: impl, logger: silent });

  const boundary = '----tchatBoundary123';
  const body =
    `--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n` +
    `make it teal\r\n--${boundary}--\r\n`;
  const response = await app(
    new Request('http://broker.internal/v1/images/edits', {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        Authorization: `Bearer ${config.sharedKey}`,
        'X-Tchat-User-Email': 'chat-user@example.com',
      },
      body,
    }),
  );

  assert.equal(response.status, 200);
  const upstream = calls.at(-1);
  assert.equal(upstream.url, 'https://api.tensorgrid.space/v1/images/edits');
  // A rewritten boundary makes the upload unparseable at the Gateway.
  assert.equal(
    upstream.init.headers.get('content-type'),
    `multipart/form-data; boundary=${boundary}`,
  );
  assert.equal(Buffer.from(upstream.init.body).toString('utf8'), body);
});

test('an image request without an identity header is refused before any relay', async () => {
  const { impl, calls } = makeFetch();
  const app = createApp({ config, cache: createCache(), fetchImpl: impl, logger: silent });

  const response = await app(
    new Request('http://broker.internal/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.sharedKey}` },
      body: JSON.stringify({ prompt: 'anonymous' }),
    }),
  );

  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, 'identity_missing');
  assert.equal(calls.length, 0);
});

test("Gemini's native path relays on the user's own Gateway token", async () => {
  const { impl, calls } = makeFetch({ tokens: [{ id: '43', name: 'TCHAT' }] });
  const app = createApp({ config, cache: createCache(), fetchImpl: impl, logger: silent });

  const response = await app(
    new Request('http://broker.internal/v1beta/models/gemini-3-pro-image-c:generateContent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.sharedKey}`,
        // The Google SDK sends the key here too; it must not reach upstream.
        'x-goog-api-key': config.sharedKey,
        'X-Tchat-User-Email': 'chat-user@example.com',
      },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'a teal grid' }] }] }),
    }),
  );

  assert.equal(response.status, 200);
  const upstream = calls.at(-1);
  assert.equal(
    upstream.url,
    'https://api.tensorgrid.space/v1beta/models/gemini-3-pro-image-c:generateContent',
  );
  assert.equal(upstream.init.headers.get('authorization'), 'Bearer sk-revealed-user-token');
  assert.equal(upstream.init.headers.get('x-goog-api-key'), null);
});

test('healthz needs no credentials and matches the stack-wide convention', async () => {
  const app = createApp({
    config,
    cache: createCache(),
    fetchImpl: makeFetch().impl,
    logger: silent,
  });

  const response = await app(new Request('http://broker.internal/healthz'));

  assert.equal(response.status, 200);
  // Exact lowercase match: the Compose healthcheck greps `grep -qx ok`, and a
  // silent case mismatch here is exactly what shipped broken to production.
  assert.equal(await response.text(), 'ok');
});

test('canonical JSON matches the Python serialization Django hashes', () => {
  assert.equal(
    canonicalJson({ b: 1, a: 'x', nested: { z: 1, y: 2 } }).toString(),
    '{"a":"x","b":1,"nested":{"y":2,"z":1}}',
  );
  assert.equal(
    canonicalJson({ email: 'zoë@example.com' }).toString(),
    '{"email":"zo\\u00eb@example.com"}',
  );
});

test('signed headers carry a fresh timestamp and the sha256= prefix', () => {
  const headers = signedHeaders({
    secret: config.tchatSecret,
    method: 'post',
    target: '/x',
    body: null,
  });

  assert.match(headers['X-TensorGrid-Signature'], /^sha256=[0-9a-f]{64}$/);
  assert.ok(Math.abs(Date.now() / 1000 - Number(headers['X-TensorGrid-Timestamp'])) < 5);
});
