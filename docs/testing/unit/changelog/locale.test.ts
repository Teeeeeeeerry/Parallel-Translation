/**
 * changelog/locale.ts — 变更条目的语言选择 单元测试
 *
 * 骨架文案走 chrome.i18n（浏览器按 default_locale 回退），条目文案走
 * 这里。两者的回退目标必须一致，否则未支持语言的用户会看到「标题中文
 * + 条目英文」的混搭。manifest 的 default_locale 是 zh_CN，故此处
 * 未知语言同样回退 zh_CN。
 */
import { describe, test, expect } from 'vitest';
import { pickLocale } from '~/src/changelog/locale';

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
