// Phase 4/5/6 — Content script。
// 集成：三模式渲染 + 注入式 UI（悬浮球/段落按钮/toast）+
// 快捷键 + 划词交互。

// tokens 必须与 presets 一同注入宿主页面 —— presets.css 里的 var(--pt-brass)
// 只在有令牌定义时才成立，否则 border-left 在计算值时刻失效，默认样式无边框。
import '~/src/styles/tokens.css';
import '~/src/styles/presets.css';
import { collect } from '~/src/dom/walker';
import { normalizeText } from '~/src/dom/normalize';
import { startObserver } from '~/src/dom/observer';
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
    applyMode(s.displayMode);
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
      applyMode(ns.displayMode);
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
    async function doTranslate(
      elements?: Element[],
    ): Promise<string> {
      const ns = getSettings();
      if (!ns.enabled) return 'disabled';

      const targets = elements ?? collect();
      if (targets.length === 0) return 'no-elements';

      // 归一化内部空白：硬换行切词、撑破 OpenAI 编号结构都源于未折叠的 \n
      const texts = targets.map((el) => normalizeText(el.textContent ?? ''));

      const resp = await chrome.runtime.sendMessage({
        type: 'pt:translate',
        payload: { texts, from: ns.from, to: ns.to },
      });

      if (!resp?.ok) {
        console.error('[PT] 翻译失败:', resp?.error ?? '未知错误');
        if (isMainFrame)
          toast(resp?.error ?? tf('toastAllEnginesFail', '所有引擎均失败'), 'error');
        return 'error';
      }

      const translations: string[] = resp.data.translations;
      for (let i = 0; i < targets.length; i++) {
        render(targets[i]!, translations[i]!);
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
        console.error('[PT] 翻译失败:', e);
        if (isMainFrame) {
          toast(String(e), 'error');
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

      const text = normalizeText(el.textContent ?? '');
      if (!text) return;

      const resp = await chrome.runtime.sendMessage({
        type: 'pt:translate',
        payload: { texts: [text], from: ns.from, to: ns.to },
      });

      if (!resp?.ok) {
        toast(tf('toastTranslateFail', '翻译失败'), 'error');
        return;
      }

      render(el, resp.data.translations[0]);
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
            .catch((e: Error) => reply({ ok: false, error: String(e) }));
        } catch (e) {
          reply({ ok: false, error: String(e) });
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
