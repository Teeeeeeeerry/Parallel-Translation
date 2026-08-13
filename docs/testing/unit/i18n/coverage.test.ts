/**
 * i18n 覆盖率检查
 *
 * 验证三个 locale 的 key 集合一致、无空值、无死 key
 */
import { describe, test, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const LOCALES_DIR = path.resolve('public/_locales');
const LOCALES = ['en', 'zh_CN', 'zh_TW'];

function loadMessages(locale: string): Record<string, { message: string }> {
  const p = path.join(LOCALES_DIR, locale, 'messages.json');
  const raw = fs.readFileSync(p, 'utf-8');
  return JSON.parse(raw);
}

describe('i18n', () => {
  test('三个 locale 的 key 集合完全一致（无漏配）', () => {
    const keySets = LOCALES.map((loc) => {
      const messages = loadMessages(loc);
      return { locale: loc, keys: new Set(Object.keys(messages)) };
    });

    // zh_CN 是基准
    const baseKeys = keySets.find((k) => k.locale === 'zh_CN')!.keys;

    for (const { locale, keys } of keySets) {
      // 检查是否有 zh_CN 有但当前 locale 没有的 key
      const missing = [...baseKeys].filter((k) => !keys.has(k));
      expect(missing).toEqual([]);

      // 检查是否有当前 locale 有但 zh_CN 没有的 key
      const extra = [...keys].filter((k) => !baseKeys.has(k));
      expect(extra).toEqual([]);
    }
  });

  test('所有 key 的 message 值非空', () => {
    for (const loc of LOCALES) {
      const messages = loadMessages(loc);
      for (const [key, val] of Object.entries(messages)) {
        expect(
          val.message,
          `${loc}:${key} message 为空`,
        ).toBeTruthy();
      }
    }
  });

  test('至少存在基本 UI 文案 key', () => {
    const zhCN = loadMessages('zh_CN');
    const requiredKeys = [
      'extName',
      'extDesc',
      'translate',
      'settings',
      'rowEnabled',
      'modeBilingual',
      'modeTranslationOnly',
      'btnTranslate',
    ];
    for (const key of requiredKeys) {
      expect(zhCN[key], `缺少必需 key: ${key}`).toBeDefined();
    }
  });

  test('zh_CN 和 zh_TW 的 message 内容不同（非同一份文件复制）', () => {
    const zhCN = loadMessages('zh_CN');
    const zhTW = loadMessages('zh_TW');

    // 检查至少有一个 key 的 message 不同（排除纯英文的 extName）
    let diffCount = 0;
    for (const key of Object.keys(zhCN)) {
      if (key === 'extName') continue; // extName 可能是英文品牌名
      if (zhCN[key]?.message !== zhTW[key]?.message) {
        diffCount++;
      }
    }
    expect(diffCount).toBeGreaterThan(0);
  });
});
