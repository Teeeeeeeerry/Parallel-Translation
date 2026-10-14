/**
 * #946：自定义元素与 label 默认按行内处理。
 *
 * 只通过采集入口和送翻文本观察结果：它们不是新的翻译单元，属于父段内容；
 * 真正的块级后代仍使父段只送浅层文字。
 */
import { beforeEach, describe, expect, test } from 'vitest';
import { collectUnits, brLines, isOverLimit, line } from './br-split-harness';

describe('#946 inline custom elements and label', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('普通段落把自定义元素与 label 内的链接文字一起送翻', () => {
    document.body.innerHTML = `
      <p id="custom">Hello there <x-tracker><a href="#">world link</a></x-tracker> again my friend.</p>
      <p id="label">Choose <label><a href="#">this linked option</a></label> now.</p>
    `;

    const { units, texts } = collectUnits();
    expect(units.map((el) => el.id)).toEqual(['custom', 'label']);
    expect(texts).toEqual([
      'Hello there world link again my friend.',
      'Choose this linked option now.',
    ]);
  });

  test('只包一个自定义元素的容器仍成为一个翻译单元', () => {
    document.body.innerHTML = '<div id="container"><x-tracker><a href="#">only a tracked link here</a></x-tracker></div>';

    const { units, texts } = collectUnits();
    expect(units.map((el) => el.id)).toEqual(['container']);
    expect(texts).toEqual(['only a tracked link here']);
  });

  test('超长 br 段落里的自定义元素不再阻止按行切块', () => {
    document.body.innerHTML = `<p id="post">${brLines(60, '<br>', (i) => (
      i % 5 === 0 ? `Line ${i}: <x-tracker><a href="#">${line(i)}</a></x-tracker>` : line(i)
    ))}</p>`;
    const post = document.querySelector('#post')!;
    expect(isOverLimit(post)).toBe(true);

    const { units, texts } = collectUnits();
    expect(units).toHaveLength(60);
    expect(texts).toHaveLength(60);
    expect(texts[0]).toContain('I never thought we would meet again');
    expect(post.querySelectorAll('[data-pt-chunk="1"]')).toHaveLength(60);
  });

  test('真正的块级子元素仍使父段只送浅层文字', () => {
    document.body.innerHTML = '<div id="parent">Before <section>nested block text</section> after</div>';

    const { units, texts } = collectUnits();
    expect(units.map((el) => el.id)).toEqual(['parent', '']);
    expect(texts).toEqual(['Before after', 'nested block text']);
  });
});
