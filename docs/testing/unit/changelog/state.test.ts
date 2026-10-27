/**
 * changelog/state.ts — 更新提示的已读状态 单元测试
 *
 * 已读状态存 sync 的独立 key `pt-changelog`，不进 `pt-settings` ——
 * 它不是设置（用户不会在 options 页里改它），且混进去会被
 * settings-import 的配置导出带走，别人导入配置会连「你看过哪些更新」
 * 一起继承。
 *
 * 判定口径（#1172）：用户在可见页面上关掉弹窗或弹窗持续可见满阈值才算
 * 已读，由 prompt.ts 调 markSeen。首装标记只写本机（markInstalled）。
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { resetStorage, syncStoreSnapshot, localStoreSnapshot } from '~/docs/testing/setup';
import { hasSeen, markSeen, markInstalled } from '~/src/changelog/state';

describe('hasSeen / markSeen', () => {
  beforeEach(() => {
    resetStorage();
  });

  test('空存储 → 未读', async () => {
    expect(await hasSeen('2.1.0')).toBe(false);
  });

  test('markSeen 后 → 已读', async () => {
    await markSeen('2.1.0');
    expect(await hasSeen('2.1.0')).toBe(true);
  });

  test('只对被标记的那个版本算已读', async () => {
    await markSeen('2.1.0');
    expect(await hasSeen('2.2.0')).toBe(false);
  });

  test('写入 sync 的独立 key，不碰 pt-settings', async () => {
    await markSeen('2.1.0');
    const snap = syncStoreSnapshot();
    expect(snap['pt-changelog']).toBeDefined();
    expect(snap['pt-settings']).toBeUndefined();
  });

  test('存储里是脏数据 → 判未读而不是抛错', async () => {
    await chrome.storage.sync.set({ 'pt-changelog': 'not-an-object' });
    expect(await hasSeen('2.1.0')).toBe(false);
  });
});

describe('markInstalled —— 首装标记只挡本机（#1172）', () => {
  beforeEach(() => {
    resetStorage();
  });

  test('首装后本机同版本算已读', async () => {
    await markInstalled('2.1.0');
    expect(await hasSeen('2.1.0')).toBe(true);
    expect(await hasSeen('2.2.0')).toBe(false);
  });

  test('只写本地存储，不写同步存储 —— 另一台设备升级到同版本照常弹', async () => {
    await markInstalled('2.1.0');
    expect(syncStoreSnapshot()['pt-changelog']).toBeUndefined();
    expect(localStoreSnapshot()['pt-changelog']).toBeDefined();
  });

  test('本地是脏数据 → 不影响同步存储里的已读判定', async () => {
    await chrome.storage.local.set({ 'pt-changelog': ['bad'] });
    expect(await hasSeen('2.1.0')).toBe(false);
    await markSeen('2.1.0');
    expect(await hasSeen('2.1.0')).toBe(true);
  });
});
