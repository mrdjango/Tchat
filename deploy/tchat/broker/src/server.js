import { createServer } from 'node:http';
import { Readable } from 'node:stream';

import { createApp } from './app.js';
import { createCache } from './cache.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const cache = createCache();
const app = createApp({ config, cache });

const toWebRequest = (req) => {
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(new URL(req.url, 'http://broker.internal'), {
    method: req.method,
    headers: req.headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: hasBody ? 'half' : undefined,
  });
};

const server = createServer(async (req, res) => {
  let response;
  try {
    response = await app(toWebRequest(req));
  } catch (error) {
    console.error(`tchat-broker: request failed: ${error?.stack ?? error}`);
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end('{"error":{"message":"broker failure","type":"api_error","code":"broker_failure"}}');
    return;
  }

  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (!response.body) {
    res.end();
    return;
  }
  // Piped rather than buffered: SSE token streams must reach the browser as
  // the Gateway emits them.
  Readable.fromWeb(response.body).pipe(res);
});

server.headersTimeout = 0;
server.requestTimeout = 0;
server.listen(config.port, '0.0.0.0', () => {
  console.log(`tchat-broker listening on ${config.port} → ${config.upstreamBaseUrl}`);
});

const shutdown = () => {
  server.close(async () => {
    await cache.close();
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
