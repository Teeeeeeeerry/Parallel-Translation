/**
 * changelog/decide.ts — 「该不该弹更新提示」判定 单元测试
 *
 * 纯函数，所有输入显式传入（版本、开发模式、是否主框架、站点是否被拉黑）。
 * 四条拦截规则各有一个用例，外加一条优先级用例：开发模式必须压过其他
 * 一切，否则 `pnpm dev` 每次热重载都弹。
 *
 * 已读判定不在此处 —— 它必须与标记已读成对原子执行，测试在 claim.test.ts。
 */
import { describe, test, expect } from 'vitest';
import { decideShow } from '~/src/changelog/decide';
import type { ChangelogEntry } from '~/src/changelog/data';

const ENTRIES: ChangelogEntry[] = [{ version: '2.1.0', groups: [] }];

/** 一切正常、应当弹出的基线输入 */
const BASE = {
  version: '2.1.0',
  isDev: false,
  isMainFrame: true,
  siteBlocked: false,
  entries: ENTRIES,
};

describe('decideShow', () => {
  test('条件齐备 → 弹，并带回要渲染的条目', () => {
    const d = decideShow(BASE);
    expect(d.show).toBe(true);
    if (d.show) expect(d.entry.version).toBe('2.1.0');
  });

  test('开发模式不弹', () => {
    const d = decideShow({ ...BASE, isDev: true });
    expect(d).toEqual({ show: false, reason: 'dev' });
  });

  test('iframe 内不弹', () => {
    const d = decideShow({ ...BASE, isMainFrame: false });
    expect(d).toEqual({ show: false, reason: 'sub-frame' });
  });

  test('站点被拉黑不弹', () => {
    const d = decideShow({ ...BASE, siteBlocked: true });
    expect(d).toEqual({ show: false, reason: 'site-blocked' });
  });

  test('内部版本（无条目）不弹', () => {
    const d = decideShow({ ...BASE, version: '2.0.66' });
    expect(d).toEqual({ show: false, reason: 'no-entry' });
  });

  test('开发模式压过其余一切条件', () => {
    const d = decideShow({ ...BASE, isDev: true, siteBlocked: false });
    expect(d).toEqual({ show: false, reason: 'dev' });
  });
});
