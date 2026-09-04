import React from 'react';
import * as Ariakit from '@ariakit/react';
import { PinIcon } from '@librechat/client';
import { Check, ChevronRight, ImageIcon } from 'lucide-react';
import type { TImageSpec } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface ImageGenSubMenuProps extends React.HTMLAttributes<HTMLButtonElement> {
  isImageGenPinned: boolean;
  setIsImageGenPinned: (value: boolean) => void;
  /** Selected entry name, `true` for the admin default, or falsy when off. */
  imageGenSelection: boolean | string | undefined;
  imageSpecs: TImageSpec[];
  handleImageGenToggle: () => void;
  handleSelectImageSpec: (name: string) => void;
}

/**
 * One row for image generation, with the model choice nested behind it — the
 * menu keeps its length as models are added, rather than growing a row each
 * time. Mirrors the Artifacts submenu.
 */
const ImageGenSubMenu = React.forwardRef<HTMLButtonElement, ImageGenSubMenuProps>(
  (
    {
      isImageGenPinned,
      setIsImageGenPinned,
      imageGenSelection,
      imageSpecs,
      handleImageGenToggle,
      handleSelectImageSpec,
      className,
      ...props
    },
    ref,
  ) => {
    const localize = useLocalize();

    const menuStore = Ariakit.useMenuStore({
      focusLoop: true,
      showTimeout: 100,
      placement: 'right',
    });

    const isEnabled = Boolean(imageGenSelection);
    /** `true` predates the picker (or comes from a model spec): show the default. */
    const defaultSpec = imageSpecs.find((spec) => spec.default === true) ?? imageSpecs[0];
    const selectedName =
      typeof imageGenSelection === 'string' ? imageGenSelection : defaultSpec?.name;
    /** A name can outlive its config entry; the server falls back the same way. */
    const activeName = imageSpecs.some((spec) => spec.name === selectedName)
      ? selectedName
      : defaultSpec?.name;

    return (
      <>
        <Ariakit.MenuProvider store={menuStore}>
          <Ariakit.MenuButton
            ref={ref}
            {...props}
            onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
              e.stopPropagation();
              handleImageGenToggle();
            }}
            onMouseEnter={() => {
              if (isEnabled) {
                menuStore.show();
              }
            }}
            className={cn(
              'flex w-full cursor-pointer items-center justify-between rounded-lg p-2 hover:bg-surface-hover',
              className,
            )}
          >
            <div className="flex items-center gap-2">
              <ImageIcon className="icon-md" aria-hidden="true" />
              <span>{localize('com_ui_image_gen')}</span>
              {isEnabled && imageSpecs.length > 1 && (
                <ChevronRight className="ml-auto h-3 w-3" aria-hidden="true" />
              )}
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsImageGenPinned(!isImageGenPinned);
              }}
              className={cn(
                'rounded p-1 transition-all duration-200',
                'hover:bg-surface-tertiary hover:shadow-sm',
                !isImageGenPinned && 'text-text-secondary hover:text-text-primary',
              )}
              aria-label={isImageGenPinned ? 'Unpin' : 'Pin'}
            >
              <div className="h-4 w-4">
                <PinIcon unpin={isImageGenPinned} />
              </div>
            </button>
          </Ariakit.MenuButton>

          {isEnabled && imageSpecs.length > 1 && (
            <Ariakit.Menu
              portal={true}
              unmountOnHide={true}
              gutter={12}
              shift={24}
              flip="left bottom-end top-end"
              className={cn(
                'animate-popover-left z-40 flex min-w-[min(250px,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] flex-col rounded-xl',
                'border border-border-light bg-surface-secondary shadow-lg',
              )}
            >
              <div className="px-2 py-1.5">
                <div className="mb-2 text-xs font-medium text-text-secondary">
                  {localize('com_ui_model')}
                </div>
                {imageSpecs.map((spec) => (
                  <Ariakit.MenuItem
                    key={spec.name}
                    hideOnClick={false}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      handleSelectImageSpec(spec.name);
                    }}
                    className={cn(
                      'mb-1 flex items-center justify-between gap-2 rounded-lg px-2 py-2',
                      'cursor-pointer bg-surface-secondary text-text-primary outline-none transition-colors',
                      'hover:bg-surface-hover data-[active-item]:bg-surface-hover',
                      spec.name === activeName && 'bg-surface-active',
                    )}
                  >
                    <span className="text-sm">{spec.label}</span>
                    {spec.name === activeName && (
                      <Check className="h-4 w-4 text-text-secondary" aria-hidden="true" />
                    )}
                  </Ariakit.MenuItem>
                ))}
              </div>
            </Ariakit.Menu>
          )}
        </Ariakit.MenuProvider>
      </>
    );
  },
);

ImageGenSubMenu.displayName = 'ImageGenSubMenu';

export default ImageGenSubMenu;
