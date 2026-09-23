import type { AppConfig } from '@librechat/data-schemas';

export interface PinnedTools {
  /** `webSearch.alwaysOn`: equip `web_search` whatever the chat's toggle says. */
  webSearch: boolean;
  /** Servers flagged `alwaysOn` in `mcpServers`, equipped on every chat. */
  mcpServers: string[];
}

/**
 * Tools the operator equips on every ephemeral chat, independent of the user's
 * own selections. Pinned MCP servers are best-effort: a loader skips one whose
 * tools cannot be resolved, so an outage there costs the tool, not the chat.
 */
export function getPinnedTools(
  appConfig?: Pick<AppConfig, 'webSearch' | 'mcpConfig'>,
): PinnedTools {
  const mcpServers = Object.entries(appConfig?.mcpConfig ?? {})
    .filter(([, server]) => server?.alwaysOn === true)
    .map(([name]) => name);
  return { webSearch: appConfig?.webSearch?.alwaysOn === true, mcpServers };
}
