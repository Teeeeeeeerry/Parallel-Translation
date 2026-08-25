/**
 * engines/types.ts — 类型化结果（AttemptOutcome / EngineError）单元测试（#232）
 *
 * 扩张阶段：EngineError 新增类别字段（category / invalidated / aborted），
 * 旧构造签名（engineId, retryable, message）与旧字段在兼容期保持可用。
 */
import { describe, test, expect } from 'vitest';
import { EngineError } from '~/src/engines/types';
import type { AttemptOutcome, FailureCategory } from '~/src/engines/types';

describe('EngineError 类型化结果字段', () => {
  test('旧构造签名（3 参）→ 默认类别 transient，invalidated/aborted 为 false', () => {
    const e = new EngineError('gemini', true, 'HTTP 500');
    expect(e.category).toBe('transient');
    expect(e.retryable).toBe(true);
    expect(e.invalidated).toBe(false);
    expect(e.aborted).toBe(false);
    // 旧字段与属性在兼容期保持可用
    expect(e.engineId).toBe('gemini');
    expect(e.message).toBe('HTTP 500');
    expect(e.name).toBe('EngineError');
    expect(e).toBeInstanceOf(Error);
  });

  test('key 无效组合（invalid-key + retryable=false）', () => {
    const e = new EngineError('openai', false, 'API key 无效', 'invalid-key');
    expect(e.category).toBe('invalid-key');
    expect(e.retryable).toBe(false);
    expect(e.invalidated).toBe(false);
    expect(e.aborted).toBe(false);
  });

  test('配额失效组合（quota + invalidated=true）', () => {
    const e = new EngineError('deepl', false, '配额已用尽', 'quota', true);
    expect(e.category).toBe('quota');
    expect(e.retryable).toBe(false);
    expect(e.invalidated).toBe(true);
    expect(e.aborted).toBe(false);
  });

  test('已中止组合（aborted + aborted=true）', () => {
    const e = new EngineError('router', true, '已中止', 'aborted', false, true);
    expect(e.category).toBe('aborted');
    expect(e.retryable).toBe(true);
    expect(e.invalidated).toBe(false);
    expect(e.aborted).toBe(true);
  });
});

describe('AttemptOutcome 接口形状', () => {
  test('四种失败类别均可构造类型化结果', () => {
    const categories: FailureCategory[] = [
      'invalid-key',
      'quota',
      'transient',
      'aborted',
    ];
    for (const category of categories) {
      const outcome: AttemptOutcome = {
        category,
        retryable: category === 'transient',
        invalidated: category === 'quota',
        aborted: category === 'aborted',
      };
      expect(outcome.category).toBe(category);
      expect(Object.keys(outcome).sort()).toEqual([
        'aborted',
        'category',
        'invalidated',
        'retryable',
      ]);
    }
  });
});
