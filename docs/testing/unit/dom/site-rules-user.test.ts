/**
 * 站点页面规则 —— 用户排除规则（#370）与用户保留原文规则（#373）
 *
 * 用户在设置页新增站点卡片、在“排除”里写选择器并保存；页面打开时
 * content script 先 await siteRulesReady() 载入用户规则，之后全页翻译
 * 与逐段翻译两个入口都按生效站点规则（内置 + 用户）排除。
 *
 * 全页翻译 —— walker 采集入口 collect()：用户排除命中的元素整块不采集。
 * 逐段翻译 —— closestUnit()（#409）：排除区内找不到段落，不出按钮。
 *
 * 排除命中段落里的行内元素时（#441），段落照常采集，该元素在提取送翻
 * 文本（translatableTextEx）时换成占位符，原文留在译文里。
 *
 * jsdom 默认 location.hostname 为 localhost，站点卡片用 localhost。
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mockAllBoundingRects, resetStorage } from '../../setup';
import { collect } from '~/src/dom/walker';
import { closestUnit } from '~/src/dom/classify';
import { translatableTextEx, restorePreserves } from '~/src/dom/text';
import { saveUserSiteRules, siteRulesReady } from '~/src/storage/specialization';
import type { SiteRules } from '~/src/storage/specialization';

const PAGE =
  '<div class="panel"><p id="side">Contributors and maintainers of the project</p></div>' +
  '<p id="body">Claude Code is an agentic <b id="bold">coding</b> tool.</p>' +
  '<p id="more">It lives in your terminal and understands your codebase.</p>';

const ids = (units: Element[]) => units.map((u) => u.id);

let restore: () => void;
beforeEach(() => {
  resetStorage();
  restore = mockAllBoundingRects();
  document.body.innerHTML = PAGE;
});
afterEach(() => {
  restore();
  document.body.innerHTML = '';
});

/** 设置页保存一张 localhost 的站点卡片，页面载入用户规则 */
async function exclude(...selectors: string[]) {
  await rules({ exclude: selectors });
}

async function rules(r: Partial<SiteRules>) {
  await saveUserSiteRules('localhost', r);
  await siteRulesReady();
}

/** 段落送去翻译的文本里保留原文的部分 */
const preserved = (id: string) => [
  ...translatableTextEx(collect().find((u) => u.id === id)!).preserves.values(),
];

describe('collect（用户排除规则）', () => {
  test('没有用户规则时照常采集', () => {
    expect(ids(collect())).toEqual(['side', 'body', 'more']);
  });

  test('命中用户排除的元素整块不采集，其余照常', async () => {
    await exclude('.panel');
    expect(ids(collect())).toEqual(['body', 'more']);
  });

  test('多条选择器都生效', async () => {
    await exclude('.panel', '#more');
    expect(ids(collect())).toEqual(['body']);
  });
});

describe('closestUnit（用户排除规则，逐段翻译入口）', () => {
  test('排除区内找不到段落', async () => {
    await exclude('#body');
    expect(closestUnit(document.getElementById('bold')!)).toBeNull();
  });

  test('排除区外照常找到段落', async () => {
    await exclude('.panel');
    expect(closestUnit(document.getElementById('bold')!)?.id).toBe('body');
  });
});

describe('collect（用户保留原文规则，#373）', () => {
  test('没有用户规则时行内元素照常翻译', () => {
    expect(preserved('body')).toEqual([]);
  });

  test('命中用户保留原文的行内元素不翻译，原文留在译文里', async () => {
    await rules({ preserve: ['#bold'] });
    expect(ids(collect())).toEqual(['side', 'body', 'more']);
    const body = collect().find((u) => u.id === 'body')!;
    const { text, preserves } = translatableTextEx(body);
    expect([...preserves.values()]).toEqual(['coding']);
    expect(text).not.toContain('coding');
  });

  test('同一元素同时命中排除与保留原文时，整块排除', async () => {
    await rules({ exclude: ['.panel'], preserve: ['.panel', '#side'] });
    expect(ids(collect())).toEqual(['body', 'more']);
    expect(closestUnit(document.getElementById('side')!)).toBeNull();
  });

  test('排除与保留原文各自命中不同元素时互不影响', async () => {
    await rules({ exclude: ['.panel'], preserve: ['#bold'] });
    expect(ids(collect())).toEqual(['body', 'more']);
    expect(preserved('body')).toEqual(['coding']);
  });
});

describe('排除越过 Shadow DOM 边界（#442）', () => {
  /** 在 parent 下挂一个 Web Component 宿主，shadow 里是 id 为 id 的段落 */
  function component(parent: Element, id: string): ShadowRoot {
    const host = document.createElement('x-card');
    parent.append(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<p id="${id}">Rendered by a <b id="${id}-b">web</b> component.</p>`;
    return root;
  }

  test('宿主在排除区内：以 shadow 里的新增节点为采集根时不采集，逐段翻译找不到', async () => {
    const root = component(document.querySelector('.panel')!, 'sp');
    await exclude('.panel');
    expect(ids(collect())).toEqual(['body', 'more']);
    // observer 增量补翻：shadow 里新增的节点是采集根
    expect(collect(root.getElementById('sp')!)).toEqual([]);
    expect(closestUnit(root.getElementById('sp-b')!)).toBeNull();
  });

  test('嵌套两层 shadowRoot 时同样在排除区内', async () => {
    const outer = document.createElement('x-shell');
    document.querySelector('.panel')!.append(outer);
    const outerRoot = outer.attachShadow({ mode: 'open' });
    outerRoot.innerHTML = '<div id="inner"></div>';
    const root = component(outerRoot.getElementById('inner')!, 'deep');
    await exclude('.panel');
    expect(collect(root.getElementById('deep')!)).toEqual([]);
    expect(closestUnit(root.getElementById('deep-b')!)).toBeNull();
  });

  test('宿主在排除区外：shadow 里的段落照常采集与找到', async () => {
    const root = component(document.getElementById('more')!.parentElement!, 'ok');
    await exclude('.panel');
    expect(ids(collect(root.getElementById('ok')!))).toEqual(['ok']);
    expect(closestUnit(root.getElementById('ok-b')!)?.id).toBe('ok');
  });
});

describe('排除命中段落内的行内元素（#441）', () => {
  test('段落照常采集，被排除的行内元素不翻译，原文留在译文句子里', async () => {
    await exclude('#bold');
    expect(ids(collect())).toEqual(['side', 'body', 'more']);
    const body = collect().find((u) => u.id === 'body')!;
    const { text, preserves } = translatableTextEx(body);
    expect(text).not.toContain('coding');
    expect([...preserves.values()]).toEqual(['coding']);

    const [ph] = [...preserves.keys()];
    const restored = restorePreserves(`Claude Code 是一个智能体式 ${ph} 工具。`, preserves, text);
    expect(restored).toBe('Claude Code 是一个智能体式 coding 工具。');
  });

  test('同时命中排除与保留原文的行内元素：结果相同', async () => {
    await rules({ exclude: ['#bold'], preserve: ['#bold'] });
    expect(ids(collect())).toEqual(['side', 'body', 'more']);
    expect(preserved('body')).toEqual(['coding']);
  });

  test('逐段翻译：起点是被排除的行内元素时找不到段落；从同段其他文字找到的段落同样保留原文', async () => {
    await exclude('#bold');
    expect(closestUnit(document.getElementById('bold')!)).toBeNull();
    const unit = closestUnit(document.getElementById('body')!)!;
    expect(unit.id).toBe('body');
    expect([...translatableTextEx(unit).preserves.values()]).toEqual(['coding']);
  });
});
