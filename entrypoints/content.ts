// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// Phase 4/5/6 — Content script。
// 集成：三模式渲染 + 注入式 UI（悬浮球/段落按钮/toast）+
// 快捷键 + 划词交互。

// tokens 必须与 presets 一同注入宿主页面 —— presets.css 里的 var(--pt-brass)
// 只在有令牌定义时才成立，否则 border-left 在计算值时刻失效，默认样式无边框。
import '~/src/styles/tokens.css';
import '~/src/styles/presets.css';
import { collect } from '~/src/dom/walker';
import { closestUnit } from '~/src/dom/classify';
import { normalizeText, normalizePreText } from '~/src/dom/normalize';
import {
  translatableText,
  translatableTextEx,
  shallowTranslatableText,
  shallowTranslatableTextEx,
  hasBlockTextChildren,
  restorePreserves,
} from '~/src/dom/text';
import { startObserver, type ObserverHandle } from '~/src/dom/observer';
import { walkShadowTree } from '~/src/dom/shadow-walk';
import { render, unrender, applyMode, applyStyle } from '~/src/dom/renderer';
import { unsplitPre } from '~/src/dom/pre-split';
import { applyCustomCss } from '~/src/styles/custom';
import { createBall, setBallState } from '~/src/ui/floating-ball';
import { createParaBtn } from '~/src/ui/paragraph-btn';
import { toast } from '~/src/ui/toast';
import { startHotkeys } from '~/src/hotkeys/listener';
import { startSelectionDrag } from '~/src/ui/selection-drag';
import { createLifecycleRegistry } from '~/src/ui/lifecycle-registry';
import {
  createOrchestrator,
  type PageToggleResult,
} from '~/src/orchestration/orchestrator';
import type { TranslateItem } from '~/src/orchestration/orchestrator';
import { translateViaBackground } from '~/src/runtime/messaging';
import { detectOS } from '~/src/hotkeys/platform';
import {
  settingsReady,
  getSettings,
  onSettingsChanged,
  patchSettings,
} from '~/src/storage/settings';
import type { Settings } from '~/src/storage/schema';
import { tf } from '~/src/i18n';
import { isSiteBlocked } from '~/src/dom/site-filter';
import { decideShow } from '~/src/changelog/decide';
import { clearSeen } from '~/src/changelog/state';

// pre 判定统一收敛：#117。pre 内单元（.pt-chunk / 纯文本 pre）保留硬换行，
// pre 外折叠空白；两处采集/渲染路径共用同一判定，避免只改一处导致行为分叉。
function normalizeForUnit(el: Element, raw: string): string {
  const normalize = el.closest('pre') ? normalizePreText : normalizeText;
  return normalize(raw);
}

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  runAt: 'document_end',
  async main() {
    await settingsReady();
    // #164: 必须等平台缓存就绪再注册快捷键 —— 否则首次按键按 'other'
    // 匹配（忽略 metaKey），Mac 用户加载后的第一次 ⌘⇧Y 静默无响应
    await detectOS();
    const s = getSettings();

    // #242/#243/#255: UI 生命周期注册表 —— 悬浮球、段落按钮、划词拖拽、
    // 快捷键、observer 全部经注册表启停；设置变更由 ensure() 驱动，
    // 启停成对、重复注册幂等；五个 stop 变量与重复创建块已删除
    const registry = createLifecycleRegistry();

    const isMainFrame = window.top === window;

    // ── 注入 UI（仅主文档）──
    if (isMainFrame) {
      // #242: 悬浮球经注册表启停；showFloatingBall 决定是否启动
      registry.register('ball', {
        create: () => createBall({ onToggle: () => void togglePage() }),
        stop: (stopBall) => stopBall(),
      });

      // #243: 段落按钮经注册表启停；showParagraphBtn 决定是否启动
      registry.register('para-btn', {
        create: () =>
          createParaBtn({
            translate: (el) => translateOne(el),
            restore: (el) => unrender(el),
          }),
        stop: (stopParaBtn) => stopParaBtn(),
      });
    }

    // ── 快捷键（仅主文档，避免与 iframe 内输入冲突）──
    // #255: 快捷键经注册表启停（无设置开关，恒启用）
    if (isMainFrame) {
      registry.register('hotkeys', {
        create: () =>
          startHotkeys({
            'toggle-translate': () => void togglePage(),
            'toggle-mode': () => {
              // 只翻转全局显示模式。paraDisplayMode 为 'follow' 时跟着变；
              // 显式设过独立值的不受快捷键影响。
              const next: 'bilingual' | 'translation-only' =
                getSettings().displayMode === 'bilingual'
                  ? 'translation-only'
                  : 'bilingual';
              patchSettings({ displayMode: next }).catch(() => {});
            },
            'translate-paragraph': () => {
              const sel = window.getSelection();
              if (sel?.rangeCount) {
                const el = sel.getRangeAt(0).startContainer?.parentElement;
                if (el) translateOne(el);
              }
            },
            'toggle-extension': () => {
              const cur = getSettings().enabled;
              patchSettings({ enabled: !cur }).catch(() => {});
              toast(cur ? tf('toastExtOff', '扩展已关闭') : tf('toastExtOn', '扩展已开启'));
            },
          }),
        stop: (stopHotkeys) => stopHotkeys(),
      });
      registry.ensure('hotkeys', true);
    }

    // ── 划词拖动 ──
    // #244: 划词拖拽经注册表启停（无设置开关，恒启用）
    registry.register('drag', {
      create: () => startSelectionDrag((text) => translateSelection(text)),
      stop: (stopDrag) => stopDrag(),
    });
    registry.ensure('drag', true);

    // ── 增量补翻 observer ──
    // #255: observer 经注册表启停 —— 整页翻译完成时启动，还原时停止；
    // 启停幂等，不再手写 stopObserving 判空
    //
    // #331/#332: 隐藏单元登记能力从观察器句柄取得（模块顶层不再导出
    // 登记函数）。整页翻译的 collect 先于观察器启动（翻译成功后
    // ensure('observer', true)），期间的登记进 preStartHidden 缓冲
    // （WeakRef，#330 弱引用语义），句柄创建时补挂 —— 首轮翻译期间
    // 采集到的隐藏单元因此不丢失。
    const preStartHidden = new Set<WeakRef<Element>>();
    let observerHandle: ObserverHandle | null = null;

    /** 整页翻译 collect 的隐藏单元回调：句柄存在则直登，否则进缓冲。 */
    function registerHiddenForObserver(el: Element): void {
      if (observerHandle) {
        observerHandle.registerHidden(el);
        return;
      }
      preStartHidden.add(new WeakRef(el));
    }

    registry.register('observer', {
      create: () => {
        const handle = startObserver((els) => {
          translateIncremental(els).catch((e) =>
            console.error('[PT] 增量补翻失败:', e),
          );
        });
        observerHandle = handle;
        // 补挂启动前登记的隐藏单元（死亡引用直接丢弃）
        for (const ref of preStartHidden) {
          const el = ref.deref();
          if (el) handle.registerHidden(el);
        }
        preStartHidden.clear();
        return handle;
      },
      // #331: startObserver 返回句柄，stop 经句柄执行（幂等）
      stop: (handle) => {
        handle.stop();
        observerHandle = null;
      },
    });

    // ── 设置变更统一入口（#265）──
    // 初始化与设置变更共用：样式应用 + UI 启停（经注册表 ensure）。
    // 订阅由编排模块持有（start 订阅 / stop 退订），此处只有一份
    // 响应代码，无重复的创建 / 变更处理块。
    function applySettings(ns: Settings): void {
      applyMode(ns.displayMode, ns.paraDisplayMode);
      applyStyle(ns.style);
      applyCustomCss(ns.customCss);

      if (isMainFrame) {
        // #242/#243: 悬浮球 / 段落按钮开关经注册表 ensure —— 启停幂等、即时生效
        registry.ensure('ball', ns.showFloatingBall);
        registry.ensure('para-btn', ns.showParagraphBtn);
      }
    }
    applySettings(s);

    /**
     * 更新提示（ADR-0001）—— 扩展更新到写有 changelog 条目的上架版本后，
     * 用户下次打开新页面时在页内弹出。
     *
     * 分两步：子框架 / 开发构建 / 被拉黑站点 / 内部版本在本地就排除，
     * 不去打扰 SW;剩下的才向 background 申请显示权，多标签页并发时
     * 只有一个拿到（见 changelog/claim.ts）。
     *
     * 不 await —— 更新提示与翻译功能互不依赖，不该让它拖慢内容脚本启动。
     */
    async function maybeShowChangelog(ns: Settings): Promise<void> {
      const decision = decideShow({
        version: chrome.runtime.getManifest().version,
        isDev: import.meta.env.DEV,
        isMainFrame,
        siteBlocked: isSiteBlocked(location.hostname, ns.siteList),
      });
      if (!decision.show) return;

      let granted = false;
      try {
        const res: unknown = await chrome.runtime.sendMessage({
          type: 'pt:changelog-claim',
          version: decision.entry.version,
        });
        granted = (res as { granted?: boolean } | null)?.granted === true;
      } catch {
        // SW 未就绪或扩展上下文失效 —— 这次不弹，下次页面加载再说
        return;
      }
      if (!granted) return;

      // 动态 import 的形式与代价见 ADR-0001（MV3 下并不会真的分包）
      try {
        const { showChangelog } = await import('~/src/changelog/modal');
        showChangelog(decision.entry);
      } catch (e) {
        // 显示权是在 background 发放时就标记已读的（并发仲裁的需要）。
        // 走到这里意味着标记了却没显示成功，不回滚的话这个上架版本
        // 会被永久跳过，用户再也看不到本次更新说明。
        await clearSeen(decision.entry.version).catch(() => {});
        throw e;
      }
    }

    void maybeShowChangelog(s).catch((e) =>
      console.error('[PT] 更新提示失败：', e),
    );

    // ── 翻译全页 ──
    // #329: 内容脚本不再持有翻译态 —— 在飞标志、翻译态查询、还原编排、
    // 状态推送、观察器启停全部在编排模块（开关入口）。这里只保留：
    // 收集与渲染（DOM 职责）、提示渲染、消息监听接线；悬浮球 / 快捷键 /
    // popup 三条触发路径都只调用 togglePage（开关入口的薄包装）。

    /** 翻译项的渲染上下文（#261）：目标元素 + preserves + 原文。 */
    interface PageItemCtx {
      target: Element;
      preserves: Map<string, string>;
      rawText: string;
    }

    /** 渲染统计（每次整页翻译开始时清零）。 */
    const renderStats = { succeeded: 0, rejected: 0 };

    // #261: 编排模块 —— 全页翻译的批次流水线在模块内，
    // 渲染回调按批触发（#256 渐进渲染，首屏不等最慢段）
    const orchestrator = createOrchestrator({
      send: translateViaBackground,
      // #265: 设置变更订阅由模块持有（start 订阅 / stop 退订），
      // 响应走统一入口 applySettings（初始化与变更共用）。
      // #310: 载荷类型收紧为真实 Settings，此处不再需要强制转型
      subscribeSettings: onSettingsChanged,
      onSettingsChange: (ns) => applySettings(ns),
      // #310: 读取当前设置经注入项提供，模块自身不直接访问存储；
      // #311: 准入判定的当前主机名同样经注入提供
      getSettings,
      getHostname: () => location.hostname,
      // #325: 翻译态查询与还原动作经注入 —— 模块不直接访问 DOM
      hasTranslated,
      restore: doRestore,
      // #327: 悬浮球视觉状态由模块单向推送（子框架不推送）
      pushStatus: (status) => {
        if (isMainFrame) setBallState(status);
      },
      isMainFrame: () => isMainFrame,
      // #327: 引擎返回结果但全部渲染被拒 → 错误态（不点亮完成）
      allRenderRejected: () => renderStats.succeeded === 0,
      // #328: 增量补翻观察器启停经钩子接线到生命周期注册表（幂等）
      onObserverStart: () => registry.ensure('observer', true),
      onObserverStop: () => registry.ensure('observer', false),
      onBatchResult: (_i, batch, result) => {
        if (!result.ok || !result.data) return;
        const translations = result.data.translations;
        for (let j = 0; j < batch.length; j++) {
          const ctx = batch[j]!.ctx as PageItemCtx;
          try {
            // #58：将占位符替换回原文（用户名等标识符不翻译但保留）
            const restored = restorePreserves(
              translations[j]!,
              ctx.preserves,
              ctx.rawText,
            );
            if (render(ctx.target, restored, 'page')) {
              renderStats.succeeded++;
            } else {
              renderStats.rejected++;
            }
          } catch (e) {
            throw new Error(
              `[render idx=${j}] ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
      },
    });
    // #261/#265: 启动编排 —— 未启动时翻译入口拒绝执行；设置变更
    // 订阅随 start 建立
    orchestrator.start();

    /**
     * 构建翻译项（DOM 职责，#329 内容脚本保留的部分）：
     * 归一化内部空白、混合内容提取、占位符映射全部在此。
     */
    function buildPageItems(targets: Element[]): TranslateItem<PageItemCtx>[] {
      return targets.map((el, i) => {
        const useShallow = hasBlockTextChildren(el);
        const { text: rawText, preserves } = useShallow
          ? shallowTranslatableTextEx(el)
          : translatableTextEx(el);
        const text = normalizeForUnit(el, rawText);
        return {
          text,
          ctx: { target: targets[i]!, preserves, rawText: text },
        };
      });
    }

    /**
     * 整页开关入口（#329）—— 悬浮球、快捷键、popup 消息三条触发路径
     * 的唯一调用点：收集（DOM）→ 编排模块开关入口（准入 / 在飞互斥 /
     * 翻译态决定 / 状态推送 / 观察器启停）→ 提示渲染（DOM）。
     */
    async function togglePage(): Promise<PageToggleResult> {
      const ns = getSettings();
      let items: TranslateItem<PageItemCtx>[];
      try {
        items = buildPageItems(
          collect(document.body, registerHiddenForObserver),
        );
      } catch (e) {
        throw new Error(
          `[collect] ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      renderStats.succeeded = 0;
      renderStats.rejected = 0;

      const result = await orchestrator.togglePage(items, ns.from, ns.to);

      // ── 提示渲染（DOM 职责；视觉状态已由模块推送）──
      if (result.status === 'blocked' && isMainFrame) {
        toast(tf('toastSiteBlocked', '该站点已在站点名单中被禁用翻译'), 'error');
      }
      if (result.status === 'no-elements' && isMainFrame) {
        toast(tf('hintNoElements', '本页没有可翻译的内容'));
      }
      if (result.status === 'error' && isMainFrame) {
        if (result.summary?.allFailed) {
          // #313: 展示决策由模块给出 —— key 无效 / 配额真实原因，瞬时泛化
          const display = result.summary.display;
          toast(
            display.showRealReason && display.reason
              ? display.reason
              : tf('toastAllEnginesFail', '所有引擎均失败'),
            'error',
          );
        } else {
          // #49: 引擎返回了结果但全被 render() 拒绝（纵深防御命中）
          toast(
            tf('toastAllRejected', '所有段落均含图片/按钮，无法翻译'),
            'error',
          );
        }
      }
      if (
        result.status === 'translated' &&
        renderStats.rejected > 0 &&
        isMainFrame
      ) {
        // #49：整页翻译结束后用一条 toast 汇总被拒数量，而不是逐条刷屏
        toast(
          tf(
            'toastRenderRejected',
            `${renderStats.rejected} 段因含图片/按钮未翻译`,
            String(renderStats.rejected),
          ),
          'info',
        );
      }
      return result;
    }

    /**
     * 增量补翻（#329）：observer 的新节点回调 —— 直接走编排模块的
     * 全页流水线（准入 / 批次 / 中止 / 提示语义），不再经过开关入口
     * （不触发在飞互斥与状态推送）。
     */
    async function translateIncremental(elements: Element[]): Promise<void> {
      const ns = getSettings();
      const items = buildPageItems(elements);
      if (items.length === 0) return;
      renderStats.succeeded = 0;
      renderStats.rejected = 0;

      const summary = await orchestrator.translatePage(items, ns.from, ns.to);

      // 中止（还原）不算失败；失败提示与整页同口径
      if (summary.aborted) return;
      if (summary.allFailed && isMainFrame) {
        const display = summary.display;
        toast(
          display.showRealReason && display.reason
            ? display.reason
            : tf('toastAllEnginesFail', '所有引擎均失败'),
          'error',
        );
      }
    }

    // ── 还原（DOM 职责）──
    function doRestore(): void {
      // #253: 还原收集走统一遍历模块（shadow 穿透 + 集中式跳过规则）。
      // skipTranslated: false —— 嵌套在已翻译单元内的已翻译单元
      // （.pt-origin 搬移的既有译文）也要一并收集还原。
      // #328: observer 停止与还原纪元（epoch++）由编排模块的开关入口
      // 统一执行，此处只做 DOM 还原
      const els: Element[] = [];
      const splitPres: Element[] = [];
      walkShadowTree(
        document,
        (el) => {
          if (el.getAttribute('data-pt') === 'done') els.push(el);
          // #65：收集被切分的 pre，在 unrender 后还原 DOM
          if (el.getAttribute('data-pt-split') === '1') splitPres.push(el);
        },
        { skipTranslated: false },
      );

      for (const el of els) {
        unrender(el);
      }
      // #65：unrender chunk 后再还原 pre 的切分包装，将 DOM 恢复为逐字节原貌
      for (const pre of splitPres) {
        unsplitPre(pre);
      }
    }

    /**
     * 翻译态查询（#325/#329）—— 以真实 DOM 为准而不是布尔标志：
     * 单段翻译（translateOne）与 observer 增量补翻都会落 data-pt="done"，
     * 仅查标志会把“页面上已有译文”误判成“没翻过”，toggle 走错分支。
     */
    function hasTranslated(): boolean {
      // #253: 判定走统一遍历模块（shadow 穿透，命中即短路终止）
      let found = false;
      walkShadowTree(document, (el) => {
        if (el.getAttribute('data-pt') === 'done') {
          found = true;
          return 'stop';
        }
      });
      return found;
    }

    // ── 翻译单段 ──
    async function translateOne(el: Element): Promise<void> {
      // 提级到最近的可翻单元：按钮路径传来的已是精判通过的单元（原样返回）；
      // 快捷键路径拿的是选区起点的 parentElement，可能是 span 等内联元素，
      // 由这里统一向上找整段。找不到（超长 / .notranslate / 非正文区 /
      // 已翻译）则 shouldSkip 已拦下，不翻。
      const unit = closestUnit(el);
      if (!unit) {
        console.debug('[PT] translateOne 跳过：closestUnit 返回 null', el);
        toast(tf('toastNotTranslatable', '该区域无法单独翻译'), 'error');
        return;
      }

      const { text: rawText, preserves } = translatableTextEx(unit);
      const text = normalizeForUnit(unit, rawText);
      if (!text) return;

      // #314: 逐段翻译走编排模块的单文本入口 —— 准入判定（总开关 /
      // 站点名单）与失败提示语义都由模块给出，不再直连消息通道
      const ns = getSettings();
      const result = await orchestrator.translateText(text, ns.from, ns.to);

      // 准入拦截：与整页翻译一致的提示（站点被屏蔽 toast；总开关
      // 关闭静默）
      if (result.admission === 'blocked') {
        if (isMainFrame)
          toast(tf('toastSiteBlocked', '该站点已在站点名单中被禁用翻译'), 'error');
        return;
      }
      if (result.admission !== 'allowed') return;

      if (!result.ok) {
        // #313: 展示决策由编排模块给出 —— key 无效 / 配额展示真实
        // 原因，瞬时故障展示泛化文案
        if (result.display?.showRealReason && result.error) {
          toast(result.error, 'error');
        } else {
          toast(tf('toastTranslateFail', '翻译失败'), 'error');
        }
        return;
      }

      // #58：将占位符替换回原文
      const restored = restorePreserves(
        result.translation!,
        preserves,
        text,
      );

      // render() 在含媒体 / 交互控件时会拒绝渲染（#22），此时告知用户
      // 而非静默吞掉元素
      if (!render(unit, restored, 'para')) {
        toast(tf('toastNotTranslatable', '该区域无法单独翻译'), 'error');
      }
    }

    // ── 翻译选区 ──
    async function translateSelection(text: string): Promise<void> {
      // 跨行划词时选区文本天然带 \n，入口归一化
      text = normalizeText(text);

      // #315: 划词翻译走编排模块的单文本入口 —— 与逐段翻译共用
      // 同一份准入判定与失败提示语义，不再直连消息通道
      const ns = getSettings();
      const result = await orchestrator.translateText(text, ns.from, ns.to);

      // 准入拦截：与逐段 / 整页翻译一致的提示
      if (result.admission === 'blocked') {
        if (isMainFrame)
          toast(tf('toastSiteBlocked', '该站点已在站点名单中被禁用翻译'), 'error');
        return;
      }
      if (result.admission !== 'allowed') return;

      if (!result.ok) {
        // #313: key 无效 / 配额展示真实原因，瞬时故障展示泛化文案
        if (result.display?.showRealReason && result.error) {
          toast(result.error, 'error');
        } else {
          toast(tf('toastTranslateFail', '翻译失败'), 'error');
        }
        return;
      }

      toast(result.translation!);
    }

    // ── 监听 popup / background 消息 ──
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === 'pt:toggle-translate') {
        const reply = isMainFrame ? sendResponse : () => {};
        try {
          // #329: popup 路径同样只调用编排模块的开关入口
          togglePage()
            .then((result) => reply({ ok: true, status: result.status }))
            .catch((e: Error) => reply({ ok: false, error: e instanceof Error ? e.message : String(e) }));
        } catch (e) {
          reply({ ok: false, error: e instanceof Error ? e.message : String(e) });
        }
        return isMainFrame ? true : undefined;
      }

      if (msg?.type === 'pt:translate-selection') {
        // background 的 tabs.sendMessage 不带 frameId，会广播到全部 frame。
        // 选区文本随消息带来、与本 frame 无关，若不拦住子 frame，
        // 一次右键就会按 frame 数量重复翻译。
        if (!isMainFrame) return;
        translateSelection(msg.text ?? '');
        sendResponse({ ok: true });
        return;
      }
    });
  },
});
