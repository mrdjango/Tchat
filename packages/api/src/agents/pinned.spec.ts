import { Tools, Constants } from 'librechat-data-provider';
import type { LoadAgentDeps } from './load';
import { loadEphemeralAgent } from './load';
import { getPinnedTools } from './pinned';

const { mcp_delimiter } = Constants;
const fetchTool = `web_fetch${mcp_delimiter}web-fetch`;

const pinnedConfig = {
  webSearch: { alwaysOn: true },
  mcpConfig: {
    'web-fetch': { type: 'streamable-http', url: 'http://broker/mcp', alwaysOn: true },
    other: { type: 'streamable-http', url: 'http://other/mcp' },
  },
};

const reqWith = (config: object, ephemeralAgent?: object) =>
  ({
    user: { id: 'user-1' },
    config,
    body: { ephemeralAgent },
  }) as unknown as Parameters<typeof loadEphemeralAgent>[0]['req'];

const load = (req: ReturnType<typeof reqWith>, deps: LoadAgentDeps) =>
  loadEphemeralAgent(
    { req, endpoint: 'TensorGrid', model_parameters: { model: 'gpt-5.4' } as never },
    deps,
  );

describe('getPinnedTools', () => {
  test('reads webSearch.alwaysOn and the alwaysOn MCP servers', () => {
    expect(getPinnedTools(pinnedConfig as never)).toEqual({
      webSearch: true,
      mcpServers: ['web-fetch'],
    });
  });

  test('pins nothing when the config says nothing', () => {
    expect(getPinnedTools(undefined)).toEqual({ webSearch: false, mcpServers: [] });
    expect(getPinnedTools({ mcpConfig: null } as never)).toEqual({
      webSearch: false,
      mcpServers: [],
    });
  });
});

describe('loadEphemeralAgent with pinned tools', () => {
  const connected: LoadAgentDeps = {
    getAgent: async () => null,
    getMCPServerTools: async (_userId, serverName) =>
      serverName === 'web-fetch' ? { [fetchTool]: {} } : null,
  };

  test('equips web_search and the pinned server with every toggle off', async () => {
    const agent = await load(reqWith(pinnedConfig, { web_search: false }), connected);

    expect(agent?.tools).toEqual([Tools.web_search, fetchTool]);
  });

  test('equips nothing extra when nothing is pinned', async () => {
    const agent = await load(reqWith({}, { web_search: false }), connected);

    expect(agent?.tools).toEqual([]);
  });

  test('skips an unreachable pinned server instead of expecting its tools', async () => {
    const down: LoadAgentDeps = { getAgent: async () => null, getMCPServerTools: async () => null };
    const agent = await load(reqWith(pinnedConfig), down);

    expect(agent?.tools).toEqual([Tools.web_search]);
  });

  test('a pinned server the user also selected keeps the normal expectation', async () => {
    const down: LoadAgentDeps = { getAgent: async () => null, getMCPServerTools: async () => null };
    const agent = await load(reqWith(pinnedConfig, { mcp: ['web-fetch'] }), down);

    expect(agent?.tools).toContain(`${Constants.mcp_all}${mcp_delimiter}web-fetch`);
  });
});
