/**
 * storage/keys.ts — BYOK 密钥管理 单元测试
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { resetStorage } from '~/docs/testing/setup';
import { getKey, setKey, removeKey } from '~/src/storage/keys';

describe('keys', () => {
  beforeEach(() => {
    resetStorage();
  });

  test('setKey → getKey 可读回', async () => {
    await setKey('openai', 'sk-test123');
    const key = await getKey('openai');
    expect(key).toBe('sk-test123');
  });

  test('removeKey → getKey 返回 undefined', async () => {
    await setKey('openai', 'sk-test123');
    await removeKey('openai');
    const key = await getKey('openai');
    expect(key).toBeUndefined();
  });

  test('不同引擎的 key 互不干扰', async () => {
    await setKey('openai', 'sk-openai-key');
    await setKey('deepl', 'deepl-api-key');

    expect(await getKey('openai')).toBe('sk-openai-key');
    expect(await getKey('deepl')).toBe('deepl-api-key');
  });

  test('getKey 未设置引擎 → undefined', async () => {
    const key = await getKey('gemini');
    expect(key).toBeUndefined();
  });
});
