// Phase 4/5/6 — Content script。
// 集成：三模式渲染 + 注入式 UI（悬浮球/段落按钮/toast）+
// 快捷键 + 划词交互。

import '~/src/styles/presets.css';
import { collect } from '~/src/dom/walker';
import { startObserver } from '~/src/dom/observer';
import { render, unrender, applyMode, applyStyle } from '~/src/dom/renderer';
import { applyCustomCss } from '~/src/styles/custom';
import { createBall } from '~/src/ui/floating-ball';
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

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  runAt: 'document_end',
  async main() {
    await settingsReady();
    detectOS(); // 预热平台缓存
    const s = getSettings();

    let translated = false;
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
        stopBall = createBall({
          onTranslate: () => doTranslate(),
          onRestore: () => doRestore(),
        });
      }

      if (s.showParagraphBtn) {
        stopParaBtn = createParaBtn((el) => translateOne(el));
      }
    }

    // ── 快捷键（仅主文档，避免与 iframe 内输入冲突）──
    if (isMainFrame) {
      stopHotkeys = startHotkeys({
        'toggle-translate': () => {
          translated ? doRestore() : doTranslate();
        },
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
          toast(cur ? '扩展已关闭' : '扩展已开启');
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
          stopBall = createBall({
            onTranslate: () => doTranslate(),
            onRestore: () => doRestore(),
          });
        } else if (!ns.showFloatingBall && stopBall) {
          stopBall();
          stopBall = null;
        }

        // 段落按钮开关
        if (ns.showParagraphBtn && !stopParaBtn) {
          stopParaBtn = createParaBtn((el) => translateOne(el));
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

      const texts = targets.map((el) => el.textContent?.trim() ?? '');

      const resp = await chrome.runtime.sendMessage({
        type: 'pt:translate',
        payload: { texts, from: ns.from, to: ns.to },
      });

      if (!resp?.ok) {
        console.error('[PT] 翻译失败:', resp?.error ?? '未知错误');
        if (isMainFrame)
          toast(resp?.error ?? '所有引擎均失败', 'error');
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
      translated = false;
    }

    // ── 翻译单段 ──
    async function translateOne(el: Element): Promise<void> {
      const ns = getSettings();
      if (!ns.enabled) return;

      const text = el.textContent?.trim() ?? '';
      if (!text) return;

      const resp = await chrome.runtime.sendMessage({
        type: 'pt:translate',
        payload: { texts: [text], from: ns.from, to: ns.to },
      });

      if (!resp?.ok) {
        toast('翻译失败', 'error');
        return;
      }

      render(el, resp.data.translations[0]);
    }

    // ── 翻译选区 ──
    async function translateSelection(text: string): Promise<void> {
      const ns = getSettings();
      if (!ns.enabled) return;

      const resp = await chrome.runtime.sendMessage({
        type: 'pt:translate',
        payload: { texts: [text], from: ns.from, to: ns.to },
      });

      if (!resp?.ok) {
        toast('翻译失败', 'error');
        return;
      }

      toast(resp.data.translations[0]);
    }

    // ── 监听 popup / background 消息 ──
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === 'pt:toggle-translate') {
        const reply = isMainFrame ? sendResponse : () => {};
        try {
          const willTranslate = !translated;
          if (willTranslate) {
            doTranslate()
              .then((status) => {
                if (status === 'translated') {
                  translated = true;
                  stopObserving = startObserver((els) => {
                    doTranslate(els).catch((e) =>
                      console.error('[PT] 增量补翻失败:', e),
                    );
                  });
                }
                reply({ ok: true, status });
              })
              .catch((e: Error) =>
                reply({ ok: false, error: String(e) }),
              );
          } else {
            Promise.resolve()
              .then(() => doRestore())
              .then(() => reply({ ok: true, status: 'restored' }))
              .catch((e: Error) =>
                reply({ ok: false, error: String(e) }),
              );
          }
        } catch (e) {
          reply({ ok: false, error: String(e) });
        }
        return isMainFrame ? true : undefined;
      }

      if (msg?.type === 'pt:translate-selection') {
        translateSelection(msg.text ?? '');
        sendResponse({ ok: true });
        return;
      }
    });
  },
});
