/**
 * 站点页面规则 —— 运行时无效选择器只跳过自身（#368）
 *
 * ADR-0003：坏规则两头拦，运行时解析失败的选择器只跳过它自己，不影响
 * 其他选择器和其他规则，避免重演 #93 —— 一条带尾随逗号的无效选择器让
 * GitHub 整页采集 0 个单元。
 *
 * 内置数据里不会有无效选择器，本文件用 vi.mock 换入测试规则。
 * jsdom 默认 location.hostname 为 localhost，规则键用 localhost。
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockAllBoundingRects } from '../../setup';
import type { SiteRules } from '~/src/storage/specialization';

const rules = vi.hoisted(() => ({}) as Record<string, Partial<SiteRules>>);
vi.mock('~/src/storage/builtin-site-rules', () => ({ BUILTIN_SITE_RULES: rules }));

import { collect } from '~/src/dom/walker';
import { closestUnit } from '~/src/dom/classify';
import { getSiteRules } from '~/src/storage/specialization';
import { translatableTextEx } from '~/src/dom/text';

/** #93 的原始形态：数组拼接前的逐行字符串带出尾随逗号 */
const TRAILING_COMMA = '.repository-lang-stats,';

const PAGE =
  '<div class="panel"><p id="panel">Contributors and sponsors</p></div>' +
  '<div class="repository-lang-stats"><p id="lang">Python and Shell</p></div>' +
  '<p id="body">Claude Code is an agentic coding tool.</p>';

const ids = (units: Element[]) => units.map((u) => u.id);

let restore: () => void;
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  restore = mockAllBoundingRects();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  document.body.innerHTML = PAGE;
});
afterEach(() => {
  restore();
  warn.mockRestore();
  for (const k of Object.keys(rules)) delete rules[k];
  document.body.innerHTML = '';
});

describe('collect（规则里混入无效选择器）', () => {
  test('其余选择器照常生效，采集结果与去掉无效选择器时一致', () => {
    rules['localhost'] = { exclude: ['.panel'] };
    const without = ids(collect());

    rules['localhost'] = { exclude: ['.panel', TRAILING_COMMA] };
    const withInvalid = ids(collect());

    expect(without).toEqual(['lang', 'body']);
    expect(withInvalid).toEqual(without);
  });

  test('无效选择器排在前面也只跳过它自己', () => {
    rules['localhost'] = { exclude: [TRAILING_COMMA, '.panel'] };
    expect(ids(collect())).toEqual(['lang', 'body']);
  });

  test('采集根为元素（observer 增量补翻）时不抛出', () => {
    rules['localhost'] = { exclude: [TRAILING_COMMA, '.panel'] };
    const lang = document.getElementById('lang')!;
    expect(() => collect(lang)).not.toThrow();
    expect(ids(collect(lang))).toEqual(['lang']);
  });

  test('控制台留一条带站点与选择器的警告，同一条只警告一次', () => {
    // 警告按“站点 + 选择器”只发一次，前面的用例已用过 TRAILING_COMMA，
    // 这里换一条本用例专用的无效选择器
    const invalid = '.warn-once,';
    rules['localhost'] = { exclude: ['.panel', invalid] };
    collect();
    collect();
    const hits = warn.mock.calls.filter((args) =>
      args.some((a) => String(a).includes(invalid)),
    );
    expect(hits).toHaveLength(1);
    expect(String(hits[0])).toContain('localhost');
  });
});

describe('closestUnit（规则里混入无效选择器，逐段翻译入口）', () => {
  test('有效的排除照常生效，排除区外照常找到段落', () => {
    rules['localhost'] = { exclude: [TRAILING_COMMA, '.panel'] };
    expect(closestUnit(document.getElementById('panel')!)).toBeNull();
    expect(closestUnit(document.getElementById('body')!)?.id).toBe('body');
  });
});

describe('保留原文（规则里混入无效选择器，#369）', () => {
  test('提取文本不抛出，其余保留原文选择器照常生效', () => {
    rules['localhost'] = { preserve: [TRAILING_COMMA, 'a.user-mention'] };
    document.body.innerHTML =
      '<p id="c">Thanks <a class="user-mention">@octocat</a> for the quick review.</p>';
    const [unit] = collect();
    expect(unit!.id).toBe('c');
    expect([...translatableTextEx(unit!).preserves.values()]).toEqual(['@octocat']);
  });
});

describe('getSiteRules（生效站点规则不含无效选择器）', () => {
  test('无效选择器被剔除，其余按原顺序保留', () => {
    rules['localhost'] = { exclude: ['.panel', TRAILING_COMMA, '', '.lang'] };
    expect(getSiteRules('localhost').exclude).toEqual(['.panel', '.lang']);
  });

  test('保留原文里的无效选择器同样被剔除（#369）', () => {
    rules['localhost'] = { preserve: [TRAILING_COMMA, 'a.user-mention'] };
    expect(getSiteRules('localhost').preserve).toEqual(['a.user-mention']);
  });
});
