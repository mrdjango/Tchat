import { brokerUserHeaders } from './headers';

const user = {
  user: { id: 'lc-user-1', email: 'chat-user@example.com', openidId: 'sub-42' },
};

describe('brokerUserHeaders', () => {
  const original = process.env.TCHAT_BROKER_BASE_URL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.TCHAT_BROKER_BASE_URL;
      return;
    }
    process.env.TCHAT_BROKER_BASE_URL = original;
  });

  it('identifies the user when the tool is aimed at the broker', () => {
    process.env.TCHAT_BROKER_BASE_URL = 'http://tchat-broker:8081/v1';

    expect(brokerUserHeaders(user, 'http://tchat-broker:8081/v1/')).toEqual({
      'X-Tchat-User-Id': 'lc-user-1',
      'X-Tchat-User-Email': 'chat-user@example.com',
      'X-Tchat-User-Openid': 'sub-42',
    });
  });

  it('sends nothing to a provider that is not the broker', () => {
    process.env.TCHAT_BROKER_BASE_URL = 'http://tchat-broker:8081/v1';

    expect(brokerUserHeaders(user, 'https://api.openai.com/v1/')).toEqual({});
  });

  it('sends nothing when no broker is configured', () => {
    delete process.env.TCHAT_BROKER_BASE_URL;

    expect(brokerUserHeaders(user, 'http://tchat-broker:8081/v1/')).toEqual({});
  });

  it('omits an identifier that cannot be encoded as a header', () => {
    process.env.TCHAT_BROKER_BASE_URL = 'http://tchat-broker:8081/v1';
    const unicode = {
      user: { id: 'lc-user-2', email: 'chat-üser@example.com', openidId: 'sub-43' },
    };

    expect(brokerUserHeaders(unicode, 'http://tchat-broker:8081/v1/')).toEqual({
      'X-Tchat-User-Id': 'lc-user-2',
      'X-Tchat-User-Openid': 'sub-43',
    });
  });

  it('is empty for an unauthenticated request', () => {
    process.env.TCHAT_BROKER_BASE_URL = 'http://tchat-broker:8081/v1';

    expect(brokerUserHeaders(undefined, 'http://tchat-broker:8081/v1/')).toEqual({});
  });
});
