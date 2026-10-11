/**
 * ui/path-watch.ts — 单页应用换路由：网址的路径变了才算跳页（#836）
 *
 * 单页应用点链接走 history.pushState，页面不重新加载，content script 内存里
 * 的临时选择会一直留着。主文档盯住网址：路径变了就通知调用方；同一路径上
 * 只换查询参数或 hash 不算。断言收到了几次通知、各是什么路径。
 */
import { describe, test, expect, vi } from 'vitest';
import { pathChanged, watchPathChange } from '~/src/ui/path-watch';

describe('pathChanged — 只看路径（#836）', () => {
  test('路径变了：算', () => {
    expect(pathChanged('https://x.com/r/a/comments/1', 'https://x.com/r/a/comments/2')).toBe(true);
    expect(pathChanged('https://x.com/', 'https://x.com/home')).toBe(true);
  });

  test('同一路径上只换查询参数或 hash：不算', () => {
    expect(pathChanged('https://x.com/search?q=a', 'https://x.com/search?q=b')).toBe(false);
    expect(pathChanged('https://x.com/post/1', 'https://x.com/post/1#comment-3')).toBe(false);
    expect(pathChanged('https://x.com/post/1#a', 'https://x.com/post/1?sort=new#b')).toBe(false);
    expect(pathChanged('https://x.com/post/1', 'https://x.com/post/1')).toBe(false);
  });

  test('网址认不出：不算（宁可不重置，也不因为一个坏值清掉用户的选择）', () => {
    expect(pathChanged('not a url', 'https://x.com/a')).toBe(false);
    expect(pathChanged('https://x.com/a', '')).toBe(false);
  });
});

/** 可控的页面：网址、Navigation API 与 popstate 都由用例驱动。 */
function fakePage(withNavigation: boolean) {
  let href = 'https://forum.example/r/intl/comments/1';
  const navigation = withNavigation ? new EventTarget() : undefined;
  const win = new EventTarget();
  return {
    deps: { getHref: () => href, navigation, win },
    /** 单页应用换路由：改网址，Navigation API 在网址更新之后发 currententrychange */
    pushState(next: string) {
      href = next;
      navigation?.dispatchEvent(new Event('currententrychange'));
    },
    /** 后退前进：发 popstate */
    back(prev: string) {
      href = prev;
      win.dispatchEvent(new Event('popstate'));
    },
  };
}

describe('watchPathChange — 盯住主文档的网址（#836）', () => {
  test('pushState 换到别的路径：立即通知一次，带新路径', () => {
    const page = fakePage(true);
    const onChange = vi.fn();
    watchPathChange({ ...page.deps, onChange });

    page.pushState('https://forum.example/r/intl/comments/2');

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('/r/intl/comments/2');
  });

  test('同一路径上只换查询参数或 hash：不通知', () => {
    const page = fakePage(true);
    const onChange = vi.fn();
    watchPathChange({ ...page.deps, onChange });

    page.pushState('https://forum.example/r/intl/comments/1?sort=new');
    page.pushState('https://forum.example/r/intl/comments/1?sort=new#c5');

    expect(onChange).not.toHaveBeenCalled();
  });

  test('后退前进（popstate）换了路径：通知', () => {
    const page = fakePage(true);
    const onChange = vi.fn();
    watchPathChange({ ...page.deps, onChange });

    page.pushState('https://forum.example/r/intl/comments/2');
    page.back('https://forum.example/r/intl/comments/1');

    expect(onChange.mock.calls).toEqual([['/r/intl/comments/2'], ['/r/intl/comments/1']]);
  });

  test('同一次换路由不重复通知：事件来了两遍也只算一次', () => {
    const page = fakePage(true);
    const onChange = vi.fn();
    watchPathChange({ ...page.deps, onChange });

    page.pushState('https://forum.example/r/intl/comments/2');
    page.deps.win.dispatchEvent(new Event('popstate'));

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('没有 Navigation API：pushState 收不到事件，check() 时补判', () => {
    const page = fakePage(false);
    const onChange = vi.fn();
    const watch = watchPathChange({ ...page.deps, onChange });

    page.pushState('https://forum.example/r/intl/comments/2');
    expect(onChange).not.toHaveBeenCalled();
    watch.check();
    watch.check();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('/r/intl/comments/2');
  });

  test('stop 之后不再通知', () => {
    const page = fakePage(true);
    const onChange = vi.fn();
    const watch = watchPathChange({ ...page.deps, onChange });

    watch.stop();
    page.pushState('https://forum.example/r/intl/comments/2');

    expect(onChange).not.toHaveBeenCalled();
  });
});
