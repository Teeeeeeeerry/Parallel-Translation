// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// Phase 6 — Background service worker。
// 代理翻译请求 + 注册右键菜单 + 转发菜单事件。

import { cacheSet, cacheKey, cacheGet, cacheClear } from '~/src/storage/cache';
import { getKey, setKey, removeKey } from '~/src/storage/keys';
import { settingsReady, patchSettings, onSettingsChanged } from '~/src/storage/settings';
import { route } from '~/src/engines/router';
import { EngineError } from '~/src/engines/types';
import { createInFlightTable, inFlightKey, runEngineCall } from '~/src/runtime/inflight';
import { ensureE2EMock, applyE2EMock, getE2EMockStats } from '~/src/engines/e2e-mock';
import { initContextMenu } from '~/src/ui/context-menu';
import { claimShow, markFreshInstall } from '~/src/changelog/claim';
import { markSeen } from '~/src/changelog/state';

/** 将浏览器 UI 语言映射到 LANG_LIST 中可用的目标语言码 */
function deriveTargetLanguage(uiLang: string): string {
  const lang = uiLang.split('-')[0]?.toLowerCase() ?? '';
  // 中文特殊处理：繁体 → zh-TW，其余默认简体
  if (lang === 'zh') {
    return uiLang.includes('TW') || uiLang.includes('Hant') ? 'zh-TW' : 'zh-CN';
  }
  // 已知语言前缀 → 对应语言码
  const MAP: Record<string, string> = {
    en: 'en', ja: 'ja', ko: 'ko', fr: 'fr', de: 'de',
    es: 'es', pt: 'pt', ru: 'ru', ar: 'ar', th: 'th',
    vi: 'vi', it: 'it',
  };
  return MAP[lang] ?? 'en';
}

export default defineBackground(() => {
  console.log('[PT] Background service worker started');

  settingsReady().catch((e) => console.error('[PT] 设置加载失败:', e));
  onSettingsChanged(() => {});

  // 暴露给 DevTools Console 用于 DoD 验证
  (self as any).cacheSet = cacheSet;
  (self as any).cacheKey = cacheKey;
  (self as any).cacheGet = cacheGet;
  (self as any).cacheClear = cacheClear;
  (self as any).getKey = getKey;
  (self as any).setKey = setKey;
  (self as any).removeKey = removeKey;
  // E2E fixtures 的 mock 注入入口（#90，与上同理的调试面）
  (self as any).applyE2EMock = applyE2EMock;
  // mock 统计探针 —— TC-E2E-47/48 断言一次性故障确实被触发（#91）
  (self as any).getE2EMockStats = getE2EMockStats;
  // 首装处理落定的信号（#723）：E2E 夹具等它之后才写种子设置。首装按界面
  // 语言写目标语言（下面的 onInstalled）是先读后写，与种子设置交错时会把
  // 种子整份覆盖回默认值（#469）
  let settleInstall!: () => void;
  (self as any).ptInstallSettled = new Promise<void>((resolve) => {
    settleInstall = resolve;
  });

  // 右键菜单 + 首次安装引导
  chrome.runtime.onInstalled.addListener((details) => {
    initContextMenu().catch(() => {});

    if (details.reason === 'install') {
      // 首装用户没有「更新」可看 —— 更新提示只服务老用户（ADR-0001），
      // 新用户看到的是 welcome 页。
      //
      // 两道闸：先同步置位内存标志（立即生效，先于任何 claim 消息抵达），
      // 再异步落盘。只靠落盘会留下竞态窗口 —— 详见 claim.ts 的说明。
      markFreshInstall();
      markSeen(chrome.runtime.getManifest().version).catch((e) =>
        console.error('[PT] 首装标记更新提示已读失败：', e),
      );

      // 根据浏览器 UI 语言推导默认目标语言
      settingsReady()
        .then(async () => {
          const uiLang = chrome.i18n.getUILanguage();
          const derived = deriveTargetLanguage(uiLang);
          if (derived !== 'zh-CN') {
            await patchSettings({ to: derived });
          }
        })
        .catch((e) => console.error('[PT] 设置默认语言失败:', e))
        .finally(settleInstall);

      // 打开欢迎页
      chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
    } else {
      settleInstall();
    }
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'pt-translate-selection' && tab?.id) {
      // #166: 无 content script 的页面（chrome://、PDF 查看器、扩展更新前
      // 已打开的旧标签页）sendMessage 会以 "Receiving end does not exist"
      // 拒绝 —— 不加 catch 会在 SW 内留下未处理 rejection，用户侧零反馈。
      chrome.tabs
        .sendMessage(tab.id, {
          type: 'pt:translate-selection',
          text: info.selectionText ?? '',
        })
        .catch(() => {
          console.debug(
            '[PT] 右键翻译：目标标签页无 content script，忽略（请刷新页面后使用）',
          );
        });
    }
  });

  // #177: welcome 页「关闭」按钮 —— 页面脚本的 window.close() 会被
  // 浏览器静默忽略（标签页由 background 打开），由这里移除标签页
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (msg?.type === 'pt:close-welcome' && sender.tab?.id) {
      chrome.tabs.remove(sender.tab.id).catch(() => {
        console.debug('[PT] 关闭 welcome 标签页失败或已关闭');
      });
    }
  });

  // 更新提示的显示权仲裁（ADR-0001）——
  // 扩展更新后每个新页面的 content script 都会来问，串行判定只放行一个，
  // 避免同时打开多个标签页时弹出多个弹窗
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'pt:changelog-claim') return;
    // 跨进程载荷不做类型假设 —— 字段不对就当没收到，不去写存储
    if (typeof msg.version !== 'string' || !msg.version) return;

    claimShow(msg.version)
      .then((granted) => sendResponse({ ok: true, granted }))
      .catch((e) => {
        console.error('[PT] 更新提示仲裁失败：', e);
        sendResponse({ ok: false, granted: false });
      });
    return true; // 异步响应
  });

  // #471: 子 frame 取顶层页面的主机名 —— 按发送方所在标签页的网址，
  // 当前领域据此判定，一个标签页里所有 frame 得到同一个领域
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type !== 'pt:top-hostname') return;
    let hostname = '';
    try {
      hostname = new URL(sender.tab?.url ?? '').hostname;
    } catch {
      // 取不到标签页网址：content 回落到本 frame 的主机名
    }
    sendResponse({ hostname });
  });

  // #400: 子 frame 启动时要本标签页的临时领域选择 —— 转问该标签页的
  // 主文档（frameId 0），切换之后才加载的 iframe 与主文档带同一个领域
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type !== 'pt:top-domain-choice') return;
    const tabId = sender.tab?.id;
    if (tabId == null) return;
    chrome.tabs
      .sendMessage(tabId, { type: 'pt:get-domain-choice' }, { frameId: 0 })
      .then(sendResponse, () => sendResponse(undefined));
    return true;
  });

  // #663: 子 frame 启动时要本标签页这一次的对方语言（输入翻译）—— 与上面
  // 的临时领域同一条路，转问该标签页的主文档
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type !== 'pt:top-input-lang-choice') return;
    const tabId = sender.tab?.id;
    if (tabId == null) return;
    chrome.tabs
      .sendMessage(tabId, { type: 'pt:get-input-lang-choice' }, { frameId: 0 })
      .then(sendResponse, () => sendResponse(undefined));
    return true;
  });

  // #836：主文档发现单页应用换了路径，这一次的对方语言（输入翻译）回到跟随
  // 设置 —— 广播给该标签页全部 frame（不带 frameId，否则 iframe 收不到）。
  // 只认主文档发来的：子 frame 自己的网址变了不算这一页跳页
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (msg?.type !== 'pt:input-lang-path-changed') return;
    const tabId = sender.tab?.id;
    if (tabId == null || sender.frameId !== 0) return;
    chrome.tabs
      .sendMessage(tabId, { type: 'pt:set-input-lang', choice: { kind: 'auto' } })
      .catch(() => {});
  });

  // #847：领域的临时选择（#400）同理 —— 回到按网址判定，与 popup 临时切换
  // 走同一条 pt:set-domain，同样不带 frameId、只认主文档发来的
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (msg?.type !== 'pt:domain-path-changed') return;
    const tabId = sender.tab?.id;
    if (tabId == null || sender.frameId !== 0) return;
    chrome.tabs
      .sendMessage(tabId, { type: 'pt:set-domain', choice: { kind: 'auto' } })
      .catch(() => {});
  });

  // 健康检查（E2E 测试用于验证消息通道就绪）
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'pt:ping') {
      sendResponse({ ok: true });
      return true;
    }
  });

  // #1001：在飞表 —— content 放弃一批时凭批次身份中止对应的引擎调用。只在
  // 实例内存里，实例被回收就清空，查不到就当没有可中止的（见 inflight.ts）
  const inFlight = createInFlightTable();

  // #1001：content 放弃的批次。发出去就算数 —— 不回复，content 也不等
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (msg?.type !== 'pt:cancel-batches') return;
    for (const id of Array.isArray(msg.ids) ? msg.ids : []) {
      if (typeof id === 'string') inFlight.cancel(inFlightKey(sender.tab?.id, sender.frameId, id));
    }
  });

  // 翻译代理
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type !== 'pt:translate') return;

    // #1001：带批次身份的登记进在飞表；批次身份不往引擎传，换成中止信号
    const { batchId, ...payload } = msg.payload ?? {};
    const key = typeof batchId === 'string' ? inFlightKey(sender.tab?.id, sender.frameId, batchId) : null;
    const signal = key ? inFlight.start(key) : undefined;
    // #1083：这一批在后台的两段耗时 —— 从开始路由到第一次拿到引擎闸门许可是
    // “后台排队”，之后到结束是“引擎调用”。随回复带回，content 只在开了调试
    // 日志时记下。一批里有多个请求（google-web 一条文本一个）时按第一次许可分界
    let routedAt = 0;
    let gateAt: number | undefined;
    let timedOut = false;
    const timing = () => {
      const end = performance.now();
      return {
        bgQueueMs: Math.round((gateAt ?? end) - routedAt),
        engineMs: gateAt === undefined ? 0 : Math.round(end - gateAt),
        ...(timedOut && { timedOut: true }),
      };
    };
    try {
      settingsReady()
        // #90：路由前确保 E2E mock 已从 storage 安装 —— SW 实例被替换后，
        // 实例内存里的 stub 消失，此步让 mock 随每次翻译自愈
        .then(() => ensureE2EMock())
        .then(() => {
          routedAt = performance.now();
          // #1071：引擎超时从这一批第一次拿到引擎许可起计，排队不算（inflight.ts）
          return runEngineCall(
            (ctl) =>
              route({
                ...payload,
                signal: ctl.signal,
                onGateStart: () => {
                  gateAt ??= performance.now();
                  ctl.onGateStart();
                },
              }),
            {
              ...(signal && { signal }),
              onTimeout: () => {
                timedOut = true;
              },
            },
          );
        })
        .then((r) => sendResponse({ ok: true, data: r, timing: timing() }))
        .catch((e) => {
          // #263: 纯透传 —— background 不再重算可重试性；引擎产出的
          // 类型化字段（category / retryable / invalidated / aborted）
          // 原样透出，语义判定只在错误发生的唯一地点做一次
          sendResponse({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
            retryable: e instanceof EngineError ? e.retryable : true,
            category: e instanceof EngineError ? e.category : 'transient',
            invalidated: e instanceof EngineError ? e.invalidated : false,
            aborted: e instanceof EngineError ? e.aborted : false,
            ...(routedAt > 0 && { timing: timing() }),
          });
        })
        .finally(() => {
          if (key) inFlight.finish(key);
        });
    } catch (e) {
      if (key) inFlight.finish(key);
      sendResponse({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        retryable: e instanceof EngineError ? e.retryable : true,
        category: e instanceof EngineError ? e.category : 'transient',
        invalidated: e instanceof EngineError ? e.invalidated : false,
        aborted: e instanceof EngineError ? e.aborted : false,
      });
    }

    return true;
  });
});
