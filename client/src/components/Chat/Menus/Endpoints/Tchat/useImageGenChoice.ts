import { useCallback } from 'react';
import { useRecoilValue } from 'recoil';
import { Constants, LocalStorageKeys } from 'librechat-data-provider';
import { useToolToggle } from '~/hooks/Plugins';
import store from '~/store';

/** Same key BadgeRowContext toggles: one flag equips the whole image toolkit. */
const IMAGE_GEN_KEY = 'image_gen';

export interface ImageGenChoice {
  /** `true` for the admin default, a spec name, or falsy when image generation is off. */
  selection: boolean | string | undefined;
  /** A spec name turns image generation on with that model; `false` turns it off. */
  select: (value: string | false) => void;
}

/**
 * The conversation's Image Gen state, shared with the chat input's toggle. The
 * picker sits in the header, outside BadgeRowProvider, so it derives the same
 * conversation and storage keys that provider does and writes the same flag.
 */
export default function useImageGenChoice(hasModelSpecs: boolean): ImageGenChoice {
  const conversationId = useRecoilValue(store.conversationIdByIndex(0));
  const specName = useRecoilValue(store.conversationSpecByIndex(0));
  const storageContextKey =
    !specName && hasModelSpecs ? (Constants.spec_defaults_key as string) : undefined;

  const imageGen = useToolToggle({
    conversationId: conversationId ?? Constants.NEW_CONVO,
    storageContextKey,
    toolKey: IMAGE_GEN_KEY,
    localStorageKey: LocalStorageKeys.LAST_IMAGE_GEN_TOGGLE_,
    isAuthenticated: true,
  });

  const { debouncedChange } = imageGen;
  const select = useCallback(
    (value: string | false) => debouncedChange({ value }),
    [debouncedChange],
  );

  return { selection: imageGen.toggleState as ImageGenChoice['selection'], select };
}
