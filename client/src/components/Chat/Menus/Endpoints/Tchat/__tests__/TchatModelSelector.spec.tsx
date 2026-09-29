import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen, within, waitFor } from '@testing-library/react';
import type { Endpoint, SelectedValues } from '~/common';
import TchatModelSelector from '../TchatModelSelector';

const mockHandleSelectModel = jest.fn();
const mockHandleSelectSpec = jest.fn();
const mockNavigate = jest.fn();
let mockSelectedValues: SelectedValues;
let mockFree = new Set<string>();
let mockCategories: Record<string, string> = {};
let mockImageSelection: boolean | string | undefined;
let mockImageGenAvailable = true;
const mockSelectImage = jest.fn();

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
    'gpt-image-2.5-c',
    'text-embedding-3-small',
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

jest.mock('../useModelCatalog', () => () => ({
  isFree: (id: string) => mockFree.has(id),
  isChatModel: (id: string) => (mockCategories[id] ?? 'language') === 'language',
}));

jest.mock('../useImageGenChoice', () => () => ({
  selection: mockImageSelection,
  select: mockSelectImage,
}));

jest.mock('~/hooks/Plugins', () => ({
  useImageGenAvailable: () => mockImageGenAvailable,
}));

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

const startupConfig = {
  interface: {},
  modelSpecs: {
    list: [],
    imageList: [
      { name: 'gpt-image', label: 'GPT Image', model: 'gpt-image-2', default: true },
      { name: 'gpt-image-2-5', label: 'GPT Image 2.5', model: 'gpt-image-2.5-c' },
    ],
  },
} as never;

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
    mockFree = new Set();
    mockCategories = { 'gpt-image-2.5-c': 'image', 'text-embedding-3-small': 'embeddings' };
    mockImageSelection = undefined;
    mockImageGenAvailable = true;
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
      'com_ui_image_gen',
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
    mockFree = new Set(['deepseek-v4-flash', 'gpt-5.6-terra']);
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
    const { dialog } = await openPicker();
    expect(within(dialog).queryByText('com_ui_free')).toBeNull();
  });

  it('does not offer image or embedding models as chat models', async () => {
    const { dialog } = await openPicker();
    const openai = within(dialog)
      .getAllByRole('group')
      .find((g) => within(g).queryByText('OpenAI'));
    expect(within(openai as HTMLElement).queryByText(/gpt-image-2\.5-c/)).toBeNull();
    expect(within(dialog).queryByText('text-embedding-3-small')).toBeNull();
  });

  it('keeps a model the catalog does not know', async () => {
    mockCategories = {};
    const { dialog } = await openPicker();
    expect(within(dialog).getByText('text-embedding-3-small')).toBeInTheDocument();
  });

  it('turns on Image Gen with a picked image model and keeps the chat model', async () => {
    const { user, dialog } = await openPicker();
    await user.click(within(dialog).getByRole('option', { name: /GPT Image 2\.5/ }));
    expect(mockSelectImage).toHaveBeenCalledWith('gpt-image-2-5');
    expect(mockHandleSelectModel).not.toHaveBeenCalled();
  });

  it('turns Image Gen off when the active image model is picked again', async () => {
    mockImageSelection = 'gpt-image-2-5';
    const { user, dialog } = await openPicker();
    await user.click(within(dialog).getByRole('option', { name: /GPT Image 2\.5/ }));
    expect(mockSelectImage).toHaveBeenCalledWith(false);
  });

  it('marks the default image model active when Image Gen is simply on', async () => {
    mockImageSelection = true;
    const { dialog } = await openPicker();
    expect(
      within(dialog).getByRole('option', { name: /^GPT Image gpt-image-2/ }),
    ).toHaveTextContent('com_ui_current');
    expect(screen.getByTestId('model-selector-button')).toHaveTextContent('GPT Image');
  });

  it('hides the image group where Image Gen is not configured', async () => {
    mockImageGenAvailable = false;
    const { dialog } = await openPicker();
    expect(within(dialog).queryByText('com_ui_image_gen')).toBeNull();
  });

  it('shows the agent on the trigger when an agent is selected', () => {
    mockSelectedValues = { endpoint: 'agents', model: 'agent_1', modelSpec: '' };
    render(<TchatModelSelector startupConfig={startupConfig} />);
    const trigger = screen.getByTestId('model-selector-button');
    expect(trigger).toHaveTextContent('Research helper');
    expect(trigger).toHaveTextContent('My Agents');
  });
});
