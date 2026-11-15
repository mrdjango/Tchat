import { logger } from '@librechat/data-schemas';
import {
  Tools,
  Constants,
  isAgentsEndpoint,
  isEphemeralAgentId,
  getEphemeralSender,
  appendAgentIdSuffix,
  resolveSpecArtifacts,
  encodeEphemeralAgentId,
  resolveMCPAppsPolicy,
  resolveSpecUserToggles,
  resolveSpecSkillsEnabled,
} from 'librechat-data-provider';
import type {
  Agent,
  TModelSpec,
  TImageSpec,
  TConversation,
  TEphemeralAgent,
} from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { MCPClientCapabilityProfile } from '~/mcp/capabilities';
import type { IsUnmodifiedAppMCPServer } from '~/agents/lookup';
import type { ParsedServerConfig } from '~/mcp/types';
import {
  resolveEphemeralTools,
  resolveEphemeralMCPServers,
  synthesizeToggleToolOptions,
} from '~/agents/toggles';
import { resolveMCPClientCapabilityProfile } from '~/mcp/capabilities';
import { getLookupConcurrency } from '~/utils/concurrency';
import { getCustomEndpointConfig } from '~/app/config';
import { mapWithConcurrency } from '~/utils/promise';
import { getMCPToolsLookup } from '~/agents/lookup';
import { resolveImageSpec } from '~/images/specs';
import { getPinnedTools } from '~/agents/pinned';

const { mcp_all, mcp_delimiter } = Constants;

export const ADDED_AGENT_ID = 'added_agent';

function applyModelSpecSkills(
  result: Record<string, unknown>,
  modelSpec: Pick<TModelSpec, 'skills'> | null | undefined,
  ephemeralSkills: boolean | undefined,
): void {
  if (!modelSpec || !Object.prototype.hasOwnProperty.call(modelSpec, 'skills')) {
    /** With no spec default to resolve against there is still a decision to
     *  record: the run-level `ephemeralSkillsToggle` this pane would otherwise
     *  fall back to belongs to the PRIMARY request, so leaving `skills_enabled`
     *  unset lets the other pane's badge scope this one. */
    if (typeof ephemeralSkills === 'boolean') {
      result.skills_enabled = ephemeralSkills;
      if (!ephemeralSkills) {
        result.skills = [];
      }
    }
    return;
  }
  const skillsEnabled = resolveSpecSkillsEnabled(ephemeralSkills, modelSpec.skills);
  result.skills_enabled = skillsEnabled;
  if (!skillsEnabled || Array.isArray(modelSpec.skills)) {
    result.skills = [];
    return;
  }
  delete result.skills;
}

function applyModelSpecSubagents(
  result: Record<string, unknown>,
  modelSpec: Pick<TModelSpec, 'subagents'> | null | undefined,
): void {
  if (modelSpec?.subagents) {
    result.subagents = modelSpec.subagents;
  }
}

export interface LoadAddedAgentDeps {
  /** Resolves the agent without its `versions` history; `version` carries the count. */
  getAgent: (searchParameter: {
    id: string;
  }) => Promise<(Agent & { version?: number; versions?: { length: number } }) | null>;
  getMCPServerTools: (
    userId: string,
    serverName: string,
    serverConfig?: ParsedServerConfig,
    capabilityProfile?: MCPClientCapabilityProfile,
  ) => Promise<Record<string, unknown> | null>;
  /** The MCP servers this user can reach, with the registry's tier precedence
   *  already applied — the resolution behind the client's catalog. Omitted, the
   *  chat selection is used as sent. */
  getAccessibleMCPServers?: (
    userId: string,
    role?: string,
  ) => Promise<Record<string, ParsedServerConfig>>;
  /** Tells an unmodified YAML server's raw `mcpConfig` entry apart from a real
   *  overlay, so its catalog is looked up by the registry config it was
   *  published under. Omitted, every entry is treated as an overlay. */
  isUnmodifiedAppMCPServer?: IsUnmodifiedAppMCPServer;
}

interface LoadAddedAgentParams {
  req: {
    user?: { id?: string; role?: string };
    config?: Record<string, unknown>;
    body?: { ephemeralAgent?: TEphemeralAgent };
  };
  conversation: TConversation | null;
  primaryAgent?: Agent | null;
}

/**
 * Loads an agent from an added conversation (for multi-convo parallel agent execution).
 * Returns the agent config as a plain object, or null if invalid.
 */
export async function loadAddedAgent(
  { req, conversation, primaryAgent }: LoadAddedAgentParams,
  deps: LoadAddedAgentDeps,
): Promise<Agent | null> {
  if (!conversation) {
    return null;
  }

  if (conversation.agent_id && !isEphemeralAgentId(conversation.agent_id)) {
    const reqRecord = req as Record<string, unknown>;
    let agent = reqRecord.resolvedAddedAgent as Agent | null | undefined;
    if (!agent) {
      agent = await deps.getAgent({ id: conversation.agent_id });
    }
    if (!agent) {
      logger.warn(`[loadAddedAgent] Agent ${conversation.agent_id} not found`);
      return null;
    }

    const agentRecord = agent as Agent & { version?: number; versions?: { length: number } };
    agentRecord.version ??= agentRecord.versions?.length ?? 0;
    agent.id = appendAgentIdSuffix(agent.id, 1);
    return agent;
  }

  const { model, endpoint, promptPrefix, spec, ...rest } = conversation as TConversation & {
    promptPrefix?: string;
    spec?: string;
    modelLabel?: string;
    ephemeralAgent?: TEphemeralAgent;
    [key: string]: unknown;
  };

  if (!endpoint || !model) {
    logger.warn('[loadAddedAgent] Missing required endpoint or model for ephemeral agent');
    return null;
  }

  const appConfig = req.config as AppConfig | undefined;
  const capabilityProfile = resolveMCPClientCapabilityProfile(
    resolveMCPAppsPolicy(appConfig?.mcpSettings?.apps),
  );
  const modelSpecs = (appConfig?.modelSpecs as { list?: TModelSpec[] })?.list;
  const modelSpec: TModelSpec | null =
    spec != null && spec !== '' ? (modelSpecs?.find((s) => s.name === spec) ?? null) : null;

  /** An added pane carries no toggles of its own — one badge row is shared by
   *  both panes and submits a single `ephemeralAgent` — so the request's state
   *  stands in, field by field, for whatever the pane leaves unset. Merged
   *  rather than substituted so a pane that does carry a partial object still
   *  inherits the toggles it omits.
   *
   *  A pane whose spec gives the user no control over its tools is exempt:
   *  those toggles were never offered for it, so the other pane's choices must
   *  not silently strip the capabilities its spec configured. */
  const requestAgent = resolveSpecUserToggles(req.body?.ephemeralAgent, modelSpec);
  const paneAgent = resolveSpecUserToggles(rest.ephemeralAgent, modelSpec);
  const ephemeralAgent: TEphemeralAgent | undefined =
    requestAgent || paneAgent ? { ...requestAgent, ...paneAgent } : undefined;

  const primaryIsEphemeral = primaryAgent && isEphemeralAgentId(primaryAgent.id);
  if (primaryIsEphemeral && Array.isArray(primaryAgent.tools)) {
    let endpointConfig = (appConfig?.endpoints as Record<string, unknown> | undefined)?.[
      endpoint
    ] as Record<string, unknown> | undefined;
    if (!isAgentsEndpoint(endpoint) && !endpointConfig) {
      try {
        endpointConfig = getCustomEndpointConfig({ endpoint, appConfig }) as
          | Record<string, unknown>
          | undefined;
      } catch (err) {
        logger.error('[loadAddedAgent] Error getting custom endpoint config', err);
      }
    }

    const sender = getEphemeralSender({
      modelLabel: rest.modelLabel,
      specLabel: modelSpec?.label,
      modelDisplayLabel: endpointConfig?.modelDisplayLabel as string | undefined,
    });
    const ephemeralId = encodeEphemeralAgentId({ endpoint, model, sender, index: 1 });

    const result: Record<string, unknown> = {
      id: ephemeralId,
      instructions: promptPrefix || '',
      provider: endpoint,
      model_parameters: {},
      model,
      tools: [...primaryAgent.tools],
    };
    applyModelSpecSkills(result, modelSpec, ephemeralAgent?.skills);
    applyModelSpecSubagents(result, modelSpec);
    const mirroredArtifacts = resolveSpecArtifacts(ephemeralAgent?.artifacts, modelSpec?.artifacts);
    if (mirroredArtifacts != null) {
      result.artifacts = mirroredArtifacts;
    }
    const primaryToggleToolOptions = synthesizeToggleToolOptions({ ephemeralAgent, modelSpec });
    if (primaryToggleToolOptions) {
      result.tool_options = primaryToggleToolOptions;
    }
    return result as unknown as Agent;
  }

  const userId = req.user?.id ?? '';
  const mcpServers = new Set<string>(
    await resolveEphemeralMCPServers({
      selected: ephemeralAgent?.mcp,
      specServers: modelSpec?.mcpServers,
      userId,
      role: req.user?.role,
      getAccessibleMCPServers: deps.getAccessibleMCPServers,
    }),
  );

  const pinned = getPinnedTools(appConfig);
  /** Pinned servers nobody selected are best-effort; see `getPinnedTools`. */
  const optionalServers = new Set(pinned.mcpServers.filter((name) => !mcpServers.has(name)));
  for (const mcpServer of optionalServers) {
    mcpServers.add(mcpServer);
  }

  /** Mirror the primary ephemeral loader (`loadEphemeralAgent`): spec flags are
   *  defaults an explicit conversation toggle overrides, and downstream
   *  `createRun` gating (hitlCapable, non-subagent, admin filter) is uniform. */
  const tools: string[] = resolveEphemeralTools(ephemeralAgent, modelSpec);
  /** Pinned web search rides on every chat, whatever the user or spec chose. */
  if (pinned.webSearch && !tools.includes(Tools.web_search)) {
    tools.push(Tools.web_search);
  }
  /** Same resolution as the primary loader: the picked entry decides the tool. */
  const imageSpec = resolveImageSpec(
    ephemeralAgent?.image_gen ?? (modelSpec?.imageGen === true ? true : undefined),
    (appConfig?.modelSpecs as { imageList?: TImageSpec[] } | undefined)?.imageList,
  );
  if (imageSpec) {
    tools.push(imageSpec.toolName);
  }

  const serverToolKeys = await mapWithConcurrency(
    [...mcpServers],
    getLookupConcurrency(appConfig, 'mcpCatalogLookups'),
    async (mcpServer): Promise<string[]> => {
      /** Address durable catalogs by the effective request overlay; request-scoped
       *  overlays still expand fresh through `mcp_all`. */
      const lookup = await getMCPToolsLookup(
        mcpServer,
        appConfig?.mcpConfig?.[mcpServer],
        deps.isUnmodifiedAppMCPServer,
      );
      const serverTools = lookup.requestScoped
        ? null
        : await deps.getMCPServerTools(userId, mcpServer, lookup.serverConfig, capabilityProfile);
      if (!serverTools && optionalServers.has(mcpServer)) {
        logger.warn(`[loadAddedAgent] Skipping pinned MCP server "${mcpServer}": no tools`);
        return [];
      }
      return serverTools ? Object.keys(serverTools) : [`${mcp_all}${mcp_delimiter}${mcpServer}`];
    },
  );
  for (const keys of serverToolKeys) {
    tools.push(...keys);
  }

  const model_parameters: Record<string, unknown> = {};
  const paramKeys = [
    'temperature',
    'top_p',
    'topP',
    'topK',
    'presence_penalty',
    'frequency_penalty',
    'maxOutputTokens',
    'maxTokens',
    'max_tokens',
  ];
  for (const key of paramKeys) {
    if ((rest as Record<string, unknown>)[key] != null) {
      model_parameters[key] = (rest as Record<string, unknown>)[key];
    }
  }

  let endpointConfig = (appConfig?.endpoints as Record<string, unknown> | undefined)?.[endpoint] as
    | Record<string, unknown>
    | undefined;
  if (!isAgentsEndpoint(endpoint) && !endpointConfig) {
    try {
      endpointConfig = getCustomEndpointConfig({ endpoint, appConfig }) as
        | Record<string, unknown>
        | undefined;
    } catch (err) {
      logger.error('[loadAddedAgent] Error getting custom endpoint config', err);
    }
  }

  const sender = getEphemeralSender({
    modelLabel: rest.modelLabel,
    specLabel: modelSpec?.label,
    modelDisplayLabel: endpointConfig?.modelDisplayLabel as string | undefined,
  });
  const ephemeralId = encodeEphemeralAgentId({ endpoint, model, sender, index: 1 });

  const result: Record<string, unknown> = {
    id: ephemeralId,
    instructions: promptPrefix || '',
    provider: endpoint,
    model_parameters,
    model,
    tools,
  };

  const artifacts = resolveSpecArtifacts(ephemeralAgent?.artifacts, modelSpec?.artifacts);
  if (artifacts != null) {
    result.artifacts = artifacts;
  }
  applyModelSpecSubagents(result, modelSpec);
  applyModelSpecSkills(result, modelSpec, ephemeralAgent?.skills);

  const toggleToolOptions = synthesizeToggleToolOptions({ ephemeralAgent, modelSpec });
  if (toggleToolOptions) {
    result.tool_options = toggleToolOptions;
  }

  return result as unknown as Agent;
}
