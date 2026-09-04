const { GoogleGenAI } = require('@google/genai');
const createGeminiImageTool = require('~/app/clients/tools/structured/GeminiImageGen');

jest.mock('@google/genai');
jest.mock('sharp', () => jest.fn());
jest.mock('@librechat/data-schemas', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));
jest.mock('~/server/services/Files/strategies', () => ({
  getStrategyFunctions: jest.fn(),
}));
jest.mock('~/models', () => ({
  getFiles: jest.fn().mockResolvedValue([]),
  spendTokens: jest.fn(),
}));

/**
 * `@librechat/api` is left unmocked so the real `brokerUserHeaders` decides
 * whether identity travels — that gate is the point of these tests.
 */
describe('GeminiImageGen - gateway routing', () => {
  const req = {
    user: { id: 'lc-user-1', email: 'chat-user@example.com', openidId: 'sub-42' },
  };
  let originalEnv;

  beforeEach(() => {
    jest.clearAllMocks();
    originalEnv = { ...process.env };
    process.env.TCHAT_BROKER_BASE_URL = 'http://tchat-broker:8081/v1';
    GoogleGenAI.mockImplementation(() => ({
      models: { generateContent: jest.fn().mockResolvedValue({ candidates: [] }) },
    }));
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const runTool = async () => {
    const geminiImageGenTool = createGeminiImageTool({
      isAgent: true,
      req,
      userId: 'lc-user-1',
      GEMINI_API_KEY: 'broker-shared-key',
    });
    await geminiImageGenTool.func({ prompt: 'a teal grid' });
  };

  it('aims the SDK at the broker and identifies the user', async () => {
    process.env.GEMINI_IMAGE_GEN_BASEURL = 'http://tchat-broker:8081';

    await runTool();

    expect(GoogleGenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'broker-shared-key',
        httpOptions: {
          baseUrl: 'http://tchat-broker:8081',
          headers: {
            'X-Tchat-User-Id': 'lc-user-1',
            'X-Tchat-User-Email': 'chat-user@example.com',
            'X-Tchat-User-Openid': 'sub-42',
            Authorization: 'Bearer broker-shared-key',
          },
        },
      }),
    );
  });

  it('talks to Google directly, with no identity, when no gateway is configured', async () => {
    delete process.env.GEMINI_IMAGE_GEN_BASEURL;

    await runTool();

    const [config] = GoogleGenAI.mock.calls[0];
    expect(config.httpOptions).toBeUndefined();
    expect(config.apiKey).toBe('broker-shared-key');
  });

  it('withholds the user identity from a gateway that is not the broker', async () => {
    process.env.GEMINI_IMAGE_GEN_BASEURL = 'https://generativelanguage.googleapis.com';

    await runTool();

    const [config] = GoogleGenAI.mock.calls[0];
    expect(config.httpOptions.headers).toEqual({ Authorization: 'Bearer broker-shared-key' });
  });
});
