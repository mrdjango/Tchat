import { getTchatFreeModels, resetTchatFreeModelsCache } from './catalog';

jest.mock('@librechat/data-schemas', () => ({
  logger: { warn: jest.fn() },
}));

const okResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

describe('getTchatFreeModels', () => {
  const env = { ...process.env };

  beforeEach(() => {
    resetTchatFreeModelsCache();
    process.env.TCHAT_BROKER_ORIGIN = 'http://tchat-broker:8081/';
    process.env.TCHAT_BROKER_SHARED_KEY = 'shared-key';
  });

  afterAll(() => {
    process.env = env;
  });

  it('asks the broker with the shared key and returns its ids', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse({ free: ['Qwen3.8-27B', 7] }));

    await expect(getTchatFreeModels(fetchImpl)).resolves.toEqual(['Qwen3.8-27B']);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://tchat-broker:8081/tchat/catalog/free-models',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer shared-key' }),
      }),
    );
  });

  it('holds the answer between calls', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse({ free: ['a'] }));

    await getTchatFreeModels(fetchImpl);
    await getTchatFreeModels(fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns an empty list when the broker is not configured', async () => {
    delete process.env.TCHAT_BROKER_ORIGIN;
    const fetchImpl = jest.fn();

    await expect(getTchatFreeModels(fetchImpl)).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns an empty list rather than failing when the broker errors', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 503 } as Response);

    await expect(getTchatFreeModels(fetchImpl)).resolves.toEqual([]);
  });
});
