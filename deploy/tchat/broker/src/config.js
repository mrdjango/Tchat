const required = (name) => {
  const value = (process.env[name] ?? '').trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const optional = (name, fallback) => (process.env[name] ?? '').trim() || fallback;

const trimSlash = (value) => value.replace(/\/+$/, '');

export const loadConfig = () => ({
  port: Number(optional('TCHAT_BROKER_PORT', '8081')),
  sharedKey: required('TCHAT_BROKER_SHARED_KEY'),
  /** Signs calls to TensorGrid's /api/internal/tchat/v1/ endpoints. */
  tchatSecret: required('TCHAT_INTEGRATION_SECRET'),
  /** Signs calls to the Gateway's /api/internal/tensorgrid/v1/ endpoints. */
  gatewaySecret: required('TENSORGRID_INTEGRATION_SECRET'),
  djangoBaseUrl: trimSlash(required('DJANGO_INTERNAL_BASE_URL')),
  gatewayInternalBaseUrl: trimSlash(required('MODELS_GATEWAY_INTERNAL_BASE_URL')),
  /** Inference origin the relay forwards to. Compose points this at the
   *  Gateway container; the public origin works but hairpins through
   *  Cloudflare, which cuts a request off at ~125s. */
  upstreamBaseUrl: trimSlash(optional('TENSORGRID_API_BASE_URL', 'https://api.tensorgrid.space')),
  /** Name of the Gateway token this broker owns. Django hides it from the
   *  user's API-key list, so it must match RESERVED_TOKEN_NAMES there. */
  tokenName: optional('TCHAT_BROKER_TOKEN_NAME', 'TCHAT'),
  tokenLifetimeDays: Number(optional('TCHAT_BROKER_TOKEN_LIFETIME_DAYS', '30')),
  subjectCacheSeconds: Number(optional('TCHAT_BROKER_SUBJECT_CACHE_SECONDS', '900')),
  tokenCacheSeconds: Number(optional('TCHAT_BROKER_TOKEN_CACHE_SECONDS', '3600')),
  requestTimeoutMs: Number(optional('TCHAT_BROKER_REQUEST_TIMEOUT_MS', '15000')),
});
