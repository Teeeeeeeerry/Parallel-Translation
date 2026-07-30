// Phase 2 — 最简 DOM 节点采集。
// 只处理 document 层的块级元素，阶段 3 升级为 shadow 穿透 + 更细分类。

const DIRECT = 'h1,h2,h3,h4,h5,h6,p,li,dd,blockquote,figcaption';

/** 应被整体跳过的非正文区域选择器。 */
const SKIP = 'nav,footer,aside,.reflist,.navbox,.sidebar,.toc,.mw-editsection';

/**
 * 从 root 下收集待翻译的块级元素。
 * 跳过已翻译的容器、跳过扩展自身注入的 UI、
 * 跳过导航/侧边栏/页脚/参考文献等非正文区域、
 * 跳过文本过短或过长的元素。
 */
export function collectSimple(root: ParentNode = document): Element[] {
  return [...root.querySelectorAll(DIRECT)].filter((el) => {
    // 已翻译
    if (el.closest('[data-pt="done"]')) return false;
    // 扩展自身注入的 UI
    if (el.closest('[data-pt-ui="1"]')) return false;
    // 非正文区域
    if (el.closest(SKIP)) return false;
    const t = el.textContent?.trim() ?? '';
    return t.length >= 3 && t.length <= 3072;
  });
}
