import type { Endpoint } from '~/common';
import { buildOwnerGroups, formatModelLabel, getModelOwner } from '../owners';

/** The two endpoints and fallback model lists in deploy/tchat/librechat.yaml. */
const tensorGrid: Endpoint = {
  value: 'TensorGrid',
  label: 'TensorGrid',
  hasModels: true,
  icon: null,
  models: [
    'gpt-5.6-terra',
    'gpt-5.6-sol',
    'gpt-5.6-luna',
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.4-mini',
    'claude-opus-5',
    'claude-sonnet-5',
    'claude-haiku-4-5',
    'deepseek-v4-flash',
    'deepseek-ai/deepseek-v4-pro-0813',
    'moonshotai/kimi-k3',
    'minimaxai/minimax-m3',
    'nvidia/nemotron-3-super-120b-a12b',
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'Qwen/Qwen3.6-35B-A3B-FP8',
    'Qwen3.8-27B',
  ].map((name) => ({ name })),
};

const tensorGridClaude: Endpoint = {
  value: 'TensorGrid-Claude',
  label: 'TensorGrid Claude',
  hasModels: true,
  icon: null,
  models: [
    'claude-opus-5',
    'claude-sonnet-5',
    'claude-fable-5',
    'claude-opus-4-8',
    'claude-opus-4-7',
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
  ].map((name) => ({ name })),
};

const agents: Endpoint = {
  value: 'agents',
  label: 'My Agents',
  hasModels: true,
  icon: null,
  models: [{ name: 'agent_abc' }],
};

describe('getModelOwner', () => {
  it.each([
    ['gpt-5.6-terra', 'openai'],
    ['openai/gpt-oss-20b', 'openai'],
    ['o4-mini', 'openai'],
    ['claude-haiku-4-5', 'anthropic'],
    ['gemini-3.1-flash', 'google'],
    ['deepseek-ai/deepseek-v4-pro-0813', 'deepseek'],
    ['moonshotai/kimi-k3', 'moonshot'],
    ['Qwen/Qwen3.6-35B-A3B-FP8', 'qwen'],
    ['minimaxai/minimax-m3', 'minimax'],
    ['nvidia/nemotron-3-super-120b-a12b', 'nvidia'],
    ['glm-5', 'zhipu'],
    ['grok-5', 'xai'],
    ['some-house-model', 'other'],
  ])('%s → %s', (model, owner) => {
    expect(getModelOwner(model)).toBe(owner);
  });
});

describe('formatModelLabel', () => {
  it.each([
    ['gpt-5.6-terra', 'GPT-5.6 Terra'],
    ['gpt-5.4-mini', 'GPT-5.4 Mini'],
    ['openai/gpt-oss-120b', 'gpt-oss 120B'],
    ['claude-haiku-4-5', 'Claude Haiku 4.5'],
    ['claude-fable-5', 'Claude Fable 5'],
    ['claude-sonnet-4-5-20250929', 'Claude Sonnet 4.5'],
    ['deepseek-v4-flash', 'DeepSeek V4 Flash'],
    ['moonshotai/kimi-k3', 'Kimi K3'],
    ['minimaxai/minimax-m3', 'MiniMax M3'],
    ['Qwen/Qwen3.6-35B-A3B-FP8', 'Qwen3.6 35B A3B FP8'],
    ['nvidia/nemotron-3-super-120b-a12b', 'Nemotron 3 Super 120B A12B'],
  ])('%s → %s', (model, label) => {
    expect(formatModelLabel(model)).toBe(label);
  });
});

describe('buildOwnerGroups', () => {
  const groups = buildOwnerGroups([tensorGrid, tensorGridClaude, agents]);
  const byOwner = Object.fromEntries(groups.map((g) => [g.owner.id, g.models]));

  it('groups by owner in display order and leaves agents out', () => {
    expect(groups.map((g) => g.owner.id)).toEqual([
      'openai',
      'anthropic',
      'deepseek',
      'moonshot',
      'qwen',
      'minimax',
      'nvidia',
    ]);
  });

  it('lists a model served by two endpoints once, on the dedicated one', () => {
    const claude = byOwner.anthropic;
    expect(claude).toHaveLength(8);
    expect(new Set(claude.map((m) => m.endpoint.value))).toEqual(new Set(['TensorGrid-Claude']));
  });

  it('keeps the general endpoint for models only it serves', () => {
    expect(byOwner.openai).toHaveLength(8);
    expect(byOwner.openai.every((m) => m.endpoint.value === 'TensorGrid')).toBe(true);
  });

  it('leaves out what the chat filter rules out', () => {
    const filtered = buildOwnerGroups([tensorGrid], (id) => !id.startsWith('openai/gpt-oss'));
    const openai = filtered.find((g) => g.owner.id === 'openai')?.models ?? [];
    expect(openai.map((m) => m.modelId)).not.toContain('openai/gpt-oss-20b');
    expect(openai).toHaveLength(6);
  });

  it('prefers the dedicated endpoint whichever order endpoints arrive in', () => {
    const reversed = buildOwnerGroups([tensorGridClaude, tensorGrid]);
    const claude = reversed.find((g) => g.owner.id === 'anthropic')?.models ?? [];
    expect(claude.every((m) => m.endpoint.value === 'TensorGrid-Claude')).toBe(true);
  });
});
