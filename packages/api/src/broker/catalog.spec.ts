import { getTchatModelCatalog, resetTchatModelCatalogCache } from './catalog';

jest.mock('@librechat/data-schemas', () => ({
  logger: { warn: jest.fn() },
}));

const okResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

describe('getTchatModelCatalog', () => {
  const env = { ...process.env };

  beforeEach(() => {
    resetTchatModelCatalogCache();
    process.env.TCHAT_BROKER_ORIGIN = 'http://tchat-broker:8081/';
    process.env.TCHAT_BROKER_SHARED_KEY = 'shared-key';
  });

  afterAll(() => {
    process.env = env;
  });

  it('asks the broker with the shared key and keeps only well-formed entries', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      okResponse({
        free: ['Qwen3.8-27B', 7],
        categories: { 'gpt-image-2.5-c': 'image', 'gpt-5.5': 'language', bad: 3 },
      }),
    );

    await expect(getTchatModelCatalog(fetchImpl)).resolves.toEqual({
      free: ['Qwen3.8-27B'],
      categories: { 'gpt-image-2.5-c': 'image', 'gpt-5.5': 'language' },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://tchat-broker:8081/tchat/catalog/models',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer shared-key' }),
      }),
    );
  });

  it('holds the answer between calls', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse({ free: ['a'], categories: {} }));

    await getTchatModelCatalog(fetchImpl);
    await getTchatModelCatalog(fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns an empty catalog when the broker is not configured', async () => {
    delete process.env.TCHAT_BROKER_ORIGIN;
    const fetchImpl = jest.fn();

    await expect(getTchatModelCatalog(fetchImpl)).resolves.toEqual({ free: [], categories: {} });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns an empty catalog rather than failing when the broker errors', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 503 } as Response);

    await expect(getTchatModelCatalog(fetchImpl)).resolves.toEqual({ free: [], categories: {} });
  });
});
