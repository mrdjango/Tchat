/**
 * Errors the chat UI will render. LibreChat surfaces an upstream error body
 * verbatim, so these are shaped like OpenAI errors rather than bare 500s.
 */
export class BrokerError extends Error {
  constructor({ status, code, message, type = 'invalid_request_error' }) {
    super(message);
    this.status = status;
    this.code = code;
    this.type = type;
  }

  body() {
    return { error: { message: this.message, type: this.type, code: this.code, param: null } };
  }
}

export const unauthorized = () =>
  new BrokerError({
    status: 401,
    code: 'broker_unauthorized',
    type: 'authentication_error',
    message: 'Tchat is not authorized to call the TensorGrid broker.',
  });

export const noIdentity = () =>
  new BrokerError({
    status: 401,
    code: 'identity_missing',
    type: 'authentication_error',
    message: 'This chat session carries no TensorGrid identity. Sign in again.',
  });

export const noAccount = () =>
  new BrokerError({
    status: 403,
    code: 'tensorgrid_account_required',
    type: 'permission_error',
    message:
      'No TensorGrid account matches this sign-in. Create one at https://tensorgrid.space and use the same email.',
  });

export const accountDisabled = () =>
  new BrokerError({
    status: 403,
    code: 'tensorgrid_account_disabled',
    type: 'permission_error',
    message: 'This TensorGrid account is disabled. Contact support at https://tensorgrid.space.',
  });

export const upstreamUnavailable = (detail) =>
  new BrokerError({
    status: 503,
    code: 'tensorgrid_unavailable',
    type: 'api_error',
    message: `TensorGrid is temporarily unavailable: ${detail}`,
  });
