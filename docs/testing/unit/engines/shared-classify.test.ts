/**
 * engines/shared.ts — classifyStatus 公共判定 单元测试（#239）
 *
 * 表驱动：状态码 × 各引擎 → 失败类别。自带 key 引擎的 401/403 →
 * invalid-key、429 → quota、其余非 2xx → transient；免 key 引擎一律
 * transient（bing-edge 401 会话失效仍可重试）。
 */
import { describe, test, expect } from 'vitest';
import { classifyStatus } from '~/src/engines/shared';
import type { FailureCategory } from '~/src/engines/types';

interface Case {
  engineId: string;
  status: number;
  hasKey: boolean;
  expected: FailureCategory;
}

const KEYED_CASES: Case[] = [
  { engineId: 'openai', status: 401, hasKey: true, expected: 'invalid-key' },
  { engineId: 'openai', status: 403, hasKey: true, expected: 'invalid-key' },
  { engineId: 'openai', status: 429, hasKey: true, expected: 'quota' },
  { engineId: 'openai', status: 500, hasKey: true, expected: 'transient' },
  { engineId: 'openai', status: 503, hasKey: true, expected: 'transient' },
  { engineId: 'deepl', status: 401, hasKey: true, expected: 'invalid-key' },
  { engineId: 'deepl', status: 403, hasKey: true, expected: 'invalid-key' },
  { engineId: 'deepl', status: 429, hasKey: true, expected: 'quota' },
  { engineId: 'deepl', status: 500, hasKey: true, expected: 'transient' },
  { engineId: 'gemini', status: 401, hasKey: true, expected: 'invalid-key' },
  { engineId: 'gemini', status: 403, hasKey: true, expected: 'invalid-key' },
  { engineId: 'gemini', status: 429, hasKey: true, expected: 'quota' },
  { engineId: 'gemini', status: 500, hasKey: true, expected: 'transient' },
];

const KEYLESS_CASES: Case[] = [
  { engineId: 'google-web', status: 401, hasKey: true, expected: 'transient' },
  { engineId: 'google-web', status: 403, hasKey: true, expected: 'transient' },
  { engineId: 'google-web', status: 429, hasKey: true, expected: 'transient' },
  { engineId: 'google-web', status: 500, hasKey: true, expected: 'transient' },
  // bing-edge 401 是会话失效：仍瞬时可重试（清 JWT 逻辑在适配器内）
  { engineId: 'bing-edge', status: 401, hasKey: true, expected: 'transient' },
  { engineId: 'bing-edge', status: 403, hasKey: true, expected: 'transient' },
  { engineId: 'bing-edge', status: 429, hasKey: true, expected: 'transient' },
  { engineId: 'bing-edge', status: 500, hasKey: true, expected: 'transient' },
];

describe('classifyStatus 表驱动', () => {
  for (const c of KEYED_CASES) {
    test(`${c.engineId} ${c.status} → ${c.expected}`, () => {
      expect(classifyStatus(c.engineId, { status: c.status }, c.hasKey)).toBe(
        c.expected,
      );
    });
  }

  for (const c of KEYLESS_CASES) {
    test(`${c.engineId} ${c.status} → ${c.expected}（免 key 引擎）`, () => {
      expect(classifyStatus(c.engineId, { status: c.status }, c.hasKey)).toBe(
        c.expected,
      );
    });
  }

  test('自带 key 引擎但请求未携带 key → 一律 transient（不判 key 无效）', () => {
    for (const engineId of ['openai', 'deepl', 'gemini']) {
      expect(classifyStatus(engineId, { status: 401 }, false)).toBe('transient');
      expect(classifyStatus(engineId, { status: 429 }, false)).toBe('transient');
    }
  });
});
