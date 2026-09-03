/**
 * changelog/state.ts — 更新提示的已读状态 单元测试
 *
 * 已读状态存 sync 的独立 key `pt-changelog`，不进 `pt-settings` ——
 * 它不是设置（用户不会在 options 页里改它），且混进去会被
 * settings-import 的配置导出带走，别人导入配置会连「你看过哪些更新」
 * 一起继承。
 *
 * 判定口径（第四轮共识）：显示出来即算已读，点 X 关掉也算。
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { resetStorage, syncStoreSnapshot } from '~/docs/testing/setup';
import { hasSeen, markSeen } from '~/src/changelog/state';

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
