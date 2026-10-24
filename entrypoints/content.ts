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
import {
  translatableText,
  shallowTranslatableText,
  unitTextEx,
  restorePreserves,
} from '~/src/dom/text';
import { startObserver } from '~/src/dom/observer';
import { render, unrender, applyMode, applyStyle } from '~/src/dom/renderer';
import {
  buildPageItem,
  hasTranslated,
  renderPageItem,
  restorePage,
  type PageItemCtx,
} from '~/src/dom/page-dom';
import { applyCustomCss } from '~/src/styles/custom';
import { createBall, setBallState } from '~/src/ui/floating-ball';
import { createParaBtn } from '~/src/ui/paragraph-btn';
import { floatingUiVars } from '~/src/ui/floating-ui-size';
import { createInputDot } from '~/src/ui/input-dot';
import { parseInputLangChoice, type InputLangChoice } from '~/src/ui/input-target-lang';
import { watchPathChange } from '~/src/ui/path-watch';
import { toast } from '~/src/ui/toast';
import { startHotkeys } from '~/src/hotkeys/listener';
import { startSelectionDrag } from '~/src/ui/selection-drag';
import { createSelectionTranslator } from '~/src/ui/selection-translate';
import { createLifecycleRegistry } from '~/src/ui/lifecycle-registry';
import { createInputTranslator } from '~/src/ui/input-translate';
import {
  createOrchestrator,
  type PageToggleResult,
} from '~/src/orchestration/orchestrator';
import type { TranslateItem, TranslateBatchResult } from '~/src/orchestration/orchestrator';
import { createPageTranslation, type PageSession } from '~/src/orchestration/page-session';
import {
  allFailedNotice,
  countRender,
  emptyRenderStats,
  emptySkipStats,
  framePageNotice,
  partialFailNotice,
  resetRenderStats,
  skipConsoleLine,
} from '~/src/orchestration/page-summary';
import { describePageGate } from '~/src/orchestration/page-gate';
import { paraNotice } from '~/src/orchestration/text-notice';
import { translateViaBackground } from '~/src/runtime/messaging';
import { createLangDetector } from '~/src/runtime/lang-detect';
import { detectOS } from '~/src/hotkeys/platform';
import {
  settingsReady,
  getSettings,
  onSettingsChanged,
  patchSettings,
} from '~/src/storage/settings';
import type { Settings } from '~/src/storage/schema';
import { clampParaBtnHideDelay } from '~/src/storage/schema';
import { watchEffectiveDomains, currentDomain, parseDomainChoice } from '~/src/storage/domains';
import type { Domain, DomainChoice } from '~/src/storage/domains';
import { siteRulesReady } from '~/src/storage/specialization';
import { loadUiLocale, tf } from '~/src/i18n';
import { loadMessagesViaBackground } from '~/src/runtime/ui-messages';
import { isSiteBlocked } from '~/src/dom/site-filter';
import { decideShow } from '~/src/changelog/decide';
import { clearSeen } from '~/src/changelog/state';

/** #1083：批次耗时调试日志的开关（storage.local），默认没有。 */
const DEBUG_BATCH_TIMING_KEY = 'pt-debug-batch-timing';

/**
 * 子 frame 取顶层页面的主机名（#471）。跨域时读不到 window.top.location，
 * Firefox 也没有 location.ancestorOrigins，改由 background 按消息发送方
 * 所在标签页的网址告知。取不到时回落到本 frame 的主机名。
 */
async function requestTopHostname(): Promise<string> {
  try {
    const res: unknown = await chrome.runtime.sendMessage({ type: 'pt:top-hostname' });
    const hostname = (res as { hostname?: unknown } | undefined)?.hostname;
    if (typeof hostname === 'string' && hostname) return hostname;
  } catch {
    // background 没有响应：按本 frame 判定
  }
  return location.hostname;
}

/**
 * #400: 子 frame 向主文档要本标签页的临时领域选择（经 background 转问
 * frameId 0）。取不到时返回 null，按自动判定。
 */
async function requestTopDomainChoice(): Promise<DomainChoice | null> {
  try {
    const res: unknown = await chrome.runtime.sendMessage({ type: 'pt:top-domain-choice' });
    return parseDomainChoice((res as { choice?: unknown } | undefined)?.choice);
  } catch {
    return null;
  }
}

/**
 * #663: 子 frame 向主文档要本标签页这一次的对方语言（经 background 转问
 * frameId 0），与 requestTopDomainChoice 同一条路。取不到时返回 null，跟随设置。
 */
async function requestTopInputLangChoice(): Promise<InputLangChoice | null> {
  try {
    const res: unknown = await chrome.runtime.sendMessage({ type: 'pt:top-input-lang-choice' });
    return parseInputLangChoice((res as { choice?: unknown } | undefined)?.choice);
  } catch {
    return null;
  }
}

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  // #838：about:blank（含 document.write 写出的）与 srcdoc 的 frame 没有可匹配的
  // 网址，按创建它的父页面匹配
  matchAboutBlank: true,
  // #849：sandbox 的 srcdoc（opaque origin）、data: 与 blob: 的 frame 同样按父页面
  // 的网址匹配。网页邮箱的邮件正文、文件预览常放在这几种 frame 里，以前整页翻译
  // 翻不到、输入框没有圆点。扩展只在用户点了之后才动作，注入本身不改页面
  matchOriginAsFallback: true,
  runAt: 'document_end',
  async main(ctx) {
    await settingsReady();
    // #1101：选了扩展语言时先向后台要取文表，载完再显示任何依赖文案的界面
    // （悬浮球、提示条、更新提示）；跟随浏览器时不发消息、立即返回
    let uiLocaleChoice = getSettings().uiLocale;
    await loadUiLocale(uiLocaleChoice, loadMessagesViaBackground);
    // #164: 必须等平台缓存就绪再注册快捷键 —— 否则首次按键按 'other'
    // 匹配（忽略 metaKey），Mac 用户加载后的第一次 ⌘⇧Y 静默无响应
    await detectOS();
    const s = getSettings();
    // #379: 生效领域列表 —— 全页翻译据此选出当前领域，请求里带上领域 ID。
    // #417: 设置页改了领域后随之刷新，已打开的标签页无需刷新页面。
    // #486: 初始列表也经订阅交付，与变更推送按发起先后取最新的一次；
    // 等到第一次交付再往下走。content script 失效（扩展重载 / 更新）时退订
    let domains: Domain[] = [];
    await new Promise<void>((resolve) => {
      ctx.onInvalidated(
        watchEffectiveDomains(
          (next) => {
            domains = next;
            resolve();
          },
          { initial: true },
        ),
      );
    });
    // #370: 载入用户站点规则 —— 之后全页翻译与逐段翻译同步读取生效站点规则
    await siteRulesReady();

    // #242/#243/#255: UI 生命周期注册表 —— 悬浮球、段落按钮、划词拖拽、
    // 快捷键、observer 全部经注册表启停；设置变更由 ensure() 驱动，
    // 启停成对、重复注册幂等；五个 stop 变量与重复创建块已删除
    const registry = createLifecycleRegistry();

    const isMainFrame = window.top === window;

    // #471: 顶层页面的主机名 —— 当前领域按它判定，一个标签页里所有 frame
    // 得到同一个领域
    const topHostname = isMainFrame ? location.hostname : await requestTopHostname();

    // #400: 用户在 popup 里为本标签页临时选的领域。只存在本页内存里：
    // 刷新、跳页或关闭标签页后回到自动，其他标签页不受影响。#847：单页应用
    // 换了路径也算跳页，见下面的 pathWatch
    let domainChoice: DomainChoice = { kind: 'auto' };
    /** 本 frame 是否已收到过切换广播 —— 收到过就不再采用启动时问来的选择。 */
    let choiceBroadcast = false;

    // #662: 用户在 popup 里为本标签页临时选的对方语言（输入翻译），与上面
    // 的临时领域并列：只存在本页的内存里，不进后台、不写存储。所以刷新、
    // 跳页、关闭标签页后自然回到跟随设置，别的标签页也不受影响。
    // #663: 选择广播到本页全部 frame，每个 frame 各存一份；子 frame 启动时
    // 向主文档问一次
    let inputLangChoice: InputLangChoice = { kind: 'auto' };
    /** 本 frame 是否已收到过语言选择的广播 —— 收到过就不再采用启动时问来的选择。 */
    let inputLangBroadcast = false;

    // #836：单页应用换路由也算跳页。主文档盯住网址，路径变了就把这一次的
    // 对方语言重置为跟随设置，并经 background 广播给本页全部 frame —— 不广播
    // 的话 iframe 里还留着旧的选择。同一路径上只换查询参数或 hash 不算。
    // 拍板理由：在用户眼里，单页应用里点进另一个帖子就是跳页；临时选择的
    // 全部意义就是不悄悄变成长期设置。两种错的代价也不对称：多重置一次只是
    // 回到自动判定，那本来就是默认行为；不重置的话，用户在国际站点上选了
    // 英文，点进一个日文帖子回复时仍被译成英文。
    // #847：领域的临时选择（#400）用的是同一套机制，同一个理由，一并重置为
    // 按网址判定，经 background 的 pt:domain-path-changed 广播给各 frame。
    // 两样各自只在不是自动时才重置、才广播
    const pathWatch = isMainFrame
      ? watchPathChange({
          getHref: () => location.href,
          navigation: (window as { navigation?: EventTarget }).navigation,
          win: window,
          onChange: () => {
            if (inputLangChoice.kind !== 'auto') {
              inputLangChoice = { kind: 'auto' };
              chrome.runtime.sendMessage({ type: 'pt:input-lang-path-changed' }).catch(() => {});
            }
            if (domainChoice.kind !== 'auto') {
              domainChoice = { kind: 'auto' };
              chrome.runtime.sendMessage({ type: 'pt:domain-path-changed' }).catch(() => {});
            }
          },
        })
      : null;

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
            // #972: 取值函数而不是快照 —— 每次开始倒计时都读当前设置，改了即时生效。
            // 读出路径不经写入口，再钳一次
            hideDelay: () => clampParaBtnHideDelay(getSettings().paraBtnHideDelay),
          }),
        stop: (stopParaBtn) => stopParaBtn(),
      });
    }

    // 输入翻译入口（#639）：圆点点下去走这里
    const translateInput = createInputTranslator({
      translateText: (text, from, to, opts) => orchestrator.translateText(text, from, to, opts),
      sourceLang: () => {
        // #836：浏览器没有 Navigation API 时收不到 pushState，用之前补判一次
        pathWatch?.check();
        // #663：popup 里临时选了这一次的对方语言，就用它顶替源语言设置这一级
        return inputLangChoice.kind === 'lang' ? inputLangChoice.lang : getSettings().from;
      },
      detectedLang: () => orchestrator.detectedLang(),
      reliableLang: (text) => langDetector.reliableLang(text),
    });

    // ── 输入翻译圆点（每个 frame 都注入，#636）──
    // iframe 里的评论框、客服窗口是输入翻译的主场之一，所以不像悬浮球、
    // 段落按钮那样只挂在主文档；inputTranslate 决定是否启动
    registry.register('input-dot', {
      create: () => createInputDot({ translate: (el) => translateInput(el) }),
      stop: (stopInputDot) => stopInputDot(),
    });

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
                const start = sel.getRangeAt(0).startContainer;
                const el = start?.parentElement;
                if (el) translateOne(el, start);
              }
            },
            'toggle-extension': () => {
              const cur = getSettings().enabled;
              patchSettings({ enabled: !cur }).catch(() => {});
              toast(cur ? tf('toastExtOff', '扩展已关闭') : tf('toastExtOn', '扩展已开启'), { purpose: 'status' });
            },
          }),
        stop: (stopHotkeys) => stopHotkeys(),
      });
      registry.ensure('hotkeys', true);
    }

    // 划词翻译入口：拖选划词与右键菜单都走这里
    const translateSelection = createSelectionTranslator({
      translateText: (text, from, to, opts) => orchestrator.translateText(text, from, to, opts),
      getLangs: () => {
        const ns = getSettings();
        return { from: ns.from, to: ns.to };
      },
    });

    // ── 划词拖动 ──
    // #244: 划词拖拽经注册表启停（无设置开关，恒启用）
    registry.register('drag', {
      create: () => startSelectionDrag((text) => translateSelection(text)),
      stop: (stopDrag) => stopDrag(),
    });
    registry.ensure('drag', true);

    /**
     * #632：当前站点是否获得准入 —— 复用站点名单判定，与编排模块的准入
     * （整页、逐段、划词翻译）同一个口径、同一个主机名。鼠标路过就浮出的
     * UI 按它决定要不要注册：站点没获准入时根本不挂监听，而不是浮出来、
     * 点下去才提示被禁用。输入翻译圆点（#649）同样按它门控。
     *
     * #686：扩展总开关也算在内 —— 总开关关掉时编排模块的准入同样拦下
     * （静默不响应），所以这类 UI 也不该注册。
     */
    function uiAdmitted(ns: Settings): boolean {
      return ns.enabled && !isSiteBlocked(location.hostname, ns.siteList);
    }

    // ── 设置变更统一入口（#265）──
    // 初始化与设置变更共用：样式应用 + UI 启停（经注册表 ensure）。
    // 订阅由编排模块持有（start 订阅 / stop 退订），此处只有一份
    // 响应代码，无重复的创建 / 变更处理块。
    function applySettings(ns: Settings): void {
      // #1101：扩展语言变了换表。之后新出现的界面用新语言，已经显示的提示条
      // 不重绘；悬浮球、输入翻译圆点的可读名称经 onUiLocaleChange 自己更新
      if (ns.uiLocale !== uiLocaleChoice) {
        uiLocaleChoice = ns.uiLocale;
        void loadUiLocale(ns.uiLocale, loadMessagesViaBackground);
      }
      applyMode(ns.displayMode, ns.paraDisplayMode);
      applyStyle(ns.style);
      applyCustomCss(ns.customCss);

      // #966: 悬浮 UI 尺寸写在文档根上，经继承到达每个 shadow 里的球、按钮与圆点，
      // 包括之后才创建的（开关先关后开、站点准入变化）。只改变量不重挂球：
      // 翻译状态与每站位置都留在原处。#987: 输入翻译圆点每个 frame 都注入，
      // 变量写入挪到主文档分支之外；球与按钮的启停仍只在主文档
      const rootStyle = document.documentElement.style;
      for (const [name, value] of Object.entries(floatingUiVars(ns))) {
        rootStyle.setProperty(name, value);
      }
      if (isMainFrame) {
        // #242/#243: 悬浮球 / 段落按钮开关经注册表 ensure —— 启停幂等、即时生效
        registry.ensure('ball', ns.showFloatingBall);
        // #632: 段落按钮还要站点获得准入；改名单经此入口即时启停
        // #686: 与输入翻译圆点同一份判定，总开关关掉同样不注册
        registry.ensure('para-btn', ns.showParagraphBtn && uiAdmitted(ns));
      }
      // #636: 输入翻译圆点在每个 frame 经注册表 ensure —— 启停幂等、即时生效
      // #649: 还要扩展总开关打开、站点获得准入（与逐段按钮同一份判定）；
      // 改名单、开关总开关都经此入口即时启停
      registry.ensure('input-dot', ns.inputTranslate && uiAdmitted(ns));
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

    /**
     * 增量补翻的渲染统计（每次开始时清零），各项含义见 RenderStats。#1077：整页
     * 翻译的统计归整页翻译会话，按轮各记各的，不与这里共用。
     */
    const renderStats = emptyRenderStats();

    // #852：浏览器自带的本地语言识别，不发网络请求。页面级闸门取各语言占比
    // （#843），输入翻译取单一可靠结果（#661）
    const langDetector = createLangDetector();

    // #1083：批次耗时的调试日志，默认不开。在扩展的 service worker 控制台里执行
    // chrome.storage.local.set({ 'pt-debug-batch-timing': true }) 打开，刷新页面后
    // 生效；每批每次尝试打一行“[PT] 批次耗时 {…}”：content 侧发送闸门排队、后台
    // 引擎闸门排队、引擎调用三段与是否超时。关着时一点不测
    const debugBatchTiming = await chrome.storage.local
      .get(DEBUG_BATCH_TIMING_KEY)
      .then((r) => r[DEBUG_BATCH_TIMING_KEY] === true)
      .catch(() => false);

    // #261: 编排模块 —— 全页翻译的批次流水线在模块内，
    // 渲染回调按批触发（#256 渐进渲染，首屏不等最慢段）
    const orchestrator = createOrchestrator({
      send: translateViaBackground,
      ...(debugBatchTiming && {
        onBatchTiming: (record) => console.info('[PT] 批次耗时 ' + JSON.stringify(record)),
      }),
      // #265: 设置变更订阅由模块持有（start 订阅 / stop 退订），
      // 响应走统一入口 applySettings（初始化与变更共用）。
      // #310: 载荷类型收紧为真实 Settings，此处不再需要强制转型
      subscribeSettings: onSettingsChanged,
      onSettingsChange: (ns) => applySettings(ns),
      // #310: 读取当前设置经注入项提供，模块自身不直接访问存储；
      // #311: 准入判定的当前主机名同样经注入提供
      getSettings,
      getHostname: () => location.hostname,
      // #471: 当前领域按顶层页面判定；准入判定仍按本 frame 的主机名
      getTopHostname: () => topHostname,
      getDomains: () => domains,
      // #847：浏览器没有 Navigation API 时收不到 pushState，用之前补判一次
      getDomainChoice: () => {
        pathWatch?.check();
        return domainChoice;
      },
      isMainFrame: () => isMainFrame,
      // #792：页面级闸门读本 frame 的语言声明
      getPageLang: () => document.documentElement.getAttribute('lang'),
      // #843：页面级闸门的第一级 —— 浏览器自带的语言识别，零网络请求
      detectContentLang: langDetector.distribution,
      // #857：闸门每判一次就记一笔，带依据，排查时看得出走的是哪一级
      onGateDecision: (decision) => console.debug('[PT] 页面级闸门：' + describePageGate(decision)),
    });
    // #261/#265: 启动编排 —— 未启动时翻译入口拒绝执行；设置变更
    // 订阅随 start 建立
    orchestrator.start();

    /**
     * 整页翻译（#1077、#1078）：采集去重、按轮统计、渲染、补采集、到顶交接、
     * 观察器启停与隐藏单元缓冲、还原都在整页翻译会话里，内容脚本只给 DOM 原语
     * （#1116：还原、翻译态查询、翻译项构建与渲染在 src/dom/page-dom.ts）。
     * 每次整页翻译从它新建一个会话，还原时结束。
     */
    const page = createPageTranslation<Element, PageItemCtx>({
      collect: (onSkip, onHidden) => {
        try {
          return collect(document.body, onHidden, { onSkip });
        } catch (e) {
          throw new Error(`[collect] ${e instanceof Error ? e.message : String(e)}`);
        }
      },
      // #843：只读模式供闸门取样 —— 不切块、不登记隐藏单元，页面一个字不动
      collectReadOnly: () => collect(document.body, undefined, { readOnly: true }),
      build: buildPageItem,
      render: renderPageItem,
      // #328/#1078: 观察器停止由整页翻译会话、中止在飞翻译由编排模块的开关入口
      // 执行，这里只做 DOM 还原
      unrenderAll: () => restorePage(),
      hasTranslated: () => hasTranslated(),
      // #255/#331: 增量补翻观察器 —— 整页翻译成功后由会话启动，还原时由会话停止
      observe: () =>
        startObserver((els) => {
          translateIncremental(els).catch((e) => console.error('[PT] 增量补翻失败:', e));
        }),
    });
    // #327/#1079：悬浮球只订阅整页翻译会话的状态流 —— 进行中、完成（补采集结束
    // 之后）、已还原、失败；子框架不显示
    if (isMainFrame) page.subscribe(setBallState);

    /**
     * 增量补翻那一路的渲染（#1077）：同一个渲染原语，统计记在 renderStats。
     * 只用到它的 onBatchResult —— 增量补翻的单元来自观察器，不经会话采集。
     */
    const incrementalSession = {
      onBatchResult(batch: TranslateItem<unknown>[], result: TranslateBatchResult): void {
        if (!result.ok || !result.data) {
          renderStats.failed += batch.length;
          return;
        }
        const translations = result.data.translations;
        // #416: 所有引擎都失败的段落不渲染，保持原样，结束后汇总提示
        const failed = new Set(result.data.failedIndices ?? []);
        for (let j = 0; j < batch.length; j++) {
          if (failed.has(j)) {
            renderStats.failed++;
            continue;
          }
          try {
            countRender(renderStats, renderPageItem(batch[j] as TranslateItem<PageItemCtx>, translations[j]!));
          } catch (e) {
            throw new Error(`[render idx=${j}] ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      },
    };

    /**
     * 整页开关入口（#329）—— 悬浮球、快捷键、popup 消息三条触发路径
     * 的唯一调用点：收集（DOM）→ 编排模块开关入口（准入 / 在飞互斥 /
     * 翻译态决定 / 状态推送 / 观察器启停）→ 提示渲染（DOM）。
     */
    async function togglePage(): Promise<PageToggleResult> {
      const ns = getSettings();
      // #792：按需采集 —— 页面级闸门命中、准入拦截、还原时不采集（采集会把
      // 超长段落切成切块，页面就不是一个字不动了）
      // #1011/#1077：同一次整页翻译里首轮采集与补采集共用一个会话，同一个元素
      // 只交出一次、跳过的单元只计一次
      const before = page.current();

      const result = await orchestrator.togglePage(page, ns.from, ns.to);

      // 这一次开始了新的整页翻译时才有它的统计（还原、闸门命中、准入拦截没有）
      const session: PageSession | null = page.current() !== before ? page.current() : null;
      // #763：控制台按原因分组输出一行，零跳过时不输出
      const skips = session?.skips() ?? emptySkipStats();
      const skipLine = skipConsoleLine(skips);
      if (skipLine) console.info(skipLine);

      // ── 提示渲染（DOM 职责；视觉状态已由模块推送）──
      // 同一时刻只显示一条提示，几种情况并存时给哪一条由汇总决定
      // #762：只有主文档弹，计数不跨 frame 汇总
      // #1077：这一次的汇总由会话合成（首轮与补采集各轮相加）
      const notice = framePageNotice(result, session?.totals() ?? emptyRenderStats(), skips, isMainFrame);
      if (notice) toast(notice.message, { purpose: 'status', kind: notice.kind });
      return result;
    }

    /**
     * 增量补翻（#329）：observer 的新节点回调 —— 直接走编排模块的
     * 全页流水线（准入 / 批次 / 中止 / 提示语义），不再经过开关入口
     * （不触发在飞互斥与状态推送）。
     */
    async function translateIncremental(elements: Element[]): Promise<void> {
      const ns = getSettings();
      const items = elements.map(buildPageItem);
      if (items.length === 0) return;
      resetRenderStats(renderStats);

      const summary = await orchestrator.translatePage(items, ns.from, ns.to, {
        onBatch: (batch, result) => incrementalSession.onBatchResult(batch, result),
      });

      // 中止（还原）不算失败；失败提示与整页同口径
      if (summary.abandoned) return;
      const notice = summary.allFailed
        ? allFailedNotice(summary.display)
        : partialFailNotice(renderStats, summary.display);
      if (notice && isMainFrame) toast(notice.message, { purpose: 'status', kind: notice.kind });
    }

    // ── 翻译单段 ──
    async function translateOne(el: Element, start?: Node): Promise<void> {
      // 提级到最近的可翻单元：按钮路径传来的已是精判通过的单元（原样返回）；
      // 快捷键路径拿的是选区起点的 parentElement，可能是 span 等内联元素，
      // 由这里统一向上找整段。找不到（超长 / .notranslate / 非正文区 /
      // 已翻译）则 shouldSkip 已拦下，不翻。
      let unit = closestUnit(el);
      // #712：选区起点是以 br 分行的超长段落里直接挂在段落上的文字时，精判
      // 刚把段落按行切开，这段文字已经移进它那一行的切块 —— 从它现在的父
      // 元素再找一次，翻这一行
      if (!unit && start?.parentElement && start.parentElement !== el) {
        unit = closestUnit(start.parentElement);
      }
      if (!unit) {
        console.debug('[PT] translateOne 跳过：closestUnit 返回 null', el);
        toast(tf('toastNotTranslatable', '该区域无法单独翻译'), { purpose: 'status', kind: 'error' });
        return;
      }

      const { text, preserves } = unitTextEx(unit);
      if (!text) return;

      // #314: 逐段翻译走编排模块的单文本入口 —— 准入判定（总开关 /
      // 站点名单）与失败提示语义都由模块给出，不再直连消息通道
      const ns = getSettings();
      // #659: 逐段翻译送的是页面上的文字，成功后记下引擎报告的检测语言
      const result = await orchestrator.translateText(text, ns.from, ns.to, {
        recordDetectedLang: true,
      });

      // #1075：没拿到译文时显示入口给出的提示（准入拦截、失败原因；被放弃、
      // 总开关关闭不提示），判定只在编排模块那一处
      if (!result.ok) {
        if (result.notice) toast(result.notice.message, result.notice);
        return;
      }

      // #58：将占位符替换回原文
      const restored = restorePreserves(
        result.translation,
        preserves,
        text,
      );

      // 拒绝渲染时按原因提示：含媒体 / 交互控件（#22）、已经是目标语言（#786）
      const source = restorePreserves(text, preserves, text);
      const notice = paraNotice(render(unit, restored, 'para', source));
      if (notice) toast(notice.message, notice);
    }

    // ── 翻译选区 ──
    /**
     * popup 显示用的领域状态（#399、#400）：自动判定会选中的领域、本标签页
     * 的临时选择，以及可切换到的领域。
     */
    function domainState(to: string) {
      const lang = to.toLowerCase();
      return {
        // #401: “以后在此站点都使用”按顶层页面的主机名记住
        host: topHostname,
        autoName: currentDomain(domains, topHostname, to)?.name ?? null,
        choice: domainChoice,
        // 可切换到的领域：一个领域只服务一种目标语言
        options: domains
          .filter((d) => d.targetLang.toLowerCase() === lang)
          .map((d) => ({ id: d.id, name: d.name })),
      };
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

      if (msg?.type === 'pt:current-domain') {
        // #399: popup 显示当前领域 —— 与全页翻译携带的领域同一口径
        // （本页读到的领域列表 + 顶层页面主机名，#471）；目标语言用 popup
        // 当前所选，避免设置刚改、本页还没收到变更时显示旧结果
        if (!isMainFrame) return;
        // #847：答之前补判一次路径
        pathWatch?.check();
        const to = typeof msg.to === 'string' ? msg.to : getSettings().to;
        sendResponse(domainState(to));
        return;
      }

      if (msg?.type === 'pt:set-domain') {
        // #400: popup 临时切换领域。广播到全部 frame，iframe 里的翻译请求
        // 与主文档带同一个领域；只有主文档回复
        const choice = parseDomainChoice(msg.choice);
        if (!choice) return;
        domainChoice = choice;
        choiceBroadcast = true;
        if (!isMainFrame) return;
        const to = typeof msg.to === 'string' ? msg.to : getSettings().to;
        sendResponse(domainState(to));
        return;
      }

      if (msg?.type === 'pt:get-domain-choice') {
        // #400: 子 frame 启动时经 background 来问（见 requestTopDomainChoice）。
        // #847：答之前补判一次路径
        if (!isMainFrame) return;
        pathWatch?.check();
        sendResponse({ choice: domainChoice });
        return;
      }

      if (msg?.type === 'pt:set-input-lang') {
        // #662: popup 选好这一次的对方语言。#663: 广播到全部 frame，iframe 里
        // 的输入翻译与主文档用同一种语言；只有主文档回复保存后的选择
        const choice = parseInputLangChoice(msg.choice);
        if (!choice) return;
        inputLangChoice = choice;
        inputLangBroadcast = true;
        if (!isMainFrame) return;
        sendResponse({ choice: inputLangChoice });
        return;
      }

      if (msg?.type === 'pt:get-input-lang-choice') {
        // #662: popup 打开时来问；#663: 子 frame 启动时经 background 来问
        // （见 requestTopInputLangChoice）。#836：答之前补判一次路径
        if (!isMainFrame) return;
        pathWatch?.check();
        sendResponse({ choice: inputLangChoice });
        return;
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

    // #400: 切换之后才加载的 iframe 向主文档要当前的临时选择；期间已收到
    // 切换广播的，以广播为准
    if (!isMainFrame) {
      void requestTopDomainChoice().then((choice) => {
        if (choice && !choiceBroadcast) domainChoice = choice;
      });
      // #663: 这一次的对方语言同理
      void requestTopInputLangChoice().then((choice) => {
        if (choice && !inputLangBroadcast) inputLangChoice = choice;
      });
    }
  },
});
