/**
 * 单文本入口直接给出要显示的提示（#1075，父 #1068）
 *
 * 逐段、划词、输入翻译共用编排模块的 translateText。没拿到译文时入口给出“要
 * 显示的提示”或 null（不提示），三个调用点原样显示。这里在入口接口上按失败
 * 分类各断言一条：给定这样的准入与发送结果，入口给出什么提示。
 */
import { describe, test, expect, vi } from 'vitest';
import { createOrchestrator } from '~/src/orchestration/orchestrator';
import { createPageContext, type PageContextSource } from '~/src/orchestration/page-context';
import { DEFAULT_SETTINGS } from '~/src/storage/schema';
import { CONTEXT_INVALIDATED_MSG } from '~/src/runtime/messaging';

const error = (message: string) => ({ ok: false, notice: { message, purpose: 'status', kind: 'error' } });

async function noticeFor(reply: unknown, context: PageContextSource = {}) {
  const orch = createOrchestrator({ send: vi.fn(async () => reply), context: createPageContext(context) });
  orch.start();
  return orch.translateText('Hello', 'en', 'zh-CN');
}

const blockedSite: PageContextSource = {
  getSettings: () => ({ ...DEFAULT_SETTINGS, siteList: { mode: 'blacklist', list: ['example.com'] } }),
  getHostname: () => 'example.com',
};

describe('单文本入口给出的提示（#1075）', () => {
  test('站点被名单禁用：说明原因', async () => {
    expect(await noticeFor(null, blockedSite)).toEqual(error(chrome.i18n.getMessage('toastSiteBlocked')));
  });

  test('站点被名单禁用、在子框架里：不提示（#327）', async () => {
    expect(await noticeFor(null, { ...blockedSite, isMainFrame: () => false })).toEqual({ ok: false, notice: null });
  });

  test('总开关关闭：不提示', async () => {
    const off = { getSettings: () => ({ ...DEFAULT_SETTINGS, enabled: false }), getHostname: () => 'example.com' };
    expect(await noticeFor(null, off)).toEqual({ ok: false, notice: null });
  });

  test('被放弃（后台报已中止）：不提示', async () => {
    expect(await noticeFor({ ok: false, category: 'aborted', error: '已中止' })).toEqual({
      ok: false,
      notice: null,
      abandoned: true,
    });
  });

  test('扩展上下文失效：展示“请刷新页面后重试”，与整页汇总同一口径', async () => {
    const reply = { ok: false, error: CONTEXT_INVALIDATED_MSG, invalidated: true, contextInvalidated: true, category: 'transient' };
    expect(await noticeFor(reply)).toEqual(error(CONTEXT_INVALIDATED_MSG));
  });

  test('配额耗尽：展示引擎原因', async () => {
    expect(await noticeFor({ ok: false, category: 'quota', error: '配额已用尽', invalidated: true })).toEqual(error('配额已用尽'));
  });

  test('key 无效：展示引擎原因', async () => {
    expect(await noticeFor({ ok: false, category: 'invalid-key', error: 'API key 无效' })).toEqual(error('API key 无效'));
  });

  test('瞬时故障：泛化的“翻译失败”，不露出引擎原因', async () => {
    expect(await noticeFor({ ok: false, category: 'transient', error: 'HTTP 503' })).toEqual(
      error(chrome.i18n.getMessage('toastTranslateFail')),
    );
  });

  test('请求过大：泛化的“翻译失败”', async () => {
    expect(await noticeFor({ ok: false, category: 'too-large', error: 'HTTP 400' })).toEqual(
      error(chrome.i18n.getMessage('toastTranslateFail')),
    );
  });

  test('真实原因类别但引擎没给原因文本：回落到泛化文案', async () => {
    expect(await noticeFor({ ok: false, category: 'quota' })).toEqual(error(chrome.i18n.getMessage('toastTranslateFail')));
  });
});
