import type { TImageSpec } from 'librechat-data-provider';
import { geminiToolkit } from '~/tools/toolkits/gemini';
import { oaiToolkit } from '~/tools/toolkits/oai';

export interface ResolvedImageSpec {
  /** Toolkit key to equip; its edit half follows through `toolkitExpansion`. */
  toolName: string;
  /** Model id for that tool, or undefined to keep the tool's env default. */
  model?: string;
  /** The entry the selection resolved to, absent when none is configured. */
  spec?: TImageSpec;
}

const toolNameFor = (spec: TImageSpec): string =>
  spec.protocol === 'gemini' ? geminiToolkit.gemini_image_gen.name : oaiToolkit.image_gen_oai.name;

/**
 * Which image tool and model a request should use.
 *
 * `selection` is an entry name from `modelSpecs.imageList`, or `true` for the
 * default entry — which is what conversations saved before the picker existed
 * carry, and what a model spec's `imageGen` flag means.
 *
 * With no list configured the OpenAI toolkit is equipped on its env-configured
 * model, so a deployment that never adopts the picker behaves as it did before
 * it existed. An unknown name falls back to the default rather than failing the
 * turn: the list is admin config that can change under a saved conversation,
 * and quietly using the current default beats losing image generation.
 */
export function resolveImageSpec(
  selection: boolean | string | undefined,
  imageList: TImageSpec[] | undefined,
): ResolvedImageSpec | null {
  if (selection == null || selection === false) {
    return null;
  }

  if (!imageList?.length) {
    return { toolName: oaiToolkit.image_gen_oai.name };
  }

  const named =
    typeof selection === 'string' ? imageList.find((s) => s.name === selection) : undefined;
  const spec = named ?? imageList.find((s) => s.default === true) ?? imageList[0];

  return { toolName: toolNameFor(spec), model: spec.model, spec };
}
