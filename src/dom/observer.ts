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

// #179: 延迟 attachShadow 漏翻 —— host 已入 DOM 后才建 shadow root 的
// 组件（属性级操作，childList 捕不到、MutationObserver 不产生记录）。
// 补丁 Element.prototype.attachShadow：创建 shadow root 时同步通知所有
// 活跃 observer 挂载，shadow 内容不再永久漏翻。
interface ObserverContext {
  onMutationRecord: (records: MutationRecord[]) => void;
  observedRoots: WeakSet<ShadowRoot>;
  observers: MutationObserver[];
}
const observerContexts = new Set<ObserverContext>();

const nativeAttachShadow = Element.prototype.attachShadow;
if (
  !(Element.prototype as unknown as { __ptShadowPatched?: boolean })
    .__ptShadowPatched
) {
  (Element.prototype as unknown as { __ptShadowPatched: boolean })
    .__ptShadowPatched = true;
  Element.prototype.attachShadow = function (
    this: Element,
    init?: ShadowRootInit,
  ): ShadowRoot {
    // 原生实现允许省略 init，类型声明要求必填 —— 运行时原样透传
    const root = nativeAttachShadow.call(this, init as ShadowRootInit);
    for (const ctx of observerContexts) {
      if (ctx.observedRoots.has(root)) continue;
      ctx.observedRoots.add(root);
      // 同步挂载：shadow 内容通常在 attachShadow 之后立即填充，
      // 后续 childList 记录会被新 observer 捕获
      injectShadowStyles(root);
      const mo = new MutationObserver(ctx.onMutationRecord);
      mo.observe(root, { childList: true, subtree: true });
      ctx.observers.push(mo);
    }
    return root;
  };
}

/**
 * 递归收集 root 下所有 shadowRoot，对每个挂载 observer。
 * 已观察的 shadowRoot 不会重复挂载。
 * 返回本次新增的 observer 数组。
 */
function observeShadowRoots(
  root: Node,
  onMutation: (records: MutationRecord[]) => void,
  seen: WeakSet<ShadowRoot>,
): MutationObserver[] {
  const observers: MutationObserver[] = [];

  const attach = (el: Element): boolean => {
    if (!el.shadowRoot || seen.has(el.shadowRoot)) return false;
    seen.add(el.shadowRoot);
    // #163: 扩展样式不跨 shadow 边界 —— 先注入样式再挂 observer，
    // 避免注入动作触发自身 mutation 记录
    injectShadowStyles(el.shadowRoot);
    const mo = new MutationObserver(onMutation);
    mo.observe(el.shadowRoot, { childList: true, subtree: true });
    observers.push(mo);
    return true;
  };

  // querySelectorAll('*') 返回的已经是整棵子树，因此每个 scope 只扫一遍即可。
  // 若再对其中每个后代重复调用，深度 k 的节点会沿 2^(k-1) 条祖先路径被反复
  // 访问 —— 代价随嵌套深度指数增长，真实页面上会直接冻结主线程。
  // 递归只发生在 shadow 边界，因为 querySelectorAll 不穿透 shadow root。
  const walk = (scope: ParentNode) => {
    scope.querySelectorAll('*').forEach((el) => {
      if (attach(el)) walk(el.shadowRoot!);
    });
  };

  if (root.nodeType === Node.ELEMENT_NODE) {
    // root 自身也可能是 shadow host —— querySelectorAll 不包含根节点
    const el = root as Element;
    if (attach(el)) walk(el.shadowRoot!);
    walk(el);
  } else if (root.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
    walk(root as ParentNode);
  }
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

  // #179: 注册到 attachShadow 补丁的通知集合 —— 延迟建 shadow root 的
  // 组件也能被增量补翻
  const ctx: ObserverContext = { onMutationRecord, observedRoots, observers };
  observerContexts.add(ctx);

  // #23：启动 IntersectionObserver，监听初次采集时因 display:none 被跳过的元素
  startWatching(onNewNodes);

  return () => {
    observerContexts.delete(ctx);
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
