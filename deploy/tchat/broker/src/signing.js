import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The TensorGrid internal-service signature, shared by Django and Models Gateway.
 * Canonical string: `${timestamp}\n${METHOD}\n${path}?${query}\n${sha256hex(body)}`.
 * The body must be the exact bytes sent, so callers serialize once and pass both.
 */
export const signedHeaders = ({ secret, method, target, body }) => {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const digest = createHash('sha256').update(body ?? Buffer.alloc(0)).digest('hex');
  const canonical = `${timestamp}\n${method.toUpperCase()}\n${target}\n${digest}`;
  const signature = createHmac('sha256', secret).update(canonical).digest('hex');
  return {
    'X-TensorGrid-Timestamp': timestamp,
    'X-TensorGrid-Signature': `sha256=${signature}`,
  };
};

/**
 * Matches Python's `json.dumps(payload, separators=(',', ':'), sort_keys=True)`
 * byte for byte, including its default `ensure_ascii=True` escaping — the digest
 * is over these exact bytes, so a stray UTF-8 character would break the signature.
 */
export const canonicalJson = (payload) =>
  Buffer.from(
    JSON.stringify(sortKeys(payload)).replace(/[\u007f-\uffff]/g, (char) =>
      `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
    ),
    'utf8',
  );

const sortKeys = (value) => {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys(value[key])]),
  );
};

export const secretsMatch = (provided, expected) => {
  const a = Buffer.from(provided ?? '');
  const b = Buffer.from(expected ?? '');
  if (a.length !== b.length || a.length === 0) {
    return false;
  }
  return timingSafeEqual(a, b);
};
