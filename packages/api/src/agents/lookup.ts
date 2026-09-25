import { logger } from '@librechat/data-schemas';
import type { MCPOptions, ParsedServerConfig } from '~/mcp/types';
import { requiresEphemeralUserConnection, validateMCPServerConfig } from '~/mcp/utils';

/** Whether a raw `mcpConfig` entry is just the operator's YAML server, unmodified. */
export type IsUnmodifiedAppMCPServer = (
  serverName: string,
  rawConfig: MCPOptions,
) => Promise<boolean>;

export interface MCPToolsLookup {
  /** The server needs a per-request connection; expand it through `mcp_all`. */
  requestScoped: boolean;
  /** The config to address the durable catalog by; undefined resolves via the registry. */
  serverConfig?: ParsedServerConfig;
}

/**
 * Picks the config a chat loader hands `getMCPServerTools` for one server.
 *
 * The app catalog is published under a generation hashed from the registry's
 * inspected config, which carries inspector-derived fields (`requiresOAuth`,
 * ...) that the raw `appConfig.mcpConfig` entry lacks. Hashing the raw entry
 * for an unmodified YAML server therefore always misses, so for those the
 * lookup resolves through the registry, as the startup publisher did. A real
 * overlay (an admin override that differs from YAML) is still addressed by
 * the overlay itself, and a request-scoped one still expands fresh.
 */
export async function getMCPToolsLookup(
  serverName: string,
  rawConfig: unknown,
  isUnmodifiedAppServer?: IsUnmodifiedAppMCPServer,
): Promise<MCPToolsLookup> {
  if (!rawConfig) {
    return { requestScoped: false };
  }
  const overlayConfig = validateMCPServerConfig(rawConfig);
  if (requiresEphemeralUserConnection(overlayConfig)) {
    return { requestScoped: true };
  }
  if (isUnmodifiedAppServer) {
    try {
      if (await isUnmodifiedAppServer(serverName, overlayConfig)) {
        return { requestScoped: false };
      }
    } catch {
      logger.warn('[MCP] Could not compare a server with its app config; using the request entry');
    }
  }
  return { requestScoped: false, serverConfig: overlayConfig };
}
