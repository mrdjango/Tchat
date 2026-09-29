import type { TImageSpec } from 'librechat-data-provider';
import { createModelCatalog, guessModelCategory } from '../useModelCatalog';
import { matchImageSpec } from '../useRepairImageModelChat';

/** The OpenAI and Gemini entries of deploy/tchat/librechat.yaml's imageList. */
const imageSpecs = [
  { name: 'gpt-image', label: 'GPT Image', model: 'gpt-image-2', default: true },
  { name: 'gemini-image', label: 'Gemini Image', model: 'gemini-3-pro-image-c' },
  { name: 'gpt-image-2-hd', label: 'GPT Image 2 · HD', model: 'gpt-image-2-h' },
  { name: 'gpt-image-2-5', label: 'GPT Image 2.5', model: 'gpt-image-2.5-c' },
  {
    name: 'gemini-3-1-flash-image',
    label: 'Gemini 3.1 Flash Image',
    model: 'gemini-3.1-flash-image',
  },
  {
    name: 'gemini-3-1-flash-image-preview',
    label: 'Gemini 3.1 Flash Image Preview',
    model: 'gemini-3.1-flash-image-preview',
  },
] as TImageSpec[];

describe('guessModelCategory', () => {
  it.each([
    ['gemini-3.1-flash-image-c', 'image'],
    ['gpt-image-2-4k', 'image'],
    ['dall-e-3', 'image'],
    ['text-embedding-3-small', 'embeddings'],
    ['openai/gpt-4o-mini-transcribe', 'transcription'],
    ['openai/whisper-large-v3-turbo', 'transcription'],
    ['qwen3-asr-flash-2026-02-10', 'transcription'],
    ['kokoro-tts', 'audio'],
    ['minimax-speech-2-8-hd', 'audio'],
    ['minimax-music-3-0', 'audio'],
  ])('%s → %s', (model, category) => {
    expect(guessModelCategory(model)).toBe(category);
  });

  it.each([
    'gpt-5.6-terra',
    'claude-sonnet-5',
    'gemini-3.1-pro-low',
    'Qwen/Qwen3.6-35B-A3B-FP8',
    'deepseek-ai/deepseek-v4-pro-0813',
    'minimaxai/minimax-m3',
  ])('%s is assumed to chat', (model) => {
    expect(guessModelCategory(model)).toBeNull();
  });
});

describe('createModelCatalog', () => {
  it('lets the catalog category win over the id', () => {
    const catalog = createModelCatalog({ categories: { 'odd-image-chat': 'language' } });
    expect(catalog.isChatModel('odd-image-chat')).toBe(true);
  });

  it('falls back to the id for models the catalog does not list', () => {
    const catalog = createModelCatalog({ categories: {} });
    expect(catalog.isChatModel('gemini-3.1-flash-image-c')).toBe(false);
    expect(catalog.isImageModel('gemini-3.1-flash-image-c')).toBe(true);
    expect(catalog.isChatModel('some-new-chat-model')).toBe(true);
  });

  it('is not ready until the catalog answers', () => {
    expect(createModelCatalog(undefined).ready).toBe(false);
    expect(createModelCatalog({}).ready).toBe(true);
  });
});

describe('matchImageSpec', () => {
  const { isImageModel } = createModelCatalog({ categories: {} });

  it.each([
    /** The three models saved chats in production are stuck on. */
    ['gpt-image-2', 'gpt-image'],
    ['gpt-image-2-4k', 'gpt-image'],
    ['gemini-3.1-flash-image-c', 'gemini-3-1-flash-image'],
    ['gpt-image-2.5-c', 'gpt-image-2-5'],
    /** An image model with no family entry gets the default. */
    ['dall-e-3', 'gpt-image'],
  ])('%s → %s', (model, spec) => {
    expect(matchImageSpec(model, imageSpecs, isImageModel)?.name).toBe(spec);
  });

  it('matches nothing for a model that is not an image model', () => {
    expect(matchImageSpec('text-embedding-3-small', imageSpecs, isImageModel)).toBeNull();
  });
});
