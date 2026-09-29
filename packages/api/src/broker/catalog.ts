import { logger } from '@librechat/data-schemas';

/**
 * Model ids TensorGrid prices at zero, for the model picker's "Free" tag.
 *
 * Read from the Tchat broker, which alone can reach TensorGrid's backend; the
 * broker caches the catalog, and this process holds the answer for a minute so
 * a page load never waits on it. Any failure yields an empty list: a missing
 * tag is harmless, a wrong one is not.
 */
const TTL_MS = 60_000;
const TIMEOUT_MS = 5_000;

let cached: { free: string[]; expiresAt: number } | null = null;

export async function getTchatFreeModels(fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const origin = (process.env.TCHAT_BROKER_ORIGIN ?? '').trim().replace(/\/+$/, '');
  const key = (process.env.TCHAT_BROKER_SHARED_KEY ?? '').trim();
  if (!origin || !key) {
    return [];
  }
  if (cached && cached.expiresAt > Date.now()) {
    return cached.free;
  }
  try {
    const response = await fetchImpl(`${origin}/tchat/catalog/free-models`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`broker answered ${response.status}`);
    }
    const body = (await response.json()) as { free?: unknown };
    const free = Array.isArray(body.free)
      ? body.free.filter((id): id is string => typeof id === 'string')
      : [];
    cached = { free, expiresAt: Date.now() + TTL_MS };
    return free;
  } catch (error) {
    logger.warn(`[tchat] free-model list unavailable: ${(error as Error)?.message ?? error}`);
    return cached?.free ?? [];
  }
}

/** Test seam: forget the cached list. */
export function resetTchatFreeModelsCache(): void {
  cached = null;
}
