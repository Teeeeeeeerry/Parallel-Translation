// Phase 2 — Content script。
// 接收 popup 的 toggle 指令，驱动采集 → 翻译 → 注入 / 还原的最短闭环。

import '~/src/styles/content.css';
import { collectSimple } from '~/src/dom/collect';
import { injectSimple, removeSimple, allTranslated } from '~/src/dom/inject';
import { settingsReady, getSettings } from '~/src/storage/settings';

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    let translated = false;

    async function doTranslate(): Promise<string> {
      await settingsReady();
      const s = getSettings();

      // 总开关关闭时不翻译
      if (!s.enabled) return 'disabled';

      // 收集待翻译节点
      const elements = collectSimple();
      if (elements.length === 0) return 'no-elements';

      const texts = elements.map((el) => el.textContent?.trim() ?? '');

      // 通过 background 代理翻译（content script 不能直接 fetch 跨域端点）
      const resp = await chrome.runtime.sendMessage({
        type: 'pt:translate',
        payload: { texts, from: s.from, to: s.to },
      });

      if (!resp?.ok) {
        console.error('[PT] 翻译失败:', resp?.error ?? '未知错误');
        showError(elements[0]!, resp?.error ?? '所有引擎均失败');
        return 'error';
      }

      const translations: string[] = resp.data.translations;
      for (let i = 0; i < elements.length; i++) {
        injectSimple(elements[i]!, translations[i]!);
      }

      translated = true;
      return 'translated';
    }

    function doRestore(): void {
      const els = allTranslated();
      for (const el of els) {
        removeSimple(el);
      }
      translated = false;
    }

    function showError(el: Element, msg: string): void {
      // 在页面上给出可见提示，而非静默失败
      const div = document.createElement('div');
      div.textContent = `⚠ Parallel-Translation: ${msg}`;
      div.style.cssText =
        'position:fixed;top:12px;right:12px;' +
        'background:#c0392b;color:#fff;' +
        'padding:8px 14px;border-radius:6px;font-size:13px;z-index:2147483647;';
      document.body.appendChild(div);
      setTimeout(() => div.remove(), 5000);
    }

    // 监听来自 popup 的 toggle 消息
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type !== 'pt:toggle-translate') return;

      const willTranslate = !translated;
      (willTranslate
        ? doTranslate()
        : Promise.resolve().then(() => doRestore()).then(() => 'restored'))
        .then((status) => sendResponse({ ok: true, status }))
        .catch((e: Error) => sendResponse({ ok: false, error: String(e) }));

      return true; // 保持通道开启
    });
  },
});
