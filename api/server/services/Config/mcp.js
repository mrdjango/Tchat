const { createMCPToolCacheService, MCPServersRegistry } = require('@librechat/api');
const {
  getCachedTools,
  updateCachedGlobalTools,
  setCachedToolsWithinGlobalLock,
  getCachedAppServerTools,
  setCachedAppServerTools,
  setCachedToolsIfCurrent,
  getMCPToolsCacheGeneration,
  renewMCPToolsCacheGeneration,
  getNextAppToolsPublicationRevision,
} = require('./getCachedTools');

const {
  syncStaticTools,
  mergeAppTools,
  cacheMCPServerTools,
  updateMCPServerTools,
  getMCPServerTools,
} = createMCPToolCacheService({
  getCachedTools,
  updateCachedGlobalTools,
  setCachedTools: setCachedToolsWithinGlobalLock,
  setCachedToolsIfCurrent,
  getCachedAppServerTools,
  setCachedAppServerTools,
  getServerConfig: (serverName, userId) =>
    MCPServersRegistry.getInstance().getServerConfig(serverName, userId),
  getAllServerConfigs: () => MCPServersRegistry.getInstance().getAllServerConfigs(),
  isAppServerConfig: (serverName, effectiveConfig) =>
    MCPServersRegistry.getInstance().isAppServerConfig(serverName, effectiveConfig),
});

/** Whether a raw `mcpConfig` entry is the operator's YAML server, unmodified. */
const isUnmodifiedAppMCPServer = (serverName, rawConfig) =>
  MCPServersRegistry.getInstance().isUnmodifiedAppServer(serverName, rawConfig);

module.exports = {
  syncStaticTools,
  mergeAppTools,
  getMCPServerTools,
  cacheMCPServerTools,
  updateMCPServerTools,
  isUnmodifiedAppMCPServer,
  getMCPToolsCacheGeneration,
  renewMCPToolsCacheGeneration,
  getNextAppToolsPublicationRevision,
};
