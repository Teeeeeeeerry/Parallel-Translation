/**
 * 采集结果在性能优化前后逐字节不变（#821）
 *
 * #821 给 hasTranslatableText（悬停精判与整页采集的主要开销，#737 实测七成）
 * 加了提前返回。这条用例钉住一件事：同一份 DOM，优化前后采到的单元、送翻的
 * 文字、占位符表，以及从每一个元素起做悬停精判找到的单元，逐字节一致。
 *
 * 做法：同一组夹具（端到端用的那批 HTML 页面，外加一份专门构造的、走得到
 * 慢路径的边界夹具）在优化之前跑一遍，把结果写进金标准文件
 * collect-result-stable.golden.json 一起提交；之后每次跑一遍，与它逐项比对。
 * 不只比数量。
 *
 * 要更新金标准（只在有意改变采集结果的票里做）：
 *   UPDATE_GOLDEN=1 pnpm vitest run --config docs/testing/vitest.config.ts docs/testing/unit/dom/collect-result-stable.test.ts
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import { mockAllBoundingRects, resetStorage } from '../../setup';
import { collect } from '~/src/dom/walker';
import { closestUnit } from '~/src/dom/classify';
import { unitTextEx } from '~/src/dom/text';
import { saveUserSiteRules, siteRulesReady } from '~/src/storage/specialization';

const FIXTURES = 'docs/testing/e2e/fixtures';
const GOLDEN = 'docs/testing/unit/dom/collect-result-stable.golden.json';

/**
 * 边界夹具：走得到 hasTranslatableText 慢路径的几种段落 —— 直接文字里没有
 * 可翻译字符、可翻译的文字都在行内元素里；保留原文与排除命中的行内元素；
 * 读屏隐藏与不可见的后代；只剩标点的段落；含块级子元素的混合内容。
 */
const EDGE = `
  <p id="e1">1. <a class="keep">@octocat</a></p>
  <p id="e2">— <span class="drop">hidden by exclude</span> —</p>
  <p id="e3">2024 <b>bold words only here</b></p>
  <p id="e4"><span class="sr-only">screen reader text</span> 42</p>
  <p id="e5">( <span style="display:none">invisible words</span> )</p>
  <p id="e6">Plain text with <a class="keep">@alice</a> and <span class="drop">noise</span> inside.</p>
  <p id="e7">!!! ??? ...</p>
  <p id="e8"><a class="keep">@bob</a>, <a class="keep">@carol</a></p>
  <li id="e9">Item label <ul><li>Nested child item text</li></ul></li>
  <div id="e10"><span>Only inline content in a div container.</span></div>
  <p id="e11">​<em>emphasis after a zero width space</em></p>
  <p id="e12">3 <span class="notranslate">do not translate</span></p>
  <!-- #946：默认行内的自定义元素与 label 不能触发浅层提取。 -->
  <p id="e13">Before <x-tracker><a href="#">tracked link text</a></x-tracker> after.</p>
  <div id="e14"><label><a href="#">label wrapped link text</a></label></div>
`;

/** 元素在文档里的位置：从 body 起每一层的标签与序号。 */
function pathOf(el: Element | null): string | null {
  if (!el) return null;
  const parts: string[] = [];
  for (let cur: Element | null = el; cur && cur !== document.body; cur = cur.parentElement) {
    const i = cur.parentElement ? [...cur.parentElement.children].indexOf(cur) : 0;
    parts.unshift(`${cur.tagName.toLowerCase()}[${i}]`);
  }
  return parts.join('/');
}

interface Snapshot {
  /** 整页采集到的单元：位置、送翻文字、占位符表 */
  units: { path: string | null; text: string; preserves: [string, string][] }[];
  /** 采集之后的 DOM（采集会切块，切法也要一致） */
  html: string;
  /** 从每一个元素起做悬停精判找到的单元的位置（逐个元素，与上面同一份 DOM） */
  hover: (string | null)[];
}

function snapshot(body: string): Snapshot {
  document.body.innerHTML = body;
  const restore = mockAllBoundingRects();
  // jsdom 不排版：display:none 的后代按 0×0 处理，与真实浏览器里的可见性判定同一口径
  const proto = HTMLElement.prototype as unknown as { getBoundingClientRect: () => DOMRect };
  const visible = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function (this: HTMLElement) {
    return this.closest('[style*="display:none"], [style*="display: none"]')
      ? ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 } as DOMRect)
      : visible.call(this);
  };
  try {
    const units = collect().map((u) => {
      const { text, preserves } = unitTextEx(u);
      return { path: pathOf(u), text, preserves: [...preserves] };
    });
    const html = document.body.innerHTML;
    const hover = [...document.body.querySelectorAll('*')].map((el) => pathOf(closestUnit(el)));
    return { units, html, hover };
  } finally {
    proto.getBoundingClientRect = visible;
    restore();
  }
}

/** 夹具页面的 body 内容（去掉脚本，免得 jsdom 执行它们）。 */
function fixtureBody(file: string): string {
  const html = fs.readFileSync(`${FIXTURES}/${file}`, 'utf-8');
  const body = html.slice(html.indexOf('<body') , html.lastIndexOf('</body>'));
  return body.slice(body.indexOf('>') + 1).replace(/<script[\s\S]*?<\/script>/gi, '');
}

const PAGES: Record<string, () => string> = {
  ...Object.fromEntries(
    fs
      .readdirSync(FIXTURES)
      .filter((f) => f.endsWith('.html'))
      .sort()
      .map((f) => [f, () => fixtureBody(f)]),
  ),
  'edge-cases': () => EDGE,
};

describe('采集结果逐字节不变（#821）', () => {
  const results: Record<string, Snapshot> = {};

  beforeAll(async () => {
    resetStorage();
    // 保留原文与排除各一条，夹具里的 .keep、.drop、GitHub 用户名链接都能命中
    await saveUserSiteRules('localhost', {
      preserve: ['.keep', 'a.user-mention', '[data-hovercard-url^="/users/"]'],
      exclude: ['.drop'],
    });
    await siteRulesReady();
    expect(location.hostname).toBe('localhost');
    for (const [name, body] of Object.entries(PAGES)) results[name] = snapshot(body());
    if (process.env.UPDATE_GOLDEN) fs.writeFileSync(GOLDEN, JSON.stringify(results, null, 1) + '\n');
    // 42 份页面，每份对每个元素做一次悬停精判：本机单跑约 3 秒，全量并行跑时被别的
    // worker 抢走 CPU，CI 上超过了默认的 10 秒钩子时限（只放宽时限，断言不动）
  }, 120_000);
  afterAll(() => {
    document.body.innerHTML = '';
  });

  test('金标准覆盖了全部夹具，且确实采到了东西、走到了保留原文与慢路径', () => {
    const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf-8')) as Record<string, Snapshot>;
    expect(Object.keys(golden).sort()).toEqual(Object.keys(PAGES).sort());
    const all = Object.values(golden).flatMap((s) => s.units);
    expect(all.length).toBeGreaterThan(300);
    expect(all.some((u) => u.preserves.length > 0)).toBe(true);
    // 边界夹具：慢路径两种结果都有 —— 去掉保留原文、排除与看不见的文字之后
    // 什么都不剩的段落不是单元，还剩可翻译文字的照常是单元
    const edge = new Set(golden['edge-cases']!.units.map((u) => u.text));
    expect(golden['edge-cases']!.units.length).toBeGreaterThan(3);
    expect(golden['edge-cases']!.units.length).toBeLessThan(12);
    expect([...edge].some((t) => t.includes('bold words only here'))).toBe(true);
    expect([...edge].some((t) => t.includes('invisible words'))).toBe(false);
  });

  test.each(Object.keys(PAGES))('%s：采到的单元、送翻文字、占位符、切块后的 DOM、每个元素的悬停精判，与金标准逐字节一致', (name) => {
    const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf-8')) as Record<string, Snapshot>;
    expect(JSON.stringify(results[name])).toBe(JSON.stringify(golden[name]));
  });
});
