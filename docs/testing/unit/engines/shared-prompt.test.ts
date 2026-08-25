/**
 * engines/shared.ts — buildNumberedPrompt 公共模板 单元测试（#240）
 *
 * 断言：编号顺序、换行转义（归一化）、与编号解析函数 parseNumbered
 * 往返一致、与现有逐字实现格式一致（含源语言段）。
 */
import { describe, test, expect } from 'vitest';
import { buildNumberedPrompt } from '~/src/engines/shared';
import { parseNumbered } from '~/src/engines/openai';

describe('buildNumberedPrompt — 编号格式', () => {
  test('编号顺序：1..N 递增，\n 分隔', () => {
    const prompt = buildNumberedPrompt('zh-CN', 'en', ['Hello', 'World', '!']);
    const numbered = prompt.split('\n\n')[1]!;
    expect(numbered).toBe('1. Hello\n2. World\n3. !');
  });

  test('转义：文本自带换行被归一化为空格，不撑破编号结构（#160）', () => {
    const prompt = buildNumberedPrompt('zh', 'auto', ['line1\nline2', 'a\nb\nc']);
    const numbered = prompt.split('\n\n')[1]!;
    expect(numbered).toBe('1. line1 line2\n2. a b c');
    expect(numbered).not.toContain('\nline');
  });

  test('头部指令：目标语言 + 源语言段（非 auto）', () => {
    const prompt = buildNumberedPrompt('zh-CN', 'en', ['Hello']);
    expect(prompt.startsWith('将以下编号文本翻译成zh-CN（源语言：en）。')).toBe(
      true,
    );
    expect(prompt).toContain('严格保持编号与行数一致，只输出译文，不要解释。');
  });

  test('from=auto → 头部不带源语言段', () => {
    const prompt = buildNumberedPrompt('zh', 'auto', ['Hello']);
    expect(prompt.startsWith('将以下编号文本翻译成zh。')).toBe(true);
    expect(prompt).not.toContain('源语言');
  });

  test('空文本数组 → 只有头部指令与空编号段', () => {
    const prompt = buildNumberedPrompt('zh', 'auto', []);
    expect(prompt.endsWith('\n\n')).toBe(true);
  });
});

describe('buildNumberedPrompt — 与 parseNumbered 往返一致', () => {
  test('LLM 回显编号 → parseNumbered 还原原文顺序', () => {
    const texts = ['Hello world', 'Second line', 'Third'];
    const prompt = buildNumberedPrompt('zh', 'en', texts);
    const numbered = prompt.split('\n\n')[1]!;
    // 模拟 LLM 严格回显编号结构（只改译文不动编号）
    const out = parseNumbered(numbered, texts.length);
    expect(out).toEqual(texts);
  });

  test('LLM 重排/漏行 → parseNumbered 按编号回填，不错位', () => {
    const texts = ['A', 'B', 'C', 'D'];
    const prompt = buildNumberedPrompt('zh', 'en', texts);
    const numbered = prompt.split('\n\n')[1]!;
    // LLM 只回 1、3、4 行（漏 2），且顺序打乱
    const llmOut = ['3. C', '1. A', '4. D'];
    const out = parseNumbered(llmOut.join('\n'), texts.length);
    expect(out).toEqual(['A', '', 'C', 'D']);
  });
});
