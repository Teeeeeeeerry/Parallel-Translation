/**
 * 非正文区域、扩展自己的 UI、已翻译的单元不计入跳过（#756，规格 #727）
 *
 * 导航、页脚、侧栏、参考文献本来就不该翻；扩展自己插的译文与界面本来就
 * 不该被翻，算进去等于自己制造噪声；已翻译的单元在增量补翻时会反复经过
 * 采集，更不能每轮都计一次。
 *
 * 切入点只有采集入口 collect。每条都在同一页里放一段真正超长的段落做反向：
 * 该计入的仍然计入。
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mockAllBoundingRects } from '../../setup';
import { collect, type SkipCategory } from '~/src/dom/walker';

const TOO_LONG = `<p id="long">${'This sentence keeps going on and on. '.repeat(100)}</p>`;

let restore: () => void;
beforeEach(() => {
  restore = mockAllBoundingRects();
});
afterEach(() => {
  restore();
  document.body.innerHTML = '';
});

function run(root: Node = document.body) {
  const skipped: [string, SkipCategory][] = [];
  const units = collect(root, undefined, { onSkip: (el, category) => skipped.push([el.id, category]) });
  return { units: units.map((u) => u.id), skipped };
}

describe('不计入跳过（#756）', () => {
  test('非正文区域：导航、页脚、侧栏、参考文献里的段落都不算；同页超长段落仍算', () => {
    document.body.innerHTML =
      '<nav><p id="nav">Home, pricing, documentation and blog.</p></nav>' +
      '<p id="a">A normal paragraph with some words.</p>' +
      '<aside><p id="side">Related articles you might like.</p></aside>' +
      '<ol class="references"><li id="ref">Smith, J. (2020). A study of things.</li></ol>' +
      '<footer><p id="foot">Copyright notice and license terms.</p></footer>' +
      TOO_LONG;
    expect(run()).toEqual({ units: ['a'], skipped: [['long', 'too-long']] });
  });

  test('非正文区域里的段落即使超长也不算：先命中非正文区', () => {
    document.body.innerHTML = '<p id="a">A normal paragraph with some words.</p>' + `<nav>${TOO_LONG}</nav>`;
    expect(run()).toEqual({ units: ['a'], skipped: [] });
  });

  test('扩展自己的 UI：在扩展界面里采集，里面的文字不算跳过；同页超长段落仍算', () => {
    document.body.innerHTML =
      '<div data-pt-ui="1"><div id="panel"><p id="ui">Translate this page</p>' + TOO_LONG + '</div></div>';
    // 扩展 UI 的宿主本身由遍历整棵跳过；从宿主里面的节点起采，才会走到这条判定
    expect(run(document.getElementById('panel')!)).toEqual({ units: [], skipped: [] });

    document.body.innerHTML = '<p id="a">A normal paragraph with some words.</p>' + TOO_LONG;
    expect(run().skipped).toEqual([['long', 'too-long']]);
  });

  test('已翻译的单元与它的原文不算；增量补翻反复采集，每一轮都是零；同页超长段落仍算', () => {
    document.body.innerHTML =
      '<p id="done" data-pt="done"><span class="pt-origin"><span id="orig">Hello world, this is the original.</span></span>' +
      '<span class="pt-trans">你好世界，这是译文。</span></p>' +
      '<p id="a">A normal paragraph with some words.</p>' +
      TOO_LONG;
    for (let round = 0; round < 3; round++) {
      expect(run()).toEqual({ units: ['a'], skipped: [['long', 'too-long']] });
    }
  });
});
