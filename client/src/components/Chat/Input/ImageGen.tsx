import React, { memo, useMemo } from 'react';
import { ImageIcon } from 'lucide-react';
import { CheckboxButton } from '@librechat/client';
import { useLocalize, useImageGenAvailable } from '~/hooks';
import { useGetStartupConfig } from '~/data-provider';
import { useBadgeRowContext } from '~/Providers';
import { badgeAccents } from './accents';

function ImageGen() {
  const localize = useLocalize();
  const context = useBadgeRowContext();
  const { toggleState: imageGenSelection, debouncedChange, isPinned } = context?.imageGen ?? {};
  const isAvailable = useImageGenAvailable();
  const { data: startupConfig } = useGetStartupConfig();

  const imageSpecs = useMemo(
    () => startupConfig?.modelSpecs?.imageList ?? [],
    [startupConfig?.modelSpecs?.imageList],
  );

  /** With several models configured the badge names the active one, so the chat
   *  input always says what a generated image will come from. */
  const label = useMemo(() => {
    if (imageSpecs.length < 2) {
      return localize('com_ui_image_gen');
    }
    const fallback = imageSpecs.find((spec) => spec.default === true) ?? imageSpecs[0];
    const selected =
      typeof imageGenSelection === 'string'
        ? (imageSpecs.find((spec) => spec.name === imageGenSelection) ?? fallback)
        : fallback;
    return selected?.label ?? localize('com_ui_image_gen');
  }, [imageSpecs, imageGenSelection, localize]);

  if (!isAvailable) {
    return null;
  }

  return (
    <>
      {(Boolean(imageGenSelection) || isPinned) && (
        <CheckboxButton
          checked={Boolean(imageGenSelection)}
          setValue={debouncedChange}
          label={label}
          isCheckedClassName={badgeAccents.purple}
          icon={<ImageIcon className="icon-md" />}
        />
      )}
    </>
  );
}

export default memo(ImageGen);
