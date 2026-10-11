// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 单页应用换路由也算跳页（#836）。
//
// 这一次的对方语言（#662、#663）存在 content script 的内存里，刷新、跳到
// 别的网址、关闭标签页之后自然回到自动判定。单页应用（GitHub、X、Reddit）
// 点链接走 history.pushState，页面不重新加载，临时选择就一直留着。在用户
// 眼里点进另一个帖子就是跳页，所以主文档盯住网址：路径变了就通知调用方。
// 同一路径上只换查询参数或 hash 不算（排序、翻到某条评论还是这一页）。
//
// content script 在隔离环境里运行，拦不到页面自己调用的 pushState。能收到
// 的是 Navigation API 的 currententrychange（网址更新之后发，pushState、
// replaceState、后退前进都有）与 popstate（后退前进）。浏览器没有
// Navigation API 时，由调用方在用到临时选择之前调用 check() 补判一次。

/** 两个网址的路径不同。认不出的网址不算变了：宁可不重置，也不因为坏值清掉选择。 */
export function pathChanged(prevHref: string, nextHref: string): boolean {
  const prev = pathOf(prevHref);
  const next = pathOf(nextHref);
  return prev !== null && next !== null && prev !== next;
}

function pathOf(href: string): string | null {
  try {
    return new URL(href).pathname;
  } catch {
    return null;
  }
}

export interface PathWatchDeps {
  /** 主文档当前的网址 */
  getHref: () => string;
  /** 页面的 Navigation API（window.navigation）；浏览器没有时为 undefined */
  navigation?: EventTarget;
  /** 收 popstate 的对象（window） */
  win: EventTarget;
  /** 路径变了：带新路径调用一次 */
  onChange: (path: string) => void;
}

export interface PathWatch {
  /** 补判一次：没有 Navigation API 时，在用到临时选择之前调用 */
  check(): void;
  stop(): void;
}

export function watchPathChange(deps: PathWatchDeps): PathWatch {
  let last = deps.getHref();
  const check = (): void => {
    const href = deps.getHref();
    if (!pathChanged(last, href)) {
      // 只换了查询参数或 hash：记下新网址，路径还是同一个
      if (pathOf(href) !== null) last = href;
      return;
    }
    last = href;
    deps.onChange(pathOf(href)!);
  };
  deps.navigation?.addEventListener('currententrychange', check);
  deps.win.addEventListener('popstate', check);
  return {
    check,
    stop() {
      deps.navigation?.removeEventListener('currententrychange', check);
      deps.win.removeEventListener('popstate', check);
    },
  };
}
