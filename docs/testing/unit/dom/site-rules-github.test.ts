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
 * 贡献图（#580）—— 格子表格整块不翻译：表格里多是读屏软件专用的隐藏
 * 文字（“Day of Week”、完整月份与星期名），译文插入后却是可见的，会把
 * 每格 10px 的日历撑坏；贡献数标题照常翻译。全页与逐段翻译两个入口分别验证。
 * 表格的样式 class 与 JS 挂钩各排除一条，只剩其中一个时仍生效（#587）。
 * 格子的悬停提示落在表格外，不在表格的排除范围内；它本来就不是翻译单元，
 * #598 起 tool-tip 也整体排除。
 * 图下方只包着一个链接的说明文字照常翻译（#589）；图例格子里只有读屏
 * 隐藏文字，不翻译（#595）
 *
 * 仓库与用户的标识符（#598）—— 只含行内元素的容器成为翻译单元（#589）
 * 之后，文件列表的文件名、仓库名、迷你资料卡用户名也会被采集：文件名列
 * 整块不翻译，仓库名与用户名原文保留，同一单元里的其他文字照常翻译
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
 *   - 去掉保留原文后没有可翻译文字的段落不采集（#454）
 *
 * jsdom 的 location.hostname 是文件级选项，与其他域名的测试文件分离。
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mockAllBoundingRects, mockBoundingRect } from '../../setup';
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

/**
 * GitHub 个人主页贡献图的典型片段（#580）。格子上的悬停提示 tool-tip 在
 * GitHub 的源码里写在表格行内，HTML 解析会把它们挪到表格前面，这里直接
 * 写成解析后的位置
 */
const CONTRIBUTION_GRAPH = `
  <div class="js-yearly-contributions">
    <h2 id="total">1,885 contributions in the last year</h2>
    <div class="js-calendar-graph ContributionCalendar">
      <div>
        <tool-tip id="tip" for="contribution-day-component-0-0" popover="manual" class="sr-only position-absolute">No contributions on September 28th.</tool-tip>
        <tool-tip for="contribution-day-component-1-0" popover="manual" class="sr-only position-absolute">3 contributions on September 29th.</tool-tip>
        <table class="ContributionCalendar-grid js-calendar-graph-table" role="grid">
          <caption class="sr-only">Contribution Graph</caption>
          <thead><tr>
            <td><span class="sr-only">Day of Week</span></td>
            <td class="ContributionCalendar-label" colspan="4"><span class="sr-only" id="month">October</span><span aria-hidden="true">Oct</span></td>
          </tr></thead>
          <tbody>
            <tr>
              <td class="ContributionCalendar-label"><span class="sr-only" id="weekday">Sunday</span><span aria-hidden="true">Sun</span></td>
              <td class="ContributionCalendar-day" data-date="2025-09-28" id="contribution-day-component-0-0"></td>
            </tr>
            <tr>
              <td class="ContributionCalendar-label"><span class="sr-only">Monday</span><span aria-hidden="true">Mon</span></td>
              <td class="ContributionCalendar-day" data-date="2025-09-29" id="contribution-day-component-1-0"></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="width-full f6">
        <div class="float-left" id="learn"><a id="learn-link" href="https://docs.github.com/articles/why-are-my-contributions-not-showing-up-on-my-profile">Learn how we count contributions</a></div>
        <div class="float-right"><span>Less</span><div class="ContributionCalendar-day"><span class="sr-only" id="legend">No contributions.</span></div><span>More</span></div>
      </div>
    </div>
  </div>`;

/**
 * 放入贡献图片段，并把 .sr-only 元素设成 1×1 的渲染尺寸 —— 与浏览器里
 * sr-only 样式的结果一致（#595）。cls 替换格子表格的 class（#587）
 */
function setContributionGraph(cls?: string) {
  document.body.innerHTML = cls
    ? CONTRIBUTION_GRAPH.replace('class="ContributionCalendar-grid js-calendar-graph-table"', `class="${cls}"`)
    : CONTRIBUTION_GRAPH;
  for (const el of document.querySelectorAll('.sr-only')) mockBoundingRect(el, { width: 1, height: 1 });
}

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

  test('#580：贡献图的格子表格（月份、星期标签）不采集，贡献数标题照常采集', () => {
    setContributionGraph();
    // 图下方只包着一个链接的说明文字照常采集（#589）；图例格子里只有读屏
    // 隐藏文字，不采集（#595）
    expect(ids(collect())).toEqual(['total', 'learn']);
  });

  test.each([
    ['只带样式 class', 'ContributionCalendar-grid'],
    ['只带 JS 挂钩', 'js-calendar-graph-table'],
  ])('#587：贡献图表格%s时同样不采集', (_, cls) => {
    setContributionGraph(cls);
    expect(ids(collect())).toEqual(['total', 'learn']);
  });

  test('#587：悬停提示不采集 —— 它在表格外，表格的排除管不到（tool-tip 不是翻译单元，#598 起也整体排除）', () => {
    setContributionGraph();
    const texts = collect().map((u) => u.textContent);
    expect(texts.some((t) => t?.includes('contributions on September'))).toBe(false);
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

  test('#580：贡献图格子表格里的月份、星期找不到段落，贡献数标题能找到', () => {
    setContributionGraph();
    expect(closestUnit(document.getElementById('month')!)).toBeNull();
    expect(closestUnit(document.getElementById('weekday')!)).toBeNull();
    expect(closestUnit(document.getElementById('total')!)?.id).toBe('total');
  });

  test.each([
    ['只带样式 class', 'ContributionCalendar-grid'],
    ['只带 JS 挂钩', 'js-calendar-graph-table'],
  ])('#587：贡献图表格%s时，月份、星期同样找不到段落', (_, cls) => {
    setContributionGraph(cls);
    expect(closestUnit(document.getElementById('month')!)).toBeNull();
    expect(closestUnit(document.getElementById('weekday')!)).toBeNull();
  });

  test('#587：悬停提示上找不到段落 —— 表格的排除管不到它（tool-tip 不是翻译单元，#598 起也整体排除）', () => {
    setContributionGraph();
    expect(closestUnit(document.getElementById('tip')!)).toBeNull();
  });

  test('#589、#595：说明链接上能找到段落，图例格子里的读屏隐藏文字上找不到', () => {
    setContributionGraph();
    expect(closestUnit(document.getElementById('learn-link')!)?.id).toBe('learn');
    expect(closestUnit(document.getElementById('legend')!)).toBeNull();
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

/** GitHub 仓库首页文件列表的一行（#598）：文件名列与提交说明列 */
const FILE_ROW = `
  <table><tbody><tr class="react-directory-row">
    <td class="react-directory-row-name-cell-large-screen"><div class="react-directory-filename-column"><svg class="octicon"></svg>
      <div class="overflow-hidden"><div class="react-directory-filename-cell"><div class="react-directory-truncate">
        <a id="fname" title="scripts" class="Link--primary" href="/anthropics/claude-code/tree/main/scripts">scripts</a>
      </div></div></div></div></td>
    <td class="react-directory-row-commit-cell"><div><div class="react-directory-commit-message" id="commit">
      <a id="cmsg" class="Link--secondary" href="/anthropics/claude-code/commit/abc">Read issue number from workflow event in helper scripts</a>
    </div></div></td>
  </tr></tbody></table>`;

describe('仓库与用户的标识符（#598）', () => {
  test('文件列表：文件名不采集，也找不到段落；提交说明照常采集', () => {
    document.body.innerHTML = FILE_ROW;
    expect(ids(collect())).toEqual(['commit']);
    expect(closestUnit(document.getElementById('fname')!)).toBeNull();
    expect(closestUnit(document.getElementById('cmsg')!)?.id).toBe('commit');
  });

  test('置顶仓库卡片：仓库名原文保留，“Public”标签照常送翻', () => {
    document.body.innerHTML =
      '<div class="pinned-item-list-item-content"><div class="d-flex width-full position-relative">' +
      '<div class="flex-1" id="pin"><svg class="octicon octicon-repo"></svg> <span class="position-relative">' +
      '<a id="r1" href="/Teeeeeeeerry/Parallel-Translation" class="Link text-bold"><span class="repo" id="repo">Parallel-Translation</span></a>' +
      // 悬停提示里也写着仓库名：未打开时 display:none，文字仍在提取范围内
      ' <tool-tip for="r1" popover="manual" class="sr-only position-absolute">Parallel-Translation</tool-tip>' +
      '</span> <span class="Label Label--secondary">Public</span></div></div></div>';
    const units = collect();
    expect(ids(units)).toEqual(['pin']);
    const { text, preserves } = translatableTextEx(units[0]!);
    expect([...new Set(preserves.values())]).toEqual(['Parallel-Translation']);
    expect(text).toContain('Public');
    expect(text).not.toContain('Parallel-Translation');
    expect(closestUnit(document.getElementById('repo')!)?.id).toBe('pin');
  });

  test('#600：置顶仓库卡片的悬停提示未打开（宽高为 0）时整体不送翻，仓库名只出现一次', () => {
    document.body.innerHTML =
      '<div class="pinned-item-list-item-content"><div class="flex-1" id="pin"><svg class="octicon octicon-repo"></svg> ' +
      '<span class="position-relative"><a id="r1" href="/Teeeeeeeerry/Rhythm" class="Link text-bold"><span class="repo">Rhythm</span></a>' +
      ' <tool-tip id="tt" for="r1" popover="manual" class="sr-only position-absolute">Rhythm</tool-tip></span>' +
      ' <span class="Label Label--secondary">Public</span></div></div>';
    mockBoundingRect(document.getElementById('tt')!, { width: 0, height: 0 });
    const units = collect();
    expect(ids(units)).toEqual(['pin']);
    const { preserves } = translatableTextEx(units[0]!);
    expect([...preserves.values()]).toEqual(['Rhythm']);
  });

  test('仓库页标题：所有者与仓库名都原文保留', () => {
    document.body.innerHTML =
      '<div class="d-flex flex-wrap flex-items-center" id="title"><svg class="octicon octicon-repo"></svg> ' +
      '<span class="author" itemprop="author"><a class="url fn" rel="author" href="/anthropics">anthropics</a></span> ' +
      '<span class="mx-1">/</span> <strong itemprop="name" class="mr-2"><a href="/anthropics/claude-code">claude-code</a></strong> ' +
      '<span class="Label Label--secondary">Public</span></div>';
    const units = collect();
    expect(ids(units)).toEqual(['title']);
    const { text, preserves } = translatableTextEx(units[0]!);
    expect([...preserves.values()]).toEqual(['anthropics', 'claude-code']);
    expect(text).toContain('Public');
  });

  test('迷你资料卡：只有用户名，原文保留后没有可翻译的文字，不采集，也找不到段落', () => {
    document.body.innerHTML =
      '<div class="user-profile-mini-vcard d-table"><span class="d-table-cell v-align-middle">' +
      '<strong id="mini">Teeeeeeeerry</strong></span></div><p id="body">Body text here.</p>';
    expect(ids(collect())).toEqual(['body']);
    expect(closestUnit(document.getElementById('mini')!)).toBeNull();
  });
});

describe('去掉保留原文后没有可翻译文字的段落（#454）', () => {
  test('只含 .text-mono 的列表项、只含 @mention 的段落都不采集', () => {
    document.body.innerHTML =
      '<ul><li id="branch"><span class="text-mono">feature/login-flow</span></li></ul>' +
      '<p id="mention"><a class="user-mention">@octocat</a></p>' +
      '<p id="body">Thanks <a class="user-mention">@octocat</a> for the review.</p>';
    expect(ids(collect())).toEqual(['body']);
    expect(closestUnit(document.getElementById('branch')!)).toBeNull();
    expect(closestUnit(document.getElementById('mention')!)).toBeNull();
  });
});
