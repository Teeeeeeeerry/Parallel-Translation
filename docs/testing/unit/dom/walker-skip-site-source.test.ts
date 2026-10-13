/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url": "https://github.com/anthropics/claude-code"}
 */
/**
 * 站点页面规则的排除按来源分开计数（#922，父 #727）
 *
 * 站点页面规则有内置与用户两个来源。内置规则排除的是扩展自己判定“本来就
 * 不该翻”的东西（github.com 的代码行、文件名列、贡献图格子），与非正文区域
 * 同一性质 —— #756 已把非正文区域从跳过计数里去掉，理由一样，内置排除也
 * 不计入。用户自己写的排除照常计入“被站点页面规则排除”：规则写宽了，跳过
 * 提示能帮他发现。
 *
 * 只多带一个“这条来自哪个来源”的信息，规则本身的生效行为逐字节不变：生效
 * 站点规则的三个字段与分开来源之前一模一样，排除掉的元素、采到的单元也一样。
 *
 * jsdom 的页面 URL 是文件级选项，github.com 的用例单独成文件。
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mockAllBoundingRects, resetStorage } from '../../setup';
import { collect, type SkipCategory } from '~/src/dom/walker';
import { BUILTIN_SITE_RULES } from '~/src/storage/builtin-site-rules';
import { getSiteRules, saveUserSiteRules, siteRulesReady } from '~/src/storage/specialization';

/** 仓库首页的形状：README 正文、文件列表（文件名列被内置规则排除）、侧栏贡献者网格。 */
const REPO_HOME = `
  <table aria-labelledby="folders-and-files">
    <tbody>
      <tr><td class="react-directory-filename-column" id="f1"><a href="/a/b/tree/main/docs">docs</a></td>
          <td class="react-directory-commit-message" id="m1"><a href="/a/b/commit/1">Update the installation guide for new users</a></td></tr>
      <tr><td class="react-directory-filename-column" id="f2"><a href="/a/b/tree/main/src">src</a></td>
          <td class="react-directory-commit-message" id="m2"><a href="/a/b/commit/2">Refactor the walker so that skips are counted</a></td></tr>
      <tr><td class="react-directory-filename-column" id="f3"><a href="/a/b/blob/main/README.md">README.md</a></td>
          <td class="react-directory-commit-message" id="m3"><a href="/a/b/commit/3">Describe the release process in more detail</a></td></tr>
    </tbody>
  </table>
  <div class="BorderGrid"><div class="BorderGrid-cell"><p id="about">Claude Code is an agentic coding tool.</p></div></div>
  <article class="markdown-body">
    <h2 id="readme-h">Installation</h2>
    <p id="readme-p">Run the installer and follow the prompts on screen.</p>
  </article>`;

/** 代码文件页的形状：每行代码一个被内置规则排除的单元。 */
const BLOB = `
  <table>
    <tr><td class="blob-num">1</td><td class="blob-code blob-code-inner" id="l1">const answer = compute();</td></tr>
    <tr><td class="blob-num">2</td><td class="blob-code blob-code-inner" id="l2">export default answer;</td></tr>
    <tr><td class="blob-num">3</td><td class="blob-code blob-code-inner" id="l3">// a comment line here</td></tr>
  </table>
  <p id="note">This file is part of the public API.</p>`;

/** 用户自己写的排除命中的几段。 */
const USER_EXCLUDED = `
  <p class="sponsor" id="s1">Sponsored content from our partners.</p>
  <p class="sponsor" id="s2">Another sponsored paragraph here.</p>`;

let restore: () => void;
beforeEach(async () => {
  resetStorage();
  await siteRulesReady();
  restore = mockAllBoundingRects();
});
afterEach(() => {
  restore();
  document.body.innerHTML = '';
});

/** 采一遍：采到的单元 id 与按原因分组的跳过。 */
function tally(): { units: string[]; by: Partial<Record<SkipCategory, string[]>> } {
  const by: Partial<Record<SkipCategory, string[]>> = {};
  const units = collect(document.body, undefined, {
    onSkip: (el, category) => (by[category] ??= []).push(el.id),
  });
  return { units: units.map((u) => u.id), by };
}

async function userRules(exclude: string[]) {
  await saveUserSiteRules('github.com', { exclude });
  await siteRulesReady();
}

describe('内置规则的排除不计入跳过（#922）', () => {
  test('仓库首页：文件名列、贡献者网格被排除，一个都不报', () => {
    document.body.innerHTML = REPO_HOME;
    expect(tally()).toEqual({ units: ['m1', 'm2', 'm3', 'readme-h', 'readme-p'], by: {} });
  });

  test('代码文件页：每行代码被排除，一个都不报', () => {
    document.body.innerHTML = BLOB;
    expect(tally()).toEqual({ units: ['note'], by: {} });
  });
});

describe('用户规则的排除照常计入（#922 反向）', () => {
  test('用户排除命中的单元报“被站点页面规则排除”，数量对得上', async () => {
    await userRules(['.sponsor']);
    document.body.innerHTML = REPO_HOME + USER_EXCLUDED;
    expect(tally()).toEqual({
      units: ['m1', 'm2', 'm3', 'readme-h', 'readme-p'],
      by: { 'site-rule': ['s1', 's2'] },
    });
  });

  test('内置与用户都命中的单元按内置算，不计入 —— 没有用户规则它也不会被翻', async () => {
    await userRules(['.sponsor', '.react-directory-filename-column']);
    document.body.innerHTML = REPO_HOME + USER_EXCLUDED;
    expect(tally().by).toEqual({ 'site-rule': ['s1', 's2'] });
  });

  test('停用内置规则的站点卡片：原先由内置排除的元素不再被排除，照常采集', async () => {
    await saveUserSiteRules('github.com', { exclude: ['.sponsor'] });
    const { setBuiltinSiteRulesDisabled } = await import('~/src/storage/specialization');
    await setBuiltinSiteRulesDisabled('github.com', true);
    await siteRulesReady();
    document.body.innerHTML = BLOB + USER_EXCLUDED;
    const { units, by } = tally();
    expect(units).toEqual(expect.arrayContaining(['l1', 'l2', 'l3', 'note']));
    expect(by).toEqual({ 'site-rule': ['s1', 's2'] });
  });

  test('文字超长的段落照常计入（反向）', () => {
    document.body.innerHTML =
      REPO_HOME + `<p id="long">${'This sentence keeps going on and on. '.repeat(100)}</p>`;
    expect(tally().by).toEqual({ 'too-long': ['long'] });
  });
});

describe('规则的生效行为逐字节不变（#922）', () => {
  /** 分开来源之前的合并口径：内置在前、用户逐字段追加在后。 */
  const merged = (user: { exclude?: string[]; preserve?: string[] }) => {
    const b = BUILTIN_SITE_RULES['github.com']!;
    return {
      scope: [...(b.scope ?? [])],
      exclude: [...(b.exclude ?? []), ...(user.exclude ?? [])],
      preserve: [...(b.preserve ?? []), ...(user.preserve ?? [])],
    };
  };

  test('生效站点规则的三个字段与分开来源之前完全一致', async () => {
    const user = { exclude: ['.sponsor', '.react-directory-filename-column'], preserve: ['.handle'] };
    await saveUserSiteRules('github.com', user);
    await siteRulesReady();
    // 不带来源的读取口：形状与内容都与分开来源之前一字不变
    expect(JSON.stringify(getSiteRules('github.com'))).toBe(JSON.stringify(merged(user)));
    // 带来源的读取口：三个字段同样一字不变，来源与排除逐条对齐
    const { scope, exclude, preserve, excludeSources } = getSiteRules('github.com', { withSources: true });
    expect(JSON.stringify({ scope, exclude, preserve })).toBe(JSON.stringify(merged(user)));
    const builtinCount = BUILTIN_SITE_RULES['github.com']!.exclude!.length;
    expect(excludeSources).toEqual([...Array(builtinCount).fill('builtin'), 'user', 'user']);
  });

  test('同一份 DOM、同一套规则：被排除的元素与采到的单元，和按合并口径逐个判定的结果完全一致', async () => {
    const user = { exclude: ['.sponsor'] };
    await userRules(user.exclude);
    document.body.innerHTML = REPO_HOME + BLOB + USER_EXCLUDED;
    const ref = merged(user).exclude;
    const excludedRef = [...document.body.querySelectorAll('*')].filter((el) => ref.some((s) => el.matches(s)));
    const { exclude } = getSiteRules('github.com', { withSources: true });
    const excludedNow = [...document.body.querySelectorAll('*')].filter((el) => exclude.some((s) => el.matches(s)));
    expect(excludedNow).toEqual(excludedRef);
    expect(excludedNow.length).toBeGreaterThan(0);
    // 统计有没有、采到的单元都一样
    const withStats = collect(document.body, undefined, { onSkip: () => {} });
    expect(collect()).toEqual(withStats);
    expect(withStats.map((u) => u.id)).toEqual(['m1', 'm2', 'm3', 'readme-h', 'readme-p', 'note']);
  });
});
