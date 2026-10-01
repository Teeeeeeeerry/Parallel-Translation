/**
 * 提取送翻文本时跳过不可见的后代（#600）
 *
 * 段落里 display:none 的后代（未打开的悬停提示、未展开的菜单、hidden 属性
 * 的元素）眼睛看不到，但原先照样进入送翻文本，译文里就多出这段文字 ——
 * GitHub 置顶仓库卡片的提示写着仓库名，译文里仓库名重复一次（#598）。
 * 现在与读屏隐藏文字（#595）一样跳过：不送翻，原文留在原位，回填时也
 * 不出现在译文里。
 *
 * “不可见”沿用翻译单元的可见性判定：渲染尺寸宽高都为 0，display:contents
 * 除外（#179）。只在翻译单元本身可见时跳过它里面不可见的后代 —— 单元
 * 本身不可见时（#23 的延迟补翻，或采集后又被隐藏）行为不变。
 *
 * 全页翻译 —— walker 采集入口 collect()；逐段翻译 —— closestUnit()（#409）：
 * 段落去掉不可见的后代之后没有可翻译的文字，不算翻译单元（判定位置与
 * #454、#595 相同）。文本提取（translatableTextEx / shallowTranslatableTextEx）
 * 两个入口共用。
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mockAllBoundingRects, mockBoundingRect } from '../../setup';
import { collect } from '~/src/dom/walker';
import { closestUnit } from '~/src/dom/classify';
import { translatableTextEx, shallowTranslatableTextEx } from '~/src/dom/text';

const ids = (units: Element[]) => units.map((u) => u.id);

/** 把页面里的 .hidden 元素设成宽高都为 0 —— 与浏览器里 display:none 的结果一致 */
function hide() {
  for (const el of document.querySelectorAll('.hidden')) mockBoundingRect(el, { width: 0, height: 0 });
}

let restore: () => void;
beforeEach(() => {
  restore = mockAllBoundingRects();
});
afterEach(() => {
  restore();
  document.body.innerHTML = '';
});

describe('文本提取：不可见的后代不进入送翻文本（#600）', () => {
  test('完整提取：段落里未打开的提示不送翻', () => {
    document.body.innerHTML =
      '<p id="p">Open the <a href="/settings">settings page</a><span class="hidden">Opens in a new tab</span> to continue.</p>';
    hide();
    const { text } = translatableTextEx(document.getElementById('p')!);
    expect(text).toContain('settings page');
    expect(text).toContain('to continue.');
    expect(text).not.toContain('Opens in a new tab');
  });

  test('浅层提取：含块级子项的段落里未展开的内容不送翻', () => {
    document.body.innerHTML =
      '<li id="parent">Project files <span class="hidden">collapsed summary text</span>' +
      '<ul><li>Follow-up item for the next release</li></ul></li>';
    hide();
    const { text } = shallowTranslatableTextEx(document.getElementById('parent')!);
    expect(text).toContain('Project files');
    expect(text).not.toContain('collapsed summary text');
  });

  test('display:contents 的后代（宽高为 0 但内容照常渲染）照常送翻', () => {
    document.body.innerHTML =
      '<p id="p">Read the <span id="c" style="display: contents">release notes</span> before upgrading.</p>';
    mockBoundingRect(document.getElementById('c')!, { width: 0, height: 0 });
    expect(translatableTextEx(document.getElementById('p')!).text).toContain('release notes');
  });

  test('段落本身不可见时不跳过它的后代（采集后又被隐藏的段落，行为不变）', () => {
    document.body.innerHTML = '<p id="p" class="hidden">Hidden paragraph <b class="hidden">with bold text</b> inside.</p>';
    hide();
    expect(translatableTextEx(document.getElementById('p')!).text).toContain('with bold text');
  });
});

describe('采集：只有不可见内容的段落不算翻译单元（#600）', () => {
  test('段落里只有未打开的提示：不采集，也找不到段落', () => {
    document.body.innerHTML =
      '<p id="tip"><span class="hidden" id="h">Copied to the clipboard</span></p><p id="body">Body text here.</p>';
    hide();
    expect(ids(collect())).toEqual(['body']);
    expect(closestUnit(document.getElementById('h')!)).toBeNull();
  });

  test('可见文字旁有未打开的提示：照常采集，在可见文字上能找到段落', () => {
    document.body.innerHTML =
      '<p id="p"><b id="b">Copy the path</b><span class="hidden">Copied to the clipboard</span></p>';
    hide();
    expect(ids(collect())).toEqual(['p']);
    expect(closestUnit(document.getElementById('b')!)?.id).toBe('p');
  });
});
