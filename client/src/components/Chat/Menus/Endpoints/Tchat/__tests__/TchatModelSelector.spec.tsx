import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen, within, waitFor } from '@testing-library/react';
import type { Endpoint, SelectedValues } from '~/common';
import TchatModelSelector from '../TchatModelSelector';

const mockHandleSelectModel = jest.fn();
const mockHandleSelectSpec = jest.fn();
const mockNavigate = jest.fn();
let mockSelectedValues: SelectedValues;
let mockFreeModels = new Set<string>();

const endpoint = (value: string, label: string, models: string[]): Endpoint => ({
  value,
  label,
  hasModels: true,
  icon: null,
  models: models.map((name) => ({ name })),
});

const mockEndpoints: Endpoint[] = [
  endpoint('TensorGrid', 'TensorGrid', [
    'gpt-5.6-terra',
    'gpt-5.4-mini',
    'claude-sonnet-5',
    'deepseek-v4-flash',
    'moonshotai/kimi-k3',
  ]),
  endpoint('TensorGrid-Claude', 'TensorGrid Claude', ['claude-opus-5', 'claude-sonnet-5']),
  { ...endpoint('agents', 'My Agents', ['agent_1']), agentNames: { agent_1: 'Research helper' } },
];

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

jest.mock('@librechat/client', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    ProviderIcon: () => null,
    TooltipAnchor: React.forwardRef(function MockTooltipAnchor(
      {
        render,
        description: _description,
        ...rest
      }: { render: React.ReactElement; description?: string },
      ref: React.Ref<HTMLElement>,
    ) {
      const props: Record<string, unknown> = { ...rest, ref };
      if (props.children == null) {
        delete props.children;
      }
      return React.cloneElement(render, props);
    }),
  };
});

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useFavorites: () => ({
    isFavoriteModel: () => false,
    toggleFavoriteModel: jest.fn(),
    isFavoriteAgent: () => false,
    toggleFavoriteAgent: jest.fn(),
    isFavoriteSpec: () => false,
    toggleFavoriteSpec: jest.fn(),
  }),
}));

jest.mock('~/hooks/useKeyboardShortcuts', () => ({
  useShortcutHint: (_: string, label: string) => label,
  useShortcutAriaKey: () => undefined,
}));

jest.mock('../useFreeModels', () => () => mockFreeModels);

jest.mock('../../ModelSelectorChatContext', () => ({
  ModelSelectorChatProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../../ModelSelectorContext', () => ({
  ModelSelectorProvider: ({ children }: { children: React.ReactNode }) => children,
  useModelSelectorContext: () => ({
    agentsMap: undefined,
    endpointsConfig: {},
    modelSpecs: [
      {
        name: 'tensorgrid-default',
        label: 'TensorGrid',
        preset: { endpoint: 'TensorGrid', model: 'gpt-5.6-terra' },
      },
    ],
    mappedEndpoints: mockEndpoints,
    selectedValues: mockSelectedValues,
    handleSelectSpec: mockHandleSelectSpec,
    handleSelectModel: mockHandleSelectModel,
  }),
}));

const startupConfig = { interface: {}, modelSpecs: { list: [] } } as never;

async function openPicker() {
  const user = userEvent.setup();
  render(<TchatModelSelector startupConfig={startupConfig} />);
  await user.click(screen.getByTestId('model-selector-button'));
  const dialog = await screen.findByRole('dialog');
  return { user, dialog };
}

describe('TchatModelSelector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSelectedValues = {
      endpoint: 'TensorGrid',
      model: 'gpt-5.6-terra',
      modelSpec: 'tensorgrid-default',
    };
  });

  it('names the model in use on the trigger, not the spec', () => {
    render(<TchatModelSelector startupConfig={startupConfig} />);
    const trigger = screen.getByTestId('model-selector-button');
    expect(trigger).toHaveTextContent('GPT-5.6 Terra');
    expect(trigger).toHaveTextContent('OpenAI');
    expect(trigger).not.toHaveTextContent(/^TensorGrid/);
  });

  it('groups models by owner and pins the current one on top', async () => {
    const { dialog } = await openPicker();
    const listbox = within(dialog).getByRole('listbox');
    const groups = within(listbox).getAllByRole('group');
    expect(groups.map((g) => within(g).getAllByText(/./)[0].textContent)).toEqual([
      'OpenAI',
      'Anthropic',
      'DeepSeek',
      'Moonshot',
      'My Agents',
    ]);
    /** The spec that only names a listed model is folded into that model's row. */
    expect(within(listbox).queryByText('Presets')).toBeNull();
    expect(within(dialog).getAllByText('com_ui_current').length).toBeGreaterThan(0);
  });

  it('lists a model served twice once, and selects it on its dedicated endpoint', async () => {
    const { user, dialog } = await openPicker();
    const rows = within(dialog).getAllByRole('option', { name: /Claude Sonnet 5/ });
    expect(rows).toHaveLength(1);
    await user.click(rows[0]);
    expect(mockHandleSelectModel).toHaveBeenCalledWith(
      expect.objectContaining({ value: 'TensorGrid-Claude' }),
      'claude-sonnet-5',
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('filters by owner from the rail', async () => {
    const { user, dialog } = await openPicker();
    await user.click(within(dialog).getByRole('button', { name: /^DeepSeek/ }));
    const options = within(dialog).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining('DeepSeek V4 Flash'),
    ]);
  });

  it('searches across label, id and owner', async () => {
    const { user, dialog } = await openPicker();
    await user.type(within(dialog).getByRole('combobox'), 'kimi');
    const options = within(dialog).getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Kimi K3');
    expect(options[0]).toHaveTextContent('moonshotai/kimi-k3');
  });

  it('tags free models, on their rows and on the trigger', async () => {
    mockFreeModels = new Set(['deepseek-v4-flash', 'gpt-5.6-terra']);
    const { dialog } = await openPicker();
    expect(within(dialog).getByRole('option', { name: /DeepSeek V4 Flash/ })).toHaveTextContent(
      'com_ui_free',
    );
    expect(within(dialog).getByRole('option', { name: /GPT-5.4 Mini/ })).not.toHaveTextContent(
      'com_ui_free',
    );
    expect(screen.getByTestId('model-selector-button')).toHaveTextContent('com_ui_free');
  });

  it('tags nothing while the free list is unknown', async () => {
    mockFreeModels = new Set();
    const { dialog } = await openPicker();
    expect(within(dialog).queryByText('com_ui_free')).toBeNull();
  });

  it('shows the agent on the trigger when an agent is selected', () => {
    mockSelectedValues = { endpoint: 'agents', model: 'agent_1', modelSpec: '' };
    render(<TchatModelSelector startupConfig={startupConfig} />);
    const trigger = screen.getByTestId('model-selector-button');
    expect(trigger).toHaveTextContent('Research helper');
    expect(trigger).toHaveTextContent('My Agents');
  });
});
