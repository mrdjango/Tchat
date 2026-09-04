import React, { memo } from 'react';
import { ImageIcon } from 'lucide-react';
import { CheckboxButton } from '@librechat/client';
import { useLocalize, useImageGenAvailable } from '~/hooks';
import { useBadgeRowContext } from '~/Providers';
import { badgeAccents } from './accents';

function ImageGen() {
  const localize = useLocalize();
  const context = useBadgeRowContext();
  const { toggleState: imageGenEnabled, debouncedChange, isPinned } = context?.imageGen ?? {};
  const isAvailable = useImageGenAvailable();

  if (!isAvailable) {
    return null;
  }

  return (
    <>
      {(imageGenEnabled || isPinned) && (
        <CheckboxButton
          checked={imageGenEnabled}
          setValue={debouncedChange}
          label={localize('com_ui_image_gen')}
          isCheckedClassName={badgeAccents.purple}
          icon={<ImageIcon className="icon-md" />}
        />
      )}
    </>
  );
}

export default memo(ImageGen);
