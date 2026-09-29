const axios = require('axios');
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
 * Some gateway upstreams (LinkAPI's `gpt-image-2.5-c`, and every LinkAPI edit)
 * answer with a hosted `url` instead of `b64_json`. The tool must inline that
 * image rather than report "No image data".
 */
describe('OpenAIImageTools - hosted image URLs', () => {
  const req = { user: { id: 'lc-user-1' } };
  const imageBytes = Buffer.from('png-bytes');
  let originalEnv;
  let getSpy;

  const mockGeneration = (item) => {
    const generate = jest.fn().mockResolvedValue({ data: [item] });
    OpenAI.mockImplementation(() => ({ images: { generate } }));
    return generate;
  };

  const generate = async () => {
    const [imageGenTool] = createOpenAIImageTools({ isAgent: true, override: false, req });
    return imageGenTool.func({ prompt: 'a red apple' });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    originalEnv = { ...process.env };
    process.env.IMAGE_GEN_OAI_API_KEY = 'broker-shared-key';
    process.env.IMAGE_GEN_OAI_BASEURL = 'http://tchat-broker:8081/v1';
    getSpy = jest.spyOn(axios, 'get').mockResolvedValue({ data: imageBytes });
  });

  afterEach(() => {
    getSpy.mockRestore();
    process.env = originalEnv;
  });

  it('downloads an https image URL and inlines it as base64', async () => {
    mockGeneration({ url: 'https://cdn.example.com/files/abc.png' });

    const [, artifact] = await generate();

    expect(getSpy).toHaveBeenCalledWith(
      'https://cdn.example.com/files/abc.png',
      expect.objectContaining({ responseType: 'arraybuffer' }),
    );
    expect(artifact.content[0].image_url.url).toBe(
      `data:image/png;base64,${imageBytes.toString('base64')}`,
    );
  });

  it('sends none of the broker credentials with the download', async () => {
    mockGeneration({ url: 'https://cdn.example.com/files/abc.png' });

    await generate();

    const [, config] = getSpy.mock.calls[0];
    expect(config.headers).toBeUndefined();
  });

  it('refuses a plain-http image URL', async () => {
    mockGeneration({ url: 'http://tchat-broker:8081/internal' });

    const [message] = await generate();

    expect(getSpy).not.toHaveBeenCalled();
    expect(message).toMatch(/No image data returned/);
  });

  it('reports a failed download as missing image data', async () => {
    mockGeneration({ url: 'https://cdn.example.com/files/gone.png' });
    getSpy.mockRejectedValue(new Error('404'));

    const [message] = await generate();

    expect(message).toMatch(/No image data returned/);
  });

  it('uses b64_json directly when the upstream returns it', async () => {
    mockGeneration({ b64_json: 'base64-image-data' });

    const [, artifact] = await generate();

    expect(getSpy).not.toHaveBeenCalled();
    expect(artifact.content[0].image_url.url).toBe('data:image/png;base64,base64-image-data');
  });
});
