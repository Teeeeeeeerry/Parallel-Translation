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
 * 保留原文（#369，迁自 compat.ts 的 github.com preserve 补丁）——
 * 采集单元（collect 或逐段翻译的 closestUnit）后提取文本
 * （translatableTextEx，全页与逐段翻译共用）：
 *   - @mention、hovercard 用户名链接、author 微数据换成占位符，
 *     回填后原文留在译文句子里
 *   - 普通链接、空文本不保留；只对行内元素生效
 *   - 原 compat-github.test.ts 中 shouldPreserveText 的用例改在这里验证
 *   - 内置排除命中段落里的行内元素时同样原文保留（#441）
 *
 * jsdom 的 location.hostname 是文件级选项，与其他域名的测试文件分离。
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mockAllBoundingRects } from '../../setup';
import { collect } from '~/src/dom/walker';
import { closestUnit } from '~/src/dom/classify';
import {
  translatableTextEx,
  shallowTranslatableTextEx,
  restorePreserves,
} from '~/src/dom/text';

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

describe('保留原文（github.com 内置规则，采集后提取文本）', () => {
  /** 放入页面、采集唯一的单元并提取文本 —— 与 content 发往引擎的内容一致 */
  function extract(html: string) {
    document.body.innerHTML = html;
    const units = collect();
    expect(units).toHaveLength(1);
    return translatableTextEx(units[0]!);
  }

  test('评论里的 @mention：换成占位符，回填后原文留在译文句子里', () => {
    const { text, preserves } = extract(
      '<p>Thanks <a class="user-mention" href="/torvalds">@torvalds</a>, merged in the main branch.</p>',
    );
    expect(text).not.toContain('@torvalds');
    expect([...preserves.values()]).toEqual(['@torvalds']);

    const [ph] = [...preserves.keys()];
    const restored = restorePreserves(`感谢 ${ph}，已合并到主分支。`, preserves, text);
    expect(restored).toBe('感谢 @torvalds，已合并到主分支。');
  });

  test('hovercard 用户名链接（[data-hovercard-url^="/users/"]）保留原文', () => {
    const { preserves } = extract(
      '<p>Reviewed by <a data-hovercard-url="/users/torvalds/hovercard">torvalds</a> yesterday.</p>',
    );
    expect([...preserves.values()]).toEqual(['torvalds']);
  });

  test('author 微数据（[rel="author"] / [itemprop="author"]）保留原文', () => {
    const { preserves } = extract(
      '<p>Written by <a rel="author">Linus Torvalds</a> and <span itemprop="author">octocat</span> together.</p>',
    );
    expect([...preserves.values()]).toEqual(['Linus Torvalds', 'octocat']);
  });

  test('普通链接照常翻译，不保留', () => {
    const { text, preserves } = extract(
      '<p>See <a href="https://github.com/foo/bar">the foo project</a> for details.</p>',
    );
    expect(preserves.size).toBe(0);
    expect(text).toContain('the foo project');
  });

  test('空文本的 @mention 不保留', () => {
    const { preserves } = extract(
      '<p>Thanks <a class="user-mention">  </a> for the quick review.</p>',
    );
    expect(preserves.size).toBe(0);
  });

  test('保留原文只对行内元素生效：块级子元素命中选择器也照常翻译', () => {
    // 选择器须真能命中块级元素：a.user-mention 限定了 a，这里用 hovercard。
    // 块级子元素只在逐段翻译的完整提取里出现（全页翻译对含块级子元素的
    // 单元走浅层提取，直接跳过它们），所以经 closestUnit() 取段落
    document.body.innerHTML =
      '<div id="outer">Opened by <div data-hovercard-url="/users/octocat">@octocat</div> in this thread.</div>';
    const unit = closestUnit(document.getElementById('outer')!)!;
    expect(unit.id).toBe('outer');
    const { text, preserves } = translatableTextEx(unit);
    expect(preserves.size).toBe(0);
    expect(text).toContain('@octocat');
  });

  test('含块级子项的段落走浅层提取，行内 @mention 同样换成占位符', () => {
    document.body.innerHTML =
      '<ul><li id="parent">Assigned to <a class="user-mention">@octocat</a> for review' +
      '<ul><li id="child">Follow-up item for the next release</li></ul></li></ul>';
    expect(ids(collect())).toEqual(['parent', 'child']);
    const parent = document.getElementById('parent')!;
    expect([...shallowTranslatableTextEx(parent).preserves.values()]).toEqual(['@octocat']);
  });

  test('#441：内置排除命中段落内的行内元素（.text-mono、.commit-message code）时原文保留', () => {
    const mono = extract(
      '<p>Merged branch <span class="text-mono">feature/login-flow</span> into the main branch.</p>',
    );
    expect(mono.text).not.toContain('feature/login-flow');
    expect([...mono.preserves.values()]).toEqual(['feature/login-flow']);

    const commit = extract(
      '<p class="commit-message">Fix <code>parseArgs</code> handling of empty flags.</p>',
    );
    expect(commit.text).not.toContain('parseArgs');
    expect([...commit.preserves.values()]).toEqual(['parseArgs']);
  });

  test('逐段翻译：经 closestUnit() 找到段落后同样换成占位符', () => {
    document.body.innerHTML =
      '<p id="c">Thanks <a class="user-mention" id="m">@torvalds</a>, merged in the main branch.</p>';
    const unit = closestUnit(document.getElementById('m')!)!;
    expect(unit.id).toBe('c');
    expect([...translatableTextEx(unit).preserves.values()]).toEqual(['@torvalds']);
  });
});
