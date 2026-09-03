import type { IUser } from '@librechat/data-schemas';

/**
 * The Tchat broker resolves the signed-in user from these headers, then trades
 * the shared ingress key it received for that user's own Gateway token. Chat
 * requests get them from the `headers:` block of the `custom` endpoint in
 * `librechat.yaml`, which agent tools never pass through, so a tool calling the
 * broker directly has to attach them itself or be refused as `identity_missing`.
 */
const originOf = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

/**
 * Header values must be latin1-encodable. A non-ASCII identifier is dropped
 * rather than thrown, leaving the remaining headers to identify the user.
 */
const headerSafe = (value?: string): string | null => {
  const trimmed = (value ?? '').trim();
  if (!trimmed || /[^\x20-\x7e]/.test(trimmed)) {
    return null;
  }
  return trimmed;
};

/**
 * Identity headers for a request the tool is about to send to `baseURL`.
 *
 * Empty unless `TCHAT_BROKER_BASE_URL` is set and `baseURL` shares its origin,
 * so a deployment pointed at a provider directly — every upstream default —
 * never sends the user's email or subject to that provider.
 */
export function brokerUserHeaders(
  req?: { user?: Partial<IUser> },
  baseURL?: string | null,
): Record<string, string> {
  const brokerOrigin = originOf(process.env.TCHAT_BROKER_BASE_URL);
  if (!brokerOrigin || originOf(baseURL) !== brokerOrigin) {
    return {};
  }

  const user = req?.user;
  if (!user) {
    return {};
  }

  const headers: Record<string, string> = {};
  const id = headerSafe(user.id);
  const email = headerSafe(user.email);
  const openidId = headerSafe(user.openidId);
  if (id) {
    headers['X-Tchat-User-Id'] = id;
  }
  if (email) {
    headers['X-Tchat-User-Email'] = email;
  }
  if (openidId) {
    headers['X-Tchat-User-Openid'] = openidId;
  }
  return headers;
}
