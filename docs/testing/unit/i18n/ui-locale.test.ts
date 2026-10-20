/**
 * i18n.ts —— 界面语言的选择 单元测试
 *
 * 骨架文案走 chrome.i18n（浏览器按 default_locale 回退），更新提示的条目、
 * 领域列表分隔符这些自己挑语言的地方走 uiLocale()。两者的回退目标必须一致，
 * 否则未支持语言的用户会看到「标题中文 + 条目英文」的混搭。manifest 的
 * default_locale 是 zh_CN，故此处未知语言同样回退 zh_CN。
 */
import { describe, test, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { pickLocale, uiLocale } from '~/src/i18n';

describe('pickLocale', () => {
  test('简体中文', () => {
    expect(pickLocale('zh-CN')).toBe('zh_CN');
  });

  test('繁体地区一律归 zh_TW', () => {
    expect(pickLocale('zh-TW')).toBe('zh_TW');
    expect(pickLocale('zh-HK')).toBe('zh_TW');
    expect(pickLocale('zh-MO')).toBe('zh_TW');
  });

  test('无地区的 zh 与新加坡华语归简体', () => {
    expect(pickLocale('zh')).toBe('zh_CN');
    expect(pickLocale('zh-SG')).toBe('zh_CN');
  });

  test('英语各地区归 en', () => {
    expect(pickLocale('en')).toBe('en');
    expect(pickLocale('en-US')).toBe('en');
    expect(pickLocale('en-GB')).toBe('en');
  });

  test('未支持语言回退 zh_CN —— 与 manifest default_locale 一致', () => {
    expect(pickLocale('ja')).toBe('zh_CN');
    expect(pickLocale('de-DE')).toBe('zh_CN');
    expect(pickLocale('')).toBe('zh_CN');
  });

  test('大小写不敏感', () => {
    expect(pickLocale('ZH-tw')).toBe('zh_TW');
    expect(pickLocale('EN-us')).toBe('en');
  });
});

describe('uiLocale —— 当前生效界面语言', () => {
  afterEach(() => {
    vi.mocked(chrome.i18n.getUILanguage).mockReturnValue('zh-CN');
  });

  test('跟着浏览器界面语言走', () => {
    vi.mocked(chrome.i18n.getUILanguage).mockReturnValue('en-US');
    expect(uiLocale()).toBe('en');
    vi.mocked(chrome.i18n.getUILanguage).mockReturnValue('zh-HK');
    expect(uiLocale()).toBe('zh_TW');
  });

  test('浏览器界面语言没有对应文案时归 zh_CN', () => {
    vi.mocked(chrome.i18n.getUILanguage).mockReturnValue('ja');
    expect(uiLocale()).toBe('zh_CN');
  });

  test('非扩展上下文取不到浏览器界面语言时归 zh_CN', () => {
    vi.mocked(chrome.i18n.getUILanguage).mockImplementation(() => {
      throw new Error('no extension context');
    });
    expect(uiLocale()).toBe('zh_CN');
  });
});

// 读界面语言、取文案只能经 i18n 模块，后续加“扩展语言”时只改这一处（#1099）。
// 唯一例外：首装时按浏览器语言推导默认目标语言 —— 那时还没有设置过扩展语言。
describe('读界面语言与取文案的唯一入口', () => {
  const ROOTS = ['src', 'entrypoints'];
  const ALLOWED: Record<string, string[]> = {
    'src/i18n.ts': ['getUILanguage', 'getMessage'],
    'entrypoints/background.ts': ['getUILanguage'],
  };

  function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) return walk(p);
      return /\.(ts|tsx|vue)$/.test(d.name) ? [p] : [];
    });
  }

  test('除 i18n 模块与首装推导外，不直接调 chrome.i18n.getUILanguage / getMessage', () => {
    const offenders: string[] = [];
    for (const file of ROOTS.flatMap(walk)) {
      const rel = file.split(path.sep).join('/');
      const allowed = ALLOWED[rel] ?? [];
      fs.readFileSync(file, 'utf-8').split('\n').forEach((line, i) => {
        const m = line.match(/\bi18n\.(getUILanguage|getMessage)\s*\(/);
        if (m && !allowed.includes(m[1]!)) offenders.push(`${rel}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
