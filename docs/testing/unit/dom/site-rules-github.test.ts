/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url": "https://github.com/anthropics/claude-code"}
 */
/**
 * 站点页面规则 —— github.com 的内置排除（#367）
 *
 * github.com 的 skip 补丁原先写在 compat.ts 代码层，#367 迁为内置
 * 排除数据（ADR-0003）。旧补丁用 closest() 判定，本来就是整块语义，
 * 与数据化的排除等价。唯一例外是 shadow DOM：closest() 不穿过 shadow
 * 边界，旧补丁会采集排除区内宿主的 shadowRoot 里的单元，排除则连同
 * shadowRoot 整块跳过 —— 更符合“整块不翻译”，github 页面上也不涉及。
 * 站点页面规则作用于全页翻译和逐段翻译，本文件分别在两个入口验证。
 *
 * 全页翻译 —— walker 采集入口 collect()：
 *   - 迁移前后采集到的单元一致（仓库首页 + blob 页的典型片段）
 *   - 原 compat-github.test.ts 中 applyCompat 的各选择器用例照常不采集，
 *     正文与含行内 code 的正文照常采集
 *
 * 逐段翻译 —— closestUnit()（悬停按钮与点击翻译共用的入口，#409）：
 *   - 排除区内找不到段落，不出按钮也不翻译
 *   - 排除区外的正文照常找到段落
 *
 * jsdom 的 location.hostname 是文件级选项，与其他域名的测试文件分离。
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mockAllBoundingRects } from '../../setup';
import { collect } from '~/src/dom/walker';
import { closestUnit } from '~/src/dom/classify';

let restore: () => void;
beforeEach(() => {
  restore = mockAllBoundingRects();
});
afterEach(() => {
  restore();
  document.body.innerHTML = '';
});

const ids = (units: Element[]) => units.map((u) => u.id);

describe('collect（github.com 内置排除）', () => {
  test('仓库首页与 blob 页典型片段：迁移前后采集到的单元一致', () => {
    document.body.innerHTML = `
      <div class="BorderGrid">
        <div class="BorderGrid-cell">
          <h2 id="about-h">About the project</h2>
          <p id="about">Claude Code is an agentic coding tool.</p>
        </div>
      </div>
      <div class="repository-lang-stats"><ul><li id="lang">TypeScript and friends</li></ul></div>
      <div class="file-tree"><ul><li id="tree">src directory</li></ul></div>
      <div class="file-header"><div id="fh">docs/README.md file</div></div>
      <table><tr><td id="code" class="blob-code blob-code-inner">const answer = compute();</td></tr></table>
      <div class="text-mono"><div id="mono">abc1234 update docs</div></div>
      <div class="blame-hunk"><div id="blame">Refactor the walker</div></div>
      <article class="markdown-body">
        <h2 id="readme-h">Installation</h2>
        <p id="readme-p">Run the installer and follow the prompts.</p>
        <div class="highlight"><pre id="snippet">npm install -g some-package</pre></div>
        <ul><li id="readme-li">Supports macOS and Linux</li></ul>
      </article>`;
    // 基线取自迁移前（compat.ts 的 github.com skip 补丁）的采集结果
    expect(ids(collect())).toEqual(['readme-h', 'readme-p', 'readme-li']);
  });

  test('.repository-lang-stats（语言统计条）不采集', () => {
    document.body.innerHTML =
      '<div class="repository-lang-stats"><p id="lang">Python and Shell</p></div>' +
      '<p id="body">Claude Code is an agentic coding tool.</p>';
    expect(ids(collect())).toEqual(['body']);
  });

  test('.file-tree（blob 页文件树）不采集', () => {
    document.body.innerHTML =
      '<div class="file-tree"><p id="tree">src directory</p></div>' +
      '<p id="body">Claude Code is an agentic coding tool.</p>';
    expect(ids(collect())).toEqual(['body']);
  });

  test('含行内 code 的正文照常采集', () => {
    document.body.innerHTML = '<p id="body">Run <code>pnpm build</code> first.</p>';
    expect(ids(collect())).toEqual(['body']);
  });
});

describe('closestUnit（github.com 内置排除，逐段翻译入口）', () => {
  test('贡献者网格（.BorderGrid）内的段落：找不到段落', () => {
    document.body.innerHTML =
      '<div class="BorderGrid"><p id="about">Claude Code is an agentic <b id="bold">coding</b> tool.</p></div>';
    expect(closestUnit(document.getElementById('bold')!)).toBeNull();
  });

  test('文件树（.file-tree）内的段落：找不到段落', () => {
    document.body.innerHTML =
      '<div class="file-tree"><p id="tree">src directory</p></div>';
    expect(closestUnit(document.getElementById('tree')!)).toBeNull();
  });

  test('排除区外的 README 正文照常找到段落', () => {
    document.body.innerHTML =
      '<article class="markdown-body"><p id="readme">Run the <b id="bold">installer</b> first.</p></article>';
    expect(closestUnit(document.getElementById('bold')!)?.id).toBe('readme');
  });
});
