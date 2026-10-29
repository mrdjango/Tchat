import { useQuery } from '@tanstack/react-query';
import { request } from 'librechat-data-provider';

interface CreditBody {
  balance_cents: number;
  currency: string;
}

/**
 * The amount with its currency's own minor unit, which TensorGrid fixes per
 * currency: USD cents (2 digits), IRT toman (0). Mirrors `MINOR_DIGITS` in
 * TensorGrid's `backend/billing/services.py`.
 */
export function formatTchatCredit({ balance_cents, currency }: CreditBody): string {
  const digits = currency === 'USD' ? 2 : 0;
  const amount = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(balance_cents / 10 ** digits);
  return currency === 'USD' ? `$${amount}` : `${amount} ${currency === 'IRT' ? 'Toman' : currency}`;
}

/** Undefined until the server answers, and again after any failure, so the line simply hides. */
export default function useTchatCredit(): string | undefined {
  const { data } = useQuery({
    queryKey: ['tchatCredit'],
    queryFn: () => request.get<CreditBody>('/api/tchat/credit'),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  return data && typeof data.balance_cents === 'number' ? formatTchatCredit(data) : undefined;
}
