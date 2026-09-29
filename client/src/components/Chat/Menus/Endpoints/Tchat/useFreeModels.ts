import { useQuery } from '@tanstack/react-query';
import { request } from 'librechat-data-provider';

const EMPTY = new Set<string>();

/**
 * Model ids TensorGrid prices at zero. Loaded once per session and refreshed
 * every few minutes; until it answers, or if it fails, nothing is tagged.
 */
export default function useFreeModels(): Set<string> {
  const { data } = useQuery({
    queryKey: ['tchatFreeModels'],
    queryFn: () => request.get<{ free: string[] }>('/api/tchat/models/free'),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    select: (body) => new Set(body.free ?? []),
  });
  return data ?? EMPTY;
}
