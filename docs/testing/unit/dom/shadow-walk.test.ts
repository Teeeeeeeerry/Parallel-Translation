/**
 * dom/shadow-walk.ts — 统一 shadow 子树遍历模块 单元测试（#233）
 *
 * 覆盖：普通 DOM 先序遍历、嵌套 shadow 递归、集中式跳过规则
 * （UI 自身子树 / 已翻译标记）命中与不命中、skip-subtree 与 stop 决策。
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { walkShadowTree } from '~/src/dom/shadow-walk';

function seenIds(root: ParentNode = document.body): string[] {
  const seen: string[] = [];
  walkShadowTree(root, (el) => {
    if (el.id) seen.push(el.id);
  });
  return seen;
}

describe('walkShadowTree — 基础遍历', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('普通 DOM：先序命中全部元素', () => {
    document.body.innerHTML =
      '<div id="a"><p id="b">x</p></div><span id="c">y</span>';
    expect(seenIds()).toEqual(['a', 'b', 'c']);
  });

  test('嵌套 shadow：递归下沉命中各层', () => {
    const host = document.createElement('div');
    host.id = 'h1';
    document.body.appendChild(host);
    const r1 = host.attachShadow({ mode: 'open' });
    r1.innerHTML =
      '<div id="s1"><p id="p1">shadow1</p><div id="h2"></div></div>';
    const h2 = r1.getElementById('h2')!;
    const r2 = h2.attachShadow({ mode: 'open' });
    r2.innerHTML = '<p id="p2">shadow2</p>';

    expect(seenIds()).toEqual(['h1', 's1', 'p1', 'h2', 'p2']);
  });

  test('Document 作为根：同样生效', () => {
    document.body.innerHTML = '<p id="a">x</p>';
    expect(seenIds(document)).toContain('a');
  });
});

describe('walkShadowTree — 集中式跳过规则', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('UI 自身子树（data-pt-ui=1）：整棵子树跳过，含根容器自身', () => {
    document.body.innerHTML =
      '<div data-pt-ui="1" id="ui"><p id="inner">x</p></div><p id="ok">y</p>';
    expect(seenIds()).toEqual(['ok']);
  });

  test('shadow 内的 UI 子树同样跳过', () => {
    const host = document.createElement('div');
    host.id = 'host';
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<div data-pt-ui="1"><p id="ui-s">x</p></div><p id="ok-s">y</p>';
    expect(seenIds()).toEqual(['host', 'ok-s']);
  });

  test('已翻译标记（data-pt=done）：元素自身命中，子树默认跳过', () => {
    document.body.innerHTML =
      '<div data-pt="done" id="d"><p id="inner">x</p></div><p id="after">y</p>';
    expect(seenIds()).toEqual(['d', 'after']);
  });

  test('已翻译标记：skipTranslated=false 时子树内元素也命中', () => {
    document.body.innerHTML =
      '<div data-pt="done" id="d"><p id="inner">x</p></div><p id="after">y</p>';
    const seen: string[] = [];
    walkShadowTree(
      document.body,
      (el) => {
        if (el.id) seen.push(el.id);
      },
      { skipTranslated: false },
    );
    expect(seen).toEqual(['d', 'inner', 'after']);
  });
});

describe('walkShadowTree — visit 决策', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('skip-subtree：跳过当前子树，兄弟继续', () => {
    document.body.innerHTML =
      '<div id="wrap"><p id="inner">x</p></div><p id="after">y</p>';
    const seen: string[] = [];
    walkShadowTree(document.body, (el) => {
      if (el.id === 'wrap') return 'skip-subtree';
      if (el.id) seen.push(el.id);
    });
    expect(seen).toEqual(['after']);
  });

  test('stop：立即终止整个遍历', () => {
    document.body.innerHTML = '<p id="a">1</p><p id="b">2</p>';
    const seen: string[] = [];
    walkShadowTree(document.body, (el) => {
      if (el.id === 'a') return 'stop';
      if (el.id) seen.push(el.id);
    });
    expect(seen).toEqual([]);
  });

  test('stop 在 shadow 深处命中：light DOM 剩余部分不再访问', () => {
    const host = document.createElement('div');
    host.id = 'h1';
    document.body.appendChild(host);
    const r1 = host.attachShadow({ mode: 'open' });
    r1.innerHTML = '<p id="deep">x</p>';
    const after = document.createElement('p');
    after.id = 'after';
    after.textContent = 'y';
    document.body.appendChild(after);

    const seen: string[] = [];
    walkShadowTree(document.body, (el) => {
      if (el.id === 'deep') return 'stop';
      if (el.id) seen.push(el.id);
    });
    expect(seen).toEqual(['h1']);
  });
});
