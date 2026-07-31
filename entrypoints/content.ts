// Phase 3 — Content script。
// 接收 popup 的 toggle 指令，驱动采集 → 翻译 → 注入 / 还原的闭环。
// 升级点：shadow DOM 穿透采集 + MutationObserver 增量补翻 + all_frames。

import '~/src/styles/content.css';
import { collect } from '~/src/dom/walker';
import { startObserver } from '~/src/dom/observer';
import { injectSimple, removeSimple, allTranslated } from '~/src/dom/inject';
import { settingsReady, getSettings } from '~/src/storage/settings';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true, // 每个同源 iframe 自动获得独立 content script 实例
  runAt: 'document_end',
  main() {
    let translated = false;
    let stopObserving: (() => void) | null = null;

    async function doTranslate(elements?: Element[]): Promise<string> {
      await settingsReady();
      const s = getSettings();

      // 总开关关闭时不翻译
      if (!s.enabled) return 'disabled';

      // 收集待翻译节点（未传入时从页面采集）
      const targets = elements ?? collect();
      if (targets.length === 0) return 'no-elements';

      const texts = targets.map((el) => el.textContent?.trim() ?? '');

      // 通过 background 代理翻译（content script 不能直接 fetch 跨域端点）
      const resp = await chrome.runtime.sendMessage({
        type: 'pt:translate',
        payload: { texts, from: s.from, to: s.to },
      });

      if (!resp?.ok) {
        console.error('[PT] 翻译失败:', resp?.error ?? '未知错误');
        showError(targets[0]!, resp?.error ?? '所有引擎均失败');
        return 'error';
      }

      const translations: string[] = resp.data.translations;
      for (let i = 0; i < targets.length; i++) {
        injectSimple(targets[i]!, translations[i]!);
      }

      return 'translated';
    }

    function doRestore(): void {
      // 停止增量监听
      if (stopObserving) {
        stopObserving();
        stopObserving = null;
      }

      const els = allTranslated();
      for (const el of els) {
        removeSimple(el);
      }
      translated = false;
    }

    function showError(el: Element, msg: string): void {
      // 在页面上给出可见提示，而非静默失败。
      // 宿主可能是 XML / SVG 文档，或 body 尚未就绪 —— 取不到挂载点就退回
      // documentElement，绝不让这里抛错。
      const host = document.body ?? document.documentElement;
      if (!host) return;
      const div = document.createElement('div');
      div.textContent = `⚠ Parallel-Translation: ${msg}`;
      div.style.cssText =
        'position:fixed;top:12px;right:12px;' +
        'background:#c0392b;color:#fff;' +
        'padding:8px 14px;border-radius:6px;font-size:13px;z-index:2147483647;';
      host.appendChild(div);
      setTimeout(() => div.remove(), 5000);
    }

    // popup 的 toggle 消息会广播到本标签页的每一个 frame（all_frames 注入）。
    // 每个 frame 都要照常翻译自己的文档，但只有主文档应答 —— 多个 frame 抢答时
    // 调用方只收得到其中一个，若被空 iframe 抢先，popup 会误报
    // 「本页没有可翻译的内容」。子 frame 不调 sendResponse、返回 undefined，
    // 响应通道就只由主文档占用。
    const isMainFrame = window.top === window;

    // 监听来自 popup 的 toggle 消息
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      // msg 可能是 null / 非对象 —— 直接解引用会把 TypeError 抛出监听器，
      // Chrome 记为「Error in event handler」（堆栈 :0 匿名函数）。
      if (msg?.type !== 'pt:toggle-translate') return;

      // 子 frame：照常执行，不应答
      const reply = isMainFrame ? sendResponse : () => {};

      try {
        const willTranslate = !translated;

        if (willTranslate) {
          doTranslate()
            .then((status) => {
              // 首次翻译成功后启动 MutationObserver 增量补翻
              if (status === 'translated') {
                translated = true;
                stopObserving = startObserver((els) => {
                  // 增量补翻不改变 translated 状态，独立翻译新增节点
                  // 异步处理，但不阻塞 observer 防抖计时器
                  doTranslate(els).catch((e) =>
                    console.error('[PT] 增量补翻失败:', e),
                  );
                });
              }
              reply({ ok: true, status });
            })
            .catch((e: Error) => reply({ ok: false, error: String(e) }));
        } else {
          Promise.resolve()
            .then(() => doRestore())
            .then(() => reply({ ok: true, status: 'restored' }))
            .catch((e: Error) => reply({ ok: false, error: String(e) }));
        }
      } catch (e) {
        reply({ ok: false, error: String(e) });
      }

      // 只有主文档保持通道开启；子 frame 返回 undefined 让通道立即关闭，
      // 不参与抢答
      return isMainFrame ? true : undefined;
    });
  },
});
