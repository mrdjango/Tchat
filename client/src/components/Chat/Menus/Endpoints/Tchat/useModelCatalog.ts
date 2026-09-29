import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { request } from 'librechat-data-provider';

export interface CatalogBody {
  free?: string[];
  categories?: Record<string, string>;
}

export interface ModelCatalog {
  /** The catalog has answered; until then nothing is known about any model. */
  ready: boolean;
  /** TensorGrid prices this model at zero. */
  isFree: (modelId: string) => boolean;
  /**
   * Whether the model can hold a chat. The catalog's category decides; for a
   * model it does not list, only an unmistakable id (see `guessModelCategory`)
   * rules it out, so a lagging catalog never hides a working chat model.
   */
  isChatModel: (modelId: string) => boolean;
  /** The model only makes images, by the catalog or by its id. */
  isImageModel: (modelId: string) => boolean;
}

/**
 * A category for a model the catalog does not list, from ids that cannot be a
 * chat model: the Gateway serves variants (`gemini-3.1-flash-image-c`) the
 * public catalog leaves out. `null` means "assume chat".
 */
export function guessModelCategory(modelId: string): string | null {
  const id = modelId.toLowerCase();
  if (/(^|[/-])(gpt-image|dall-e|imagen)|[-_]image([-_.]|$)/.test(id)) {
    return 'image';
  }
  if (/embed/.test(id)) {
    return 'embeddings';
  }
  if (/whisper|transcri|(^|[-_/])asr([-_]|$)/.test(id)) {
    return 'transcription';
  }
  if (/(^|[-_/])(tts|speech|music)([-_]|$)/.test(id)) {
    return 'audio';
  }
  return null;
}

export function createModelCatalog(data: CatalogBody | undefined): ModelCatalog {
  const free = new Set(data?.free ?? []);
  const categories = data?.categories ?? {};
  const categoryOf = (modelId: string) => categories[modelId] ?? guessModelCategory(modelId);
  return {
    ready: data != null,
    isFree: (modelId) => free.has(modelId),
    isChatModel: (modelId) => {
      const category = categoryOf(modelId);
      return category == null || category === 'language';
    },
    isImageModel: (modelId) => categoryOf(modelId) === 'image',
  };
}

/**
 * TensorGrid's catalog facts for the picker. Loaded once per session and
 * refreshed every few minutes; until it answers, or if it fails, nothing is
 * tagged and only unmistakable ids are hidden.
 */
export default function useModelCatalog(): ModelCatalog {
  const { data } = useQuery({
    queryKey: ['tchatModelCatalog'],
    queryFn: () => request.get<CatalogBody>('/api/tchat/models/catalog'),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  return useMemo(() => createModelCatalog(data), [data]);
}
