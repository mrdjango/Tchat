import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { request } from 'librechat-data-provider';

interface CatalogBody {
  free?: string[];
  categories?: Record<string, string>;
}

export interface ModelCatalog {
  /** TensorGrid prices this model at zero. */
  isFree: (modelId: string) => boolean;
  /**
   * Whether the model can hold a chat. Only a model the catalog files under
   * another category (image, embeddings, transcription) is ruled out; one it
   * does not list stays, so a lagging catalog never hides a working model.
   */
  isChatModel: (modelId: string) => boolean;
}

/**
 * TensorGrid's catalog facts for the picker. Loaded once per session and
 * refreshed every few minutes; until it answers, or if it fails, nothing is
 * tagged and nothing is hidden.
 */
export default function useModelCatalog(): ModelCatalog {
  const { data } = useQuery({
    queryKey: ['tchatModelCatalog'],
    queryFn: () => request.get<CatalogBody>('/api/tchat/models/catalog'),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  return useMemo(() => {
    const free = new Set(data?.free ?? []);
    const categories = data?.categories ?? {};
    return {
      isFree: (modelId) => free.has(modelId),
      isChatModel: (modelId) => {
        const category = categories[modelId];
        return category == null || category === 'language';
      },
    };
  }, [data]);
}
