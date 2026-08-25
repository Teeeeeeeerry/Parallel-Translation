// Phase 3 — MutationObserver 增量补翻 + IntersectionObserver 可见性补翻。
//
// 监听 DOM 变化，对新增节点补翻。
// 覆盖三种场景：无限滚动、SPA 路由切换、懒加载内容。
//
// 关键设计决策：
// - 只监听 childList，绝不监听 characterData 或属性 ——
//   否则插入译文 → 触发 mutation → 再次采集 → 再次插入 → 死循环
// - 防抖 300ms：无限滚动一次加载能产生数百条 mutation record，
//   不防抖会导致全量采集与翻译请求瞬间打爆并发闸门
// - 每个 shadowRoot 各挂一个 MutationObserver ——
//   MutationObserver 与 TreeWalker 一样不穿透 shadow 边界
//
// #23 新增 IntersectionObserver：
// - 初次采集时 display:none 的元素被跳过（0×0 rect），展开时若无 DOM 增删
//   （纯 CSS class/style 切换），MutationObserver 感知不到，内容永久漏翻。
// - IntersectionObserver 监听这些隐藏元素，一旦进入视口就触发补翻。
// - rootMargin 提前 300px 触发，让即将滚入视口的内容提前翻译。

import { collect } from './walker';
import { unrender } from './renderer';
import { injectShadowStyles } from '~/src/styles/shadow';
import { watchShadowRoots, walkShadowTree } from './shadow-walk';

// #179: 延迟 attachShadow 漏翻 —— host 已入 DOM 后才建 shadow root 的
// 组件（属性级操作，childList 捕不到、MutationObserver 不产生记录）。
// attachShadow 补丁与遍历共享状态，由统一遍历模块持有（#238）——
// 观察器只注册消费方，创建 shadow root 时同步挂载 observer，
// shadow 内容不再永久漏翻。

/** 新增 shadowRoot 的挂载动作：注入样式 + 挂 MutationObserver（#163/#238）。 */
function mountShadowRoot(
  root: ShadowRoot,
  seen: WeakSet<ShadowRoot>,
  onMutation: (records: MutationRecord[]) => void,
  observers: MutationObserver[],
): void {
  if (seen.has(root)) return;
  seen.add(root);
  // 同步挂载：shadow 内容通常在 attachShadow 之后立即填充，
  // 后续 childList 记录会被新 observer 捕获
  injectShadowStyles(root);
  const mo = new MutationObserver(onMutation);
  mo.observe(root, { childList: true, subtree: true });
  observers.push(mo);
}

/**
 * 递归收集 root 下所有 shadowRoot，对每个挂载 observer（#252）。
 * 遍历走统一模块 walkShadowTree —— 观察范围与翻译范围共用同一套
 * 跳过规则（UI 自身子树等），不再各写一遍递归。
 * 已观察的 shadowRoot 不会重复挂载（seen 集合与 attachShadow 补丁
 * 共享，动态创建的 root 也不会重复）。
 * 返回本次新增的 observer 数组。
 */
function observeShadowRoots(
  root: Node,
  onMutation: (records: MutationRecord[]) => void,
  seen: WeakSet<ShadowRoot>,
): MutationObserver[] {
  const observers: MutationObserver[] = [];

  // 统一遍历：visit 命中每个元素（含 shadow 边界递归），对 shadow
  // host 挂载 observer；根元素自身也是 host 的情况由遍历覆盖
  walkShadowTree(root as ParentNode, (el) => {
    if (el.shadowRoot && !seen.has(el.shadowRoot)) {
      mountShadowRoot(el.shadowRoot, seen, onMutation, observers);
    }
  });

  return observers;
}

// ── #23 可见性追踪 ──

/** 初次采集时因 display:none 被跳过的翻译单元 */
const hiddenTargets = new Set<Element>();
let io: IntersectionObserver | null = null;
let onVisibleCb: ((els: Element[]) => void) | null = null;

/**
 * 注册因不可见而被跳过的翻译单元。
 * 由 walker 的 onHidden 回调调用，也可在 IO 启动后直接挂载观察。
 */
export function registerHidden(el: Element): void {
  hiddenTargets.add(el);
  if (io) io.observe(el);
}

function startWatching(onNewNodes: (els: Element[]) => void): void {
  if (io) return; // 已经启动
  onVisibleCb = onNewNodes;
  io = new IntersectionObserver(
    (entries) => {
      const newlyVisible: Element[] = [];
      for (const entry of entries) {
        if (entry.isIntersecting) {
          io!.unobserve(entry.target);
          hiddenTargets.delete(entry.target as Element);
          // 元素变为可见，重新采集其子树中的翻译单元
          newlyVisible.push(...collect(entry.target, registerHidden));
        }
      }
      if (newlyVisible.length && onVisibleCb) {
        onVisibleCb(newlyVisible);
      }
    },
    {
      // 提前 300px 触发，让即将滚入视口的内容提前翻译
      rootMargin: '300px',
      threshold: 0,
    },
  );
  // 观察所有已注册的隐藏元素
  for (const el of hiddenTargets) {
    io.observe(el);
  }
}

/** 启动 MutationObserver，对新增节点触发补翻回调。 */
export function startObserver(
  onNewNodes: (els: Element[]) => void,
): () => void {
  let pending: Node[] = [];
  let timer: number | undefined;
  // 所有活跃的 observer 列表（主文档 + 各 shadow root）
  const observers: MutationObserver[] = [];
  // 已挂载 observer 的 shadowRoot，避免重复观察
  const observedRoots = new WeakSet<ShadowRoot>();

  const flush = () => {
    timer = undefined;
    const batch = pending;
    pending = [];

    // #158：同批 pending 里祖先+后代并存时只收集「没有祖先也在 pending 里」
    // 的节点 —— collect 覆盖整棵子树，后代单独再 collect 会重复收集。
    // parentNode 链跨 shadow 边界时经 host 继续上行，避免漏掉 host 在批内的情况。
    const pendingSet = new Set(batch);
    const roots = batch.filter((n) => {
      if (n.nodeType !== Node.ELEMENT_NODE) return false;
      let p: Node | null = n.parentNode;
      while (p) {
        if (pendingSet.has(p)) return false;
        p =
          p.nodeType === Node.DOCUMENT_FRAGMENT_NODE
            ? (p as ShadowRoot).host ?? null
            : p.parentNode;
      }
      return true;
    });

    // 兜底去重：compat take、shadow 边界等极端路径下保证每单元只回调一次
    const found = [
      ...new Set(
        roots.flatMap((n) => collect(n as Element, registerHidden)),
      ),
    ];

    // 新增节点中可能出现新的 shadow host，为其 shadow root 补挂 observer
    for (const n of batch) {
      if (n.nodeType === Node.ELEMENT_NODE) {
        const subs = observeShadowRoots(n, onMutationRecord, observedRoots);
        observers.push(...subs);
      }
    }

    if (found.length) onNewNodes(found);
  };

  const onMutationRecord = (records: MutationRecord[]) => {
    for (const r of records) {
      // #179: SPA 原地复用 DOM 仅改 textContent（React 式视图切换）——
      // 只监 childList 会漏掉纯文本更新。characterData 的 target 是
      // 文本节点，取父元素作候选；译文/UI/已翻译内容（.pt-origin 内）
      // 的变更不补翻，不会与自身渲染互相激发。
      if (r.type === 'characterData') {
        const target = r.target;
        const el = target instanceof Text ? target.parentElement : null;
        if (!el) continue;
        if (el.closest('[data-pt-ui="1"]')) continue;
        if (el.closest('.pt-trans')) continue;
        // #179: 页面更新了**已翻译单元**的原文文本（React 复用 DOM
        // 原地改 nodeValue）—— 先还原该单元再重新采集翻译；否则
        // 新文本永远显示旧译文。自己的渲染/还原只产生 childList，
        // 不会经此路径自激。
        const origin = el.closest('.pt-origin');
        if (origin) {
          const unit = origin.parentElement;
          if (unit?.getAttribute('data-pt') === 'done') {
            unrender(unit);
            // unrender 已把 .pt-origin 移除 —— 采集目标是还原后的单元
            pending.push(unit);
            continue;
          }
        }
        pending.push(el);
        continue;
      }

      // 只看新增节点。属性变化不触发重翻，
      // 否则会与自身渲染互相激发
      for (const n of r.addedNodes) {
        if (n.nodeType !== Node.ELEMENT_NODE) continue;
        const el = n as HTMLElement;
        // 忽略自己插入的译文与自己的 UI，否则形成无限循环
        if (el.classList?.contains('pt-trans')) continue;
        // #158：splitPre 切出的 .pt-chunk 是采集器自己插入的单元 —— 触发切分
        // 的那次 collect 在同一遍遍历里就会收集到它们，mutation 记录再进
        // pending 只会让每个块在翻译未完成时被二次请求（系统性翻倍）
        if (el.classList?.contains('pt-chunk')) continue;
        if (el.dataset?.ptUi === '1') continue;
        pending.push(n);
      }
    }
    // 防抖：无限滚动会在极短时间内产生大量 mutation
    if (pending.length && timer === undefined) {
      timer = self.setTimeout(flush, 300);
    }
  };

  // 主文档 observer
  // #179: 监听 characterData —— SPA 原地更新文本（React nodeValue 更新）
  // 产生 characterData 记录；译文/UI 变更已在上层过滤，不会自激
  const mainMo = new MutationObserver(onMutationRecord);
  mainMo.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  observers.push(mainMo);

  // 初始扫描：为文档中已存在的 shadow root 各挂 observer
  const initial = observeShadowRoots(document.body, onMutationRecord, observedRoots);
  observers.push(...initial);

  // #179: 注册到 attachShadow 补丁的通知集合（#238：补丁在统一遍历
  // 模块持有，这里只注册消费方）—— 延迟建 shadow root 的组件也能
  // 被增量补翻
  const unwatch = watchShadowRoots({
    seen: observedRoots,
    onShadowRoot: (root) => {
      mountShadowRoot(root, observedRoots, onMutationRecord, observers);
    },
  });

  // #23：启动 IntersectionObserver，监听初次采集时因 display:none 被跳过的元素
  startWatching(onNewNodes);

  return () => {
    unwatch();
    for (const mo of observers) mo.disconnect();
    if (timer) clearTimeout(timer);
    if (io) {
      io.disconnect();
      io = null;
    }
    hiddenTargets.clear();
    onVisibleCb = null;
  };
}
