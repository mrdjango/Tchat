import { memo } from 'react';
import { ProviderIcon } from '@librechat/client';
import type { ComponentType, SVGProps } from 'react';
import type { OwnerId } from './owners';
import { MiniMaxLogo, NvidiaLogo, MetaLogo, ZhipuLogo, QwenLogo } from './OwnerLogos';
import { getOwner } from './owners';
import { cn } from '~/utils';

const localLogos: Partial<Record<OwnerId, ComponentType<SVGProps<SVGSVGElement>>>> = {
  minimax: MiniMaxLogo,
  nvidia: NvidiaLogo,
  meta: MetaLogo,
  zhipu: ZhipuLogo,
  /** The registry's Qwen art is a navy-to-violet gradient that disappears in dark mode. */
  qwen: QwenLogo,
};

/** A representative model, so the registry picks the owner's family art (Gemini, not the G). */
const artModel: Partial<Record<OwnerId, string>> = {
  google: 'gemini',
};

interface OwnerMarkProps {
  owner: OwnerId;
  /** Tile edge in px; the logo takes a little over half of it. */
  size?: number;
  className?: string;
}

/**
 * The owner's own logo on a neutral tile, identical wherever a model is named.
 * Decorative: the owner's name is always printed beside it.
 */
function OwnerMarkComponent({ owner, size = 28, className }: OwnerMarkProps) {
  const def = getOwner(owner);
  const Logo = localLogos[owner];
  const art = Math.round(size * 0.6);

  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg border border-border-light bg-surface-primary text-text-primary',
        className,
      )}
    >
      {Logo ? (
        <Logo width={art} height={art} />
      ) : (
        <ProviderIcon provider={def.provider ?? null} model={artModel[owner]} size={art} />
      )}
    </span>
  );
}

const OwnerMark = memo(OwnerMarkComponent);
export default OwnerMark;
