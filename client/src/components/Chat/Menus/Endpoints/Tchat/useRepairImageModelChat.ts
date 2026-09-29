import { useEffect, useRef } from 'react';
import { isAgentsEndpoint, isAssistantsEndpoint } from 'librechat-data-provider';
import type { TImageSpec, TModelSpec } from 'librechat-data-provider';
import type { ImageGenChoice } from './useImageGenChoice';
import type { Endpoint, SelectedValues } from '~/common';
import type { ModelCatalog } from './useModelCatalog';

interface RepairOptions {
  catalog: ModelCatalog;
  selectedValues: SelectedValues;
  mappedEndpoints: Endpoint[] | null | undefined;
  modelSpecs: TModelSpec[] | undefined;
  imageSpecs: TImageSpec[];
  imageGenAvailable: boolean;
  imageGen: ImageGenChoice;
  handleSelectModel: (endpoint: Endpoint, model: string) => void;
  /** Tells the user what changed; given the old model and the new chat model. */
  onRepaired?: (from: string, to: string) => void;
}

/**
 * The chat model to fall back to on `endpoint`: the default spec's model when
 * that spec targets this endpoint, else the endpoint's first chat model.
 */
function fallbackChatModel(
  endpoint: Endpoint,
  modelSpecs: TModelSpec[] | undefined,
  isChatModel: (id: string) => boolean,
): string | null {
  const models = (endpoint.models ?? []).map((m) => m.name).filter(isChatModel);
  const preferred = (modelSpecs ?? []).find((spec) => spec.default === true)?.preset;
  if (
    preferred?.endpoint === endpoint.value &&
    preferred.model &&
    models.includes(preferred.model)
  ) {
    return preferred.model;
  }
  return models[0] ?? null;
}

/** `gpt-image-2-4k` → `gpt-image-2`, `gemini-3.1-flash-image-c` → `gemini-3.1-flash-image`. */
const familyOf = (modelId: string) => modelId.toLowerCase().replace(/(-(c|h|hd|4k))+$/, '');

/**
 * The Image Gen entry for an image model the chat was set to: the entry for
 * that exact model, else one for the same model at another price tier, else
 * the default entry. `null` when the model is not an image model.
 */
export function matchImageSpec(
  modelId: string,
  imageSpecs: TImageSpec[],
  isImageModel: (id: string) => boolean,
): TImageSpec | null {
  if (!isImageModel(modelId) || imageSpecs.length === 0) {
    return null;
  }
  const family = familyOf(modelId);
  return (
    imageSpecs.find((spec) => spec.model === modelId) ??
    imageSpecs.find((spec) => familyOf(spec.model) === family) ??
    imageSpecs.find((spec) => spec.default === true) ??
    imageSpecs[0]
  );
}

/**
 * A conversation saved before the picker filtered models can still have an
 * image model as its chat model, and every message in it then fails: image
 * models only answer on the image endpoint. Once the catalog confirms the
 * model is not a chat model, move the chat to a chat model on the same
 * endpoint and turn Image Gen on with that image model, which is what picking
 * it meant. Runs once per conversation and model, and never for a model the
 * catalog does not know.
 */
export default function useRepairImageModelChat({
  catalog,
  selectedValues,
  mappedEndpoints,
  modelSpecs,
  imageSpecs,
  imageGenAvailable,
  imageGen,
  handleSelectModel,
  onRepaired,
}: RepairOptions): void {
  const repaired = useRef(new Set<string>());
  const { endpoint: selEndpoint, model: selModel } = selectedValues;

  useEffect(() => {
    if (!catalog.ready || !selEndpoint || !selModel) {
      return;
    }
    if (isAgentsEndpoint(selEndpoint) || isAssistantsEndpoint(selEndpoint)) {
      return;
    }
    if (catalog.isChatModel(selModel)) {
      return;
    }
    const key = `${selEndpoint}::${selModel}`;
    if (repaired.current.has(key)) {
      return;
    }
    const endpoint = (mappedEndpoints ?? []).find((e) => e.value === selEndpoint);
    if (!endpoint) {
      return;
    }
    const target = fallbackChatModel(endpoint, modelSpecs, catalog.isChatModel);
    if (!target) {
      return;
    }
    repaired.current.add(key);

    handleSelectModel(endpoint, target);
    const imageSpec = matchImageSpec(selModel, imageSpecs, catalog.isImageModel);
    if (imageGenAvailable && imageSpec) {
      imageGen.select(imageSpec.name);
    }
    onRepaired?.(selModel, target);
  }, [
    catalog,
    selEndpoint,
    selModel,
    mappedEndpoints,
    modelSpecs,
    imageSpecs,
    imageGenAvailable,
    imageGen,
    handleSelectModel,
    onRepaired,
  ]);
}
