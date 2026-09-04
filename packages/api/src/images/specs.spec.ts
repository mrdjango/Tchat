import type { TImageSpec } from 'librechat-data-provider';
import { resolveImageSpec } from './specs';

const list: TImageSpec[] = [
  { name: 'gpt-image', label: 'GPT Image', model: 'gpt-image-2', protocol: 'openai' },
  {
    name: 'gemini-image',
    label: 'Gemini Image',
    model: 'gemini-3-pro-image-c',
    protocol: 'gemini',
    default: true,
  },
];

describe('resolveImageSpec', () => {
  it('is null when the user has not asked for images', () => {
    expect(resolveImageSpec(undefined, list)).toBeNull();
    expect(resolveImageSpec(false, list)).toBeNull();
  });

  it('equips the tool that serves the named entry', () => {
    expect(resolveImageSpec('gemini-image', list)).toEqual({
      toolName: 'gemini_image_gen',
      model: 'gemini-3-pro-image-c',
      spec: list[1],
    });
    expect(resolveImageSpec('gpt-image', list)).toEqual({
      toolName: 'image_gen_oai',
      model: 'gpt-image-2',
      spec: list[0],
    });
  });

  it('treats `true` as the admin default, so conversations predating the picker keep working', () => {
    expect(resolveImageSpec(true, list)?.model).toBe('gemini-3-pro-image-c');
  });

  it('falls back to the default when the named entry was removed from config', () => {
    expect(resolveImageSpec('deleted-entry', list)?.model).toBe('gemini-3-pro-image-c');
  });

  it('uses the first entry when none is marked default', () => {
    const unmarked = list.map((s) => ({ ...s, default: undefined }));
    expect(resolveImageSpec(true, unmarked)?.model).toBe('gpt-image-2');
  });

  it('keeps pre-picker behaviour when no list is configured', () => {
    expect(resolveImageSpec(true, undefined)).toEqual({ toolName: 'image_gen_oai' });
  });
});
