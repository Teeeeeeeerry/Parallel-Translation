/**
 * dom/site-filter.ts — 站点黑白名单判定 单元测试（#153）
 */
import { describe, test, expect } from 'vitest';
import { siteMatches, isSiteBlocked } from '~/src/dom/site-filter';

// ---- siteMatches ----

describe('siteMatches', () => {
  test('精确相等命中', () => {
    expect(siteMatches('example.com', 'example.com')).toBe(true);
  });

  test('localhost 精确命中', () => {
    expect(siteMatches('localhost', 'localhost')).toBe(true);
  });

  test('IPv4 精确命中', () => {
    expect(siteMatches('127.0.0.1', '127.0.0.1')).toBe(true);
  });

  test('www. 前缀命中主域条目', () => {
    expect(siteMatches('www.github.com', 'github.com')).toBe(true);
  });

  test('多级子域命中主域条目', () => {
    expect(siteMatches('news.ycombinator.com', 'ycombinator.com')).toBe(true);
  });

  test('条目带 www. 时反向命中', () => {
    expect(siteMatches('github.com', 'www.github.com')).toBe(true);
    expect(siteMatches('www.github.com', 'www.github.com')).toBe(true);
  });

  test('子域归入条目：news.example.com 命中 example.com', () => {
    expect(siteMatches('news.example.com', 'example.com')).toBe(true);
  });

  test('不相关域名不命中', () => {
    expect(siteMatches('example.com', 'example.org')).toBe(false);
    expect(siteMatches('news.example.com', 'example.org')).toBe(false);
    expect(siteMatches('evil-example.com', 'example.com')).toBe(false);
  });

  test('IP 不做子域/主域归一，防止部分 IP 误命中', () => {
    expect(siteMatches('192.168.1.1', '168.1.1')).toBe(false);
    expect(siteMatches('127.0.0.1', '0.1')).toBe(false);
    expect(siteMatches('127.0.0.1', '127.0.0.2')).toBe(false);
  });

  test('空条目不命中', () => {
    expect(siteMatches('example.com', '')).toBe(false);
  });
});

// ---- isSiteBlocked ----

describe('isSiteBlocked', () => {
  test('黑名单：命中列表 → 跳过', () => {
    expect(
      isSiteBlocked('www.github.com', { mode: 'blacklist', list: ['github.com'] }),
    ).toBe(true);
  });

  test('黑名单：未命中 → 放行', () => {
    expect(
      isSiteBlocked('example.com', { mode: 'blacklist', list: ['github.com'] }),
    ).toBe(false);
  });

  test('黑名单：空列表 → 全部放行', () => {
    expect(isSiteBlocked('example.com', { mode: 'blacklist', list: [] })).toBe(false);
  });

  test('白名单：未命中 → 跳过（隐私预期：非列表站点不翻译）', () => {
    expect(
      isSiteBlocked('example.com', { mode: 'whitelist', list: ['github.com'] }),
    ).toBe(true);
  });

  test('白名单：命中（含 www 归一）→ 放行', () => {
    expect(
      isSiteBlocked('www.github.com', { mode: 'whitelist', list: ['github.com'] }),
    ).toBe(false);
  });

  test('白名单：空列表 → 全站跳过', () => {
    expect(isSiteBlocked('example.com', { mode: 'whitelist', list: [] })).toBe(true);
  });
});
