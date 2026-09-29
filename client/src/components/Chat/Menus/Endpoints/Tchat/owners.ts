import { ProviderId, isAgentsEndpoint, isAssistantsEndpoint } from 'librechat-data-provider';
import type { Endpoint } from '~/common';

/**
 * Tchat's picker groups models by the company that makes them, not by the
 * endpoint that serves them. Every Tchat endpoint is a TensorGrid Gateway route,
 * so the endpoint says nothing about the model; its id does.
 */
export type OwnerId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'xai'
  | 'deepseek'
  | 'moonshot'
  | 'qwen'
  | 'zhipu'
  | 'minimax'
  | 'mistral'
  | 'meta'
  | 'nvidia'
  | 'other';

export interface ModelOwner {
  id: OwnerId;
  label: string;
  /** Model family, shown beside the owner where the two differ. */
  family?: string;
  /** Art from the shared provider registry; owners without one use a local logo. */
  provider?: ProviderId;
  /** Tested against the lowercased id, org prefix included. */
  match?: RegExp;
}

/** Display order. The first match wins, so narrower patterns come first. */
export const MODEL_OWNERS: ModelOwner[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    family: 'GPT',
    provider: ProviderId.openai,
    match: /(^|\/)(gpt|chatgpt|o\d|dall-e|codex)([-.]|$)|^openai\//,
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    family: 'Claude',
    provider: ProviderId.anthropic,
    match: /claude|^anthropic\//,
  },
  {
    id: 'google',
    label: 'Google',
    family: 'Gemini',
    provider: ProviderId.google,
    match: /gemini|gemma|learnlm|^google\//,
  },
  { id: 'xai', label: 'xAI', family: 'Grok', provider: ProviderId.xai, match: /grok|^x-?ai\// },
  { id: 'deepseek', label: 'DeepSeek', provider: ProviderId.deepseek, match: /deepseek/ },
  {
    id: 'moonshot',
    label: 'Moonshot',
    family: 'Kimi',
    provider: ProviderId.moonshot,
    match: /kimi|moonshot/,
  },
  { id: 'qwen', label: 'Qwen', provider: ProviderId.qwen, match: /qwen|qwq/ },
  { id: 'zhipu', label: 'Zhipu', family: 'GLM', match: /(^|\/)glm|zhipu|z-ai\// },
  { id: 'minimax', label: 'MiniMax', match: /minimax/ },
  {
    id: 'mistral',
    label: 'Mistral',
    provider: ProviderId.mistral,
    match: /mistral|mixtral|codestral|magistral|devstral|pixtral|ministral/,
  },
  { id: 'meta', label: 'Meta', family: 'Llama', match: /llama|^meta(-llama)?\// },
  { id: 'nvidia', label: 'NVIDIA', family: 'Nemotron', match: /nemotron|^nvidia\// },
  { id: 'other', label: 'Other' },
];

const ownerById = new Map(MODEL_OWNERS.map((owner) => [owner.id, owner]));

export function getOwner(id: OwnerId): ModelOwner {
  return ownerById.get(id) ?? (ownerById.get('other') as ModelOwner);
}

export function getModelOwner(modelId: string): OwnerId {
  const value = modelId.trim().toLowerCase();
  for (const owner of MODEL_OWNERS) {
    if (owner.match?.test(value)) {
      return owner.id;
    }
  }
  return 'other';
}

const brandWords: Record<string, string> = {
  deepseek: 'DeepSeek',
  minimax: 'MiniMax',
  glm: 'GLM',
  gpt: 'GPT',
  oss: 'oss',
  fp8: 'FP8',
  fp4: 'FP4',
};

function formatWord(word: string): string {
  const lower = word.toLowerCase();
  if (brandWords[lower]) {
    return brandWords[lower];
  }
  /** Sizes and versions read in caps: 120b → 120B, a12b → A12B, v4 → V4. */
  if (/\d/.test(word)) {
    return /^[a-z]?\d+(\.\d+)?[a-z]?$/i.test(word) ? word.toUpperCase() : word;
  }
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Human label for a model id: `gpt-5.6-terra` → `GPT-5.6 Terra`,
 * `claude-opus-4-8` → `Claude Opus 4.8`, `moonshotai/kimi-k3` → `Kimi K3`.
 * The raw id stays visible beside it, so a label only has to be readable.
 */
export function formatModelLabel(modelId: string): string {
  const base = modelId.split('/').pop() ?? modelId;

  const claude = base.match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/i);
  if (claude) {
    const [, family, major, minor] = claude;
    return `Claude ${formatWord(family)} ${minor ? `${major}.${minor}` : major}`;
  }

  if (/^gpt-oss/i.test(base)) {
    const rest = base.slice('gpt-oss'.length).split('-').filter(Boolean);
    return ['gpt-oss', ...rest.map(formatWord)].join(' ');
  }

  const gpt = base.match(/^gpt-(\d+(?:\.\d+)?[a-z]?)(?:-(.+))?$/i);
  if (gpt) {
    const [, version, rest] = gpt;
    const suffix = rest ? rest.split('-').map(formatWord).join(' ') : '';
    return `GPT-${version}${suffix ? ` ${suffix}` : ''}`;
  }

  return base.split(/[-_]/).filter(Boolean).map(formatWord).join(' ');
}

export interface PickerModel {
  /** Unique across the picker: `${endpoint}::${model}`. */
  key: string;
  modelId: string;
  label: string;
  owner: OwnerId;
  endpoint: Endpoint;
  isGlobal?: boolean;
}

export interface OwnerGroup {
  owner: ModelOwner;
  models: PickerModel[];
}

function isModelEndpoint(endpoint: Endpoint): boolean {
  return (
    endpoint.hasModels && !isAgentsEndpoint(endpoint.value) && !isAssistantsEndpoint(endpoint.value)
  );
}

/**
 * An endpoint whose every model has one owner is that owner's dedicated route
 * (Tchat's TensorGrid-Claude, the native Anthropic API). A model served by both
 * a dedicated and a general endpoint is listed once, on the dedicated one.
 */
function dedicatedOwner(endpoint: Endpoint): OwnerId | null {
  const models = endpoint.models ?? [];
  if (models.length === 0) {
    return null;
  }
  const first = getModelOwner(models[0].name);
  if (first === 'other') {
    return null;
  }
  return models.every((model) => getModelOwner(model.name) === first) ? first : null;
}

/**
 * `isChatModel` drops what cannot hold a chat (image, embedding, transcription
 * models the Gateway's /v1/models also lists); a chat request to one fails.
 */
export function buildOwnerGroups(
  endpoints: Endpoint[],
  isChatModel: (modelId: string) => boolean = () => true,
): OwnerGroup[] {
  const byModelId = new Map<string, PickerModel>();
  const dedicated = new Map<string, OwnerId | null>();

  for (const endpoint of endpoints) {
    if (!isModelEndpoint(endpoint)) {
      continue;
    }
    dedicated.set(endpoint.value, dedicatedOwner(endpoint));
    for (const model of endpoint.models ?? []) {
      if (!isChatModel(model.name)) {
        continue;
      }
      const owner = getModelOwner(model.name);
      const existing = byModelId.get(model.name);
      if (existing) {
        const existingIsDedicated = dedicated.get(existing.endpoint.value) === owner;
        const thisIsDedicated = dedicated.get(endpoint.value) === owner;
        if (existingIsDedicated || !thisIsDedicated) {
          continue;
        }
      }
      byModelId.set(model.name, {
        key: `${endpoint.value}::${model.name}`,
        modelId: model.name,
        label: formatModelLabel(model.name),
        owner,
        endpoint,
        isGlobal: model.isGlobal,
      });
    }
  }

  const grouped = new Map<OwnerId, PickerModel[]>();
  for (const model of byModelId.values()) {
    const list = grouped.get(model.owner) ?? [];
    list.push(model);
    grouped.set(model.owner, list);
  }

  return MODEL_OWNERS.filter((owner) => grouped.has(owner.id)).map((owner) => ({
    owner,
    models: grouped.get(owner.id) as PickerModel[],
  }));
}

export function matchesSearch(model: PickerModel, search: string): boolean {
  const term = search.trim().toLowerCase();
  if (!term) {
    return true;
  }
  const owner = getOwner(model.owner);
  return [model.label, model.modelId, owner.label, owner.family ?? '']
    .join(' ')
    .toLowerCase()
    .includes(term);
}
