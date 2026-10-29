import { formatTchatCredit } from '../useTchatCredit';

describe('formatTchatCredit', () => {
  it('formats USD cents with two decimals', () => {
    expect(formatTchatCredit({ balance_cents: 1234, currency: 'USD' })).toBe('$12.34');
    expect(formatTchatCredit({ balance_cents: 5, currency: 'USD' })).toBe('$0.05');
  });

  it('formats IRT without decimals', () => {
    expect(formatTchatCredit({ balance_cents: 1250000, currency: 'IRT' })).toMatch(
      /1.250.000 Toman/,
    );
  });
});
