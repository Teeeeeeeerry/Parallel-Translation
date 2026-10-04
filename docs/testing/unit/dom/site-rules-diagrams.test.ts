/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url": "https://app.diagrams.net/"}
 */
/**
 * 站点页面规则 —— diagrams.net 的内置排除（#631）
 *
 * draw.io 编辑器的外壳（图形面板、格式面板、菜单栏、工具栏、对话框）
 * 全是界面文字：鼠标移过去不该浮出逐段翻译按钮，误点翻译整页也不该
 * 送去翻。格式面板的分区标题（div.geCollapsibleTitle）不在 SVG 里，
 * foreignObject 通用判定（#630）管不到，只能按站点排除。
 *
 * 按编辑器容器排除，不按每条标题的 class 排除；走数据层（ADR-0003）。
 * 键取裸域名 diagrams.net，子域（app.、viewer.、embed.）按既有匹配
 * 语义归入。
 *
 * 全页翻译 —— collect()；逐段翻译 —— closestUnit()，分别验证。
 * jsdom 的 location.hostname 是文件级选项，与其他域名的测试文件分离。
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mockAllBoundingRects, resetStorage } from '../../setup';
import { collect } from '~/src/dom/walker';
import { closestUnit } from '~/src/dom/classify';
import {
  getSiteRules,
  setBuiltinSiteRulesDisabled,
  siteRulesReady,
} from '~/src/storage/specialization';

const ids = (units: Element[]) => units.map((u) => u.id);
const $ = (id: string) => document.getElementById(id)!;

/** 编辑器外壳五类容器，每个里面一条界面文字；外面一段正文。 */
const EDITOR =
  '<div class="geMenubarContainer"><div id="menu" class="geMenubar"><a class="geItem">Extras and plugins menu</a></div></div>' +
  '<div class="geToolbarContainer"><div id="toolbar" class="geToolbar">Zoom in or zoom out</div></div>' +
  '<div class="geSidebarContainer"><div id="shapes" class="geTitle">General shapes and connectors</div></div>' +
  '<div class="geFormatContainer"><div id="paper" class="geCollapsibleTitle">Paper size and orientation</div></div>' +
  '<div class="geDialog"><p id="dialog">Save your diagram before closing</p></div>' +
  '<p id="body">A short note outside the editor shell.</p>';

const PANEL_IDS = ['menu', 'toolbar', 'shapes', 'paper', 'dialog'];

let restore: () => void;
beforeEach(async () => {
  resetStorage();
  restore = mockAllBoundingRects();
  await siteRulesReady();
});
afterEach(() => {
  restore();
  document.body.innerHTML = '';
});

describe('collect（diagrams.net 内置排除）', () => {
  test('编辑器外壳五类容器里的文字都不采集，容器外的正文照常采集', () => {
    document.body.innerHTML = EDITOR;
    expect(ids(collect())).toEqual(['body']);
  });

  test('没有编辑器容器的页面（同域名下的普通页面）不受影响', () => {
    document.body.innerHTML =
      '<h1 id="h">Getting started with diagrams</h1>' +
      '<p id="p1">Draw.io is a free online diagram editor.</p>' +
      '<div class="geTitle" id="t">A title that is not inside any editor panel</div>';
    expect(ids(collect())).toEqual(['h', 'p1', 't']);
  });
});

describe('closestUnit（diagrams.net 内置排除）', () => {
  test('起点在编辑器外壳里时找不到单元，不出按钮也不翻译', () => {
    document.body.innerHTML = EDITOR;
    for (const id of PANEL_IDS) expect(closestUnit($(id)), id).toBeNull();
  });

  test('编辑器外壳之外的正文照常找到单元', () => {
    document.body.innerHTML = EDITOR;
    expect(closestUnit($('body'))?.id).toBe('body');
  });
});

describe('匹配与停用', () => {
  test('裸域名的规则覆盖 app.、viewer.、embed. 等子域', () => {
    for (const host of ['app.diagrams.net', 'viewer.diagrams.net', 'embed.diagrams.net', 'diagrams.net']) {
      expect(getSiteRules(host).exclude, host).toContain('.geFormatContainer');
    }
  });

  test('在设置页停用这个站点的内置规则后，编辑器界面文字重新可以翻译', async () => {
    document.body.innerHTML = EDITOR;
    await setBuiltinSiteRulesDisabled('diagrams.net', true);
    expect(ids(collect())).toEqual([...PANEL_IDS, 'body']);
    expect(closestUnit($('paper'))?.id).toBe('paper');
  });
});
