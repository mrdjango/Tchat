const OpenAI = require('openai');
const createOpenAIImageTools = require('~/app/clients/tools/structured/OpenAIImageTools');

jest.mock('openai');
jest.mock('@librechat/data-schemas', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('~/server/services/Files/strategies', () => ({
  getStrategyFunctions: jest.fn(),
}));

jest.mock('~/models', () => ({
  getFiles: jest.fn().mockResolvedValue([]),
}));

/**
 * `@librechat/api` is deliberately left unmocked: this suite exists to prove the
 * tool is wired to the real `brokerUserHeaders`, which a stub would hide.
 */
describe('OpenAIImageTools - Tchat broker identity', () => {
  const req = {
    user: { id: 'lc-user-1', email: 'chat-user@example.com', openidId: 'sub-42' },
  };
  let originalEnv;

  const mockGeneration = () => {
    const generate = jest.fn().mockResolvedValue({ data: [{ b64_json: 'base64-image-data' }] });
    OpenAI.mockImplementation(() => ({ images: { generate } }));
    return generate;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    originalEnv = { ...process.env };
    process.env.IMAGE_GEN_OAI_API_KEY = 'broker-shared-key';
    process.env.TCHAT_BROKER_BASE_URL = 'http://tchat-broker:8081/v1';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('identifies the signed-in user when generation is routed through the broker', async () => {
    process.env.IMAGE_GEN_OAI_BASEURL = 'http://tchat-broker:8081/v1';
    mockGeneration();

    const [imageGenTool] = createOpenAIImageTools({ isAgent: true, override: false, req });
    await imageGenTool.func({ prompt: 'a teal grid' });

    expect(OpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultHeaders: {
          'X-Tchat-User-Id': 'lc-user-1',
          'X-Tchat-User-Email': 'chat-user@example.com',
          'X-Tchat-User-Openid': 'sub-42',
        },
      }),
    );
  });

  it('sends no user identity to a provider that is not the broker', async () => {
    delete process.env.IMAGE_GEN_OAI_BASEURL;
    mockGeneration();

    const [imageGenTool] = createOpenAIImageTools({ isAgent: true, override: false, req });
    await imageGenTool.func({ prompt: 'a teal grid' });

    const [config] = OpenAI.mock.calls[0];
    expect(config.defaultHeaders).toBeUndefined();
  });
});

describe('OpenAIImageTools - second model binding', () => {
  const { gatewayImageToolkit } = jest.requireActual('@librechat/api');
  let originalEnv;

  beforeEach(() => {
    jest.clearAllMocks();
    originalEnv = { ...process.env };
    process.env.IMAGE_GEN_OAI_API_KEY = 'test-key';
    process.env.IMAGE_GEN_OAI_MODEL = 'gpt-image-2';
    OpenAI.mockImplementation(() => ({
      images: { generate: jest.fn().mockResolvedValue({ data: [{ b64_json: 'x' }] }) },
    }));
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('generates with its own model and tool names, leaving the default binding alone', async () => {
    const [gatewayGen, gatewayEdit] = createOpenAIImageTools({
      isAgent: true,
      override: false,
      req: { user: { id: 'u1' } },
      imageModel: 'gemini-3-pro-image-c',
      genToolConfig: gatewayImageToolkit.image_gen_gateway,
      editToolConfig: gatewayImageToolkit.image_edit_gateway,
    });

    expect(gatewayGen.name).toBe('image_gen_gateway');
    expect(gatewayEdit.name).toBe('image_edit_gateway');

    await gatewayGen.func({ prompt: 'a teal grid' });
    const generate = OpenAI.mock.results[0].value.images.generate;
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-3-pro-image-c' }),
      expect.any(Object),
    );
  });

  it('falls back to IMAGE_GEN_OAI_MODEL when no override is given', async () => {
    const [imageGenTool] = createOpenAIImageTools({
      isAgent: true,
      override: false,
      req: { user: { id: 'u1' } },
    });

    expect(imageGenTool.name).toBe('image_gen_oai');

    await imageGenTool.func({ prompt: 'a teal grid' });
    const generate = OpenAI.mock.results[0].value.images.generate;
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-image-2' }),
      expect.any(Object),
    );
  });
});
