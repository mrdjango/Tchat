import { useMemo } from 'react';
import { EModelEndpoint } from 'librechat-data-provider';
import type { TPlugin } from 'librechat-data-provider';
import { useAvailableToolsQuery } from '~/data-provider';

/** Toolkit the server equips when `ephemeralAgent.image_gen` is set. */
export const IMAGE_GEN_TOOL_KEY = 'image_gen_oai';

/**
 * Whether this deployment configured the OpenAI image toolkit. The tool throws
 * on a missing key rather than degrading, so the chat input must not offer it
 * where no key is configured.
 */
export default function useImageGenAvailable(): boolean {
  const { data: tools } = useAvailableToolsQuery(EModelEndpoint.agents);
  return useMemo(
    () => (tools ?? []).some((tool: TPlugin) => tool.pluginKey === IMAGE_GEN_TOOL_KEY),
    [tools],
  );
}
