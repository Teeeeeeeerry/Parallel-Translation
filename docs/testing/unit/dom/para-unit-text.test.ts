/**
 * 逐段翻译与整页翻译送翻同样的文字（#1137）
 *
 * 翻译单元的判定（#23）收下“自己有直接文字、下面又有带文字的块级子元素”的
 * 元素。整页翻译只取它的直接文字，子块各自作为单元另外采集；逐段翻译原先
 * 把子块的文字一起送翻 —— 取文函数要调用方自己传“只取直接文字”，逐段那条
 * 路径没传。
 *
 * 逐段翻译的取文是 closestUnit → unitTextEx（内容脚本 translateOne），整页是
 * collect → buildPageItem。
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { mockAllBoundingRects, resetStorage } from '../../setup';
import { collect } from '~/src/dom/walker';
import { closestUnit } from '~/src/dom/classify';
import { unitTextEx } from '~/src/dom/text';
import { buildPageItem } from '~/src/dom/page-dom';
import { siteRulesReady } from '~/src/storage/specialization';
import { unitRules } from '~/src/dom/rules-snapshot';

const FIXTURES = 'docs/testing/e2e/fixtures';

beforeEach(async () => {
  resetStorage();
  await siteRulesReady();
});
afterEach(() => {
  document.body.innerHTML = '';
});

function withRects<T>(fn: () => T): T {
  const restore = mockAllBoundingRects();
  try {
    return fn();
  } finally {
    restore();
  }
}

/** 夹具页面的 body 内容（去掉脚本，免得 jsdom 执行它们）。 */
function fixtureBody(file: string): string {
  const html = fs.readFileSync(`${FIXTURES}/${file}`, 'utf-8');
  const body = html.slice(html.indexOf('<body'), html.lastIndexOf('</body>'));
  return body.slice(body.indexOf('>') + 1).replace(/<script[\s\S]*?<\/script>/gi, '');
}

describe('逐段翻译的取文（#1137）', () => {
  test('自己有直接文字、下面又有带文字的块级子元素：逐段只取直接文字，不含子块文字', () => {
    document.body.innerHTML =
      '<ul><li id="mixed">Parent label text here <ul><li>Nested child item text</li></ul></li></ul>';
    const unit = withRects(() => closestUnit(document.getElementById('mixed')!));
    expect(unit?.id).toBe('mixed');
    const text = withRects(() => unitTextEx(unit!, unitRules(unit!)).text);
    expect(text).toBe('Parent label text here');
    expect(text).not.toContain('Nested child item text');
  });

  const pages = fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.html')).sort();

  test.each(pages)('%s：每个采集出的单元，逐段取文与整页取文相同', (file) => {
    document.body.innerHTML = fixtureBody(file);
    withRects(() => {
      for (const unit of collect()) {
        const { text, ctx: { preserves } } = buildPageItem(unit);
        const para = unitTextEx(unit, unitRules(unit));
        expect(para.text).toBe(text);
        expect([...para.preserves]).toEqual([...preserves]);
      }
    });
  });
});
