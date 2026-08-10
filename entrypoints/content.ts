// Phase 4/5/6 — Content script。
// 集成：三模式渲染 + 注入式 UI（悬浮球/段落按钮/toast）+
// 快捷键 + 划词交互。

// tokens 必须与 presets 一同注入宿主页面 —— presets.css 里的 var(--pt-brass)
// 只在有令牌定义时才成立，否则 border-left 在计算值时刻失效，默认样式无边框。
import '~/src/styles/tokens.css';
import '~/src/styles/presets.css';
import { collect } from '~/src/dom/walker';
import { closestUnit } from '~/src/dom/classify';
import { normalizeText } from '~/src/dom/normalize';
import { translatableText, shallowTranslatableText, hasBlockTextChildren } from '~/src/dom/text';
import { startObserver, registerHidden } from '~/src/dom/observer';
import { render, unrender, applyMode, applyStyle } from '~/src/dom/renderer';
import { applyCustomCss } from '~/src/styles/custom';
import { createBall, setBallState } from '~/src/ui/floating-ball';
import { createParaBtn } from '~/src/ui/paragraph-btn';
import { toast } from '~/src/ui/toast';
import { startHotkeys } from '~/src/hotkeys/listener';
import { startSelectionDrag } from '~/src/ui/selection-drag';
import { detectOS } from '~/src/hotkeys/platform';
import {
  settingsReady,
  getSettings,
  onSettingsChanged,
  patchSettings,
} from '~/src/storage/settings';
import type { Settings } from '~/src/storage/schema';
import { tf } from '~/src/i18n';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  runAt: 'document_end',
  async main() {
    await settingsReady();
    detectOS(); // 预热平台缓存
    const s = getSettings();

    let stopObserving: (() => void) | null = null;
    let stopHotkeys: (() => void) | null = null;
    let stopDrag: (() => void) | null = null;
    let stopBall: (() => void) | null = null;
    let stopParaBtn: (() => void) | null = null;

    const isMainFrame = window.top === window;

    // ── 初始模式/样式 ──
    applyMode(s.displayMode, s.paraDisplayMode);
    applyStyle(s.style);
    if (s.customCss) applyCustomCss(s.customCss);

    // ── 注入 UI（仅主文档）──
    if (isMainFrame) {
      if (s.showFloatingBall) {
        stopBall = createBall({ onToggle: () => void togglePage() });
      }

      if (s.showParagraphBtn) {
        stopParaBtn = createParaBtn({
          translate: (el) => translateOne(el),
          restore: (el) => unrender(el),
        });
      }
    }

    // ── 快捷键（仅主文档，避免与 iframe 内输入冲突）──
    if (isMainFrame) {
      stopHotkeys = startHotkeys({
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
      });
    }

    // ── 划词拖动 ──
    stopDrag = startSelectionDrag((text) => translateSelection(text));

    // ── 设置变更监听 ──
    onSettingsChanged((ns: Settings) => {
      applyMode(ns.displayMode, ns.paraDisplayMode);
      applyStyle(ns.style);
      applyCustomCss(ns.customCss);

      if (isMainFrame) {
        // 悬浮球开关
        if (ns.showFloatingBall && !stopBall) {
          stopBall = createBall({ onToggle: () => void togglePage() });
        } else if (!ns.showFloatingBall && stopBall) {
          stopBall();
          stopBall = null;
        }

        // 段落按钮开关
        if (ns.showParagraphBtn && !stopParaBtn) {
          stopParaBtn = createParaBtn({
          translate: (el) => translateOne(el),
          restore: (el) => unrender(el),
        });
        } else if (!ns.showParagraphBtn && stopParaBtn) {
          stopParaBtn();
          stopParaBtn = null;
        }
      }
    });

    // ── 翻译全页 ──
    // #25: 分批发送 + 渐进渲染。每批独立 sendMessage，返回即渲染，
    // 用户在第一屏译文出现前不再需要等待全页最慢段。
    const FULL_PAGE_BATCH_SIZE = 15;

    async function doTranslate(
      elements?: Element[],
    ): Promise<string> {
      const ns = getSettings();
      if (!ns.enabled) return 'disabled';

      let targets: Element[];
      try {
        targets = elements ?? collect(document.body, registerHidden);
      } catch (e) {
        throw new Error(
          `[collect] ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      if (targets.length === 0) {
        if (isMainFrame)
          toast(tf('hintNoElements', '本页没有可翻译的内容'));
        return 'no-elements';
      }

      // 归一化内部空白：硬换行切词、撑破 OpenAI 编号结构都源于未折叠的 \n。
      // translatableText 剔除 .notranslate 与站点元数据（如 Google 来源角标）。
      // #23：混合内容元素（直接文本 + 块级子元素）使用 shallowTranslatableText，
      // 只提取直接文本，嵌套块级子元素由各自的翻译单元独立翻译。
      const texts = targets.map((el) =>
        normalizeText(
          hasBlockTextChildren(el)
            ? shallowTranslatableText(el)
            : translatableText(el),
        ),
      );

      // 切分为批次
      const batches: { texts: string[]; targets: Element[] }[] = [];
      for (let i = 0; i < targets.length; i += FULL_PAGE_BATCH_SIZE) {
        batches.push({
          texts: texts.slice(i, i + FULL_PAGE_BATCH_SIZE),
          targets: targets.slice(i, i + FULL_PAGE_BATCH_SIZE),
        });
      }

      let allFailed = true;
      let renderRejected = 0;
      let renderSucceeded = 0;

      // 所有批次并发发送，每批返回即渲染。
      // Google Web 的并发闸门是惰性单例，所有批次共享，自然排队。
      await Promise.all(
        batches.map(async ({ texts: batchTexts, targets: batchTargets }) => {
          const resp = await chrome.runtime.sendMessage({
            type: 'pt:translate',
            payload: { texts: batchTexts, from: ns.from, to: ns.to },
          });

          if (!resp?.ok) {
            console.error('[PT] 批次翻译失败:', resp?.error ?? '未知错误');
            return;
          }

          allFailed = false;

          const translations: string[] = resp.data.translations;
          for (let i = 0; i < batchTargets.length; i++) {
            try {
              if (render(batchTargets[i]!, translations[i]!, 'page')) {
                renderSucceeded++;
              } else {
                renderRejected++;
              }
            } catch (e) {
              throw new Error(
                `[render idx=${i}] ${e instanceof Error ? e.message : String(e)}`,
              );
            }
          }
        }),
      );

      // #49：整页翻译结束后用一条 toast 汇总被拒数量，而不是逐条刷屏
      if (renderRejected > 0 && isMainFrame) {
        toast(
          tf('toastRenderRejected', `${renderRejected} 段因含图片/按钮未翻译`),
          'info',
        );
      }

      if (allFailed) {
        if (isMainFrame)
          toast(tf('toastAllEnginesFail', '所有引擎均失败'), 'error');
        return 'error';
      }

      // #49：引擎返回了结果，但全被 render() 拒绝（纵深防御命中），
      // 状态不应是 'translated'，悬浮球不应点亮成「已翻译」
      if (renderSucceeded === 0) {
        if (isMainFrame)
          toast(tf('toastAllRejected', '所有段落均含图片/按钮，无法翻译'), 'error');
        return 'error';
      }

      return 'translated';
    }

    // ── 还原 ──
    function doRestore(): void {
      if (stopObserving) {
        stopObserving();
        stopObserving = null;
      }

      // allTranslated() 已支持 shadow 穿透（Phase 3 P3-3 修复）
      const els: Element[] = [];
      const collectFrom = (root: ParentNode) => {
        root.querySelectorAll<Element>('[data-pt="done"]').forEach((el) =>
          els.push(el),
        );
        root.querySelectorAll('*').forEach((el) => {
          if ((el as Element).shadowRoot)
            collectFrom((el as Element).shadowRoot!);
        });
      };
      collectFrom(document);

      for (const el of els) {
        unrender(el);
      }
    }

    /**
     * 页面上是否存在已翻译段落（带 shadow 穿透，短路返回）。
     * 翻译态以真实 DOM 为准而不是布尔标志：单段翻译（translateOne）与
     * observer 增量补翻都会落 data-pt="done"，只有整页翻译会记布尔，
     * 仅查标志会把「页面上已有译文」误判成「没翻过」，toggle 走错分支。
     */
    function hasTranslated(): boolean {
      const walk = (root: ParentNode): boolean => {
        if (root.querySelector('[data-pt="done"]')) return true;
        for (const el of root.querySelectorAll('*')) {
          const sr = (el as Element).shadowRoot;
          if (sr && walk(sr)) return true;
        }
        return false;
      };
      return walk(document);
    }

    /**
     * 翻译 / 还原的单一入口 —— 悬浮球、快捷键、popup 三条路径共用。
     *
     * 翻译态（DOM 上是否存在译文 + observer）是整个 frame 共享的一份
     * 状态，任何入口各自记一份都会导致「按了没反应」或「重复翻一遍」。
     * 悬浮球的视觉由这里通过 setBallState 单向推送。
     */
    async function togglePage(): Promise<string> {
      if (hasTranslated()) {
        doRestore();
        if (isMainFrame) setBallState('idle');
        return 'restored';
      }

      if (isMainFrame) setBallState('loading');
      let status: string;
      try {
        status = await doTranslate();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[PT] 翻译失败:', msg, e);
        if (isMainFrame) {
          toast(msg, 'error');
          setBallState('error');
        }
        return 'error';
      }

      if (status === 'translated') {
        // 增量补翻对三个入口一视同仁 —— 无限滚动/SPA 不该因为
        // 用户点的是悬浮球而失效
        if (!stopObserving) {
          stopObserving = startObserver((els) => {
            doTranslate(els).catch((e) =>
              console.error('[PT] 增量补翻失败:', e),
            );
          });
        }
      }

      if (isMainFrame) {
        setBallState(
          status === 'translated'
            ? 'done'
            : status === 'error'
              ? 'error'
              : 'idle',
        );
      }
      return status;
    }

    // ── 翻译单段 ──
    async function translateOne(el: Element): Promise<void> {
      const ns = getSettings();
      if (!ns.enabled) return;

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

      const text = normalizeText(translatableText(unit));
      if (!text) return;

      const resp = await chrome.runtime.sendMessage({
        type: 'pt:translate',
        payload: { texts: [text], from: ns.from, to: ns.to },
      });

      if (!resp?.ok) {
        toast(tf('toastTranslateFail', '翻译失败'), 'error');
        return;
      }

      // render() 在含媒体 / 交互控件时会拒绝渲染（#22），此时告知用户
      // 而非静默吞掉元素
      if (!render(unit, resp.data.translations[0], 'para')) {
        toast(tf('toastNotTranslatable', '该区域无法单独翻译'), 'error');
      }
    }

    // ── 翻译选区 ──
    async function translateSelection(text: string): Promise<void> {
      // 跨行划词时选区文本天然带 \n，入口归一化
      text = normalizeText(text);
      const ns = getSettings();
      if (!ns.enabled) return;

      const resp = await chrome.runtime.sendMessage({
        type: 'pt:translate',
        payload: { texts: [text], from: ns.from, to: ns.to },
      });

      if (!resp?.ok) {
        toast(tf('toastTranslateFail', '翻译失败'), 'error');
        return;
      }

      toast(resp.data.translations[0]);
    }

    // ── 监听 popup / background 消息 ──
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === 'pt:toggle-translate') {
        const reply = isMainFrame ? sendResponse : () => {};
        try {
          togglePage()
            .then((status) => reply({ ok: true, status }))
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
