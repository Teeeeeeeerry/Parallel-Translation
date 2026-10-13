/**
 * 控制台按原因分组输出被跳过的单元（#763，规格 #727）
 *
 * 用户报问题时能附上“哪一类跳过占了多少”，比截图有用得多。长页面上逐条
 * 打印会刷屏，所以只输出一行分组计数；零跳过时不输出。
 *
 * 切入点：采集入口 collect 报出跳过，整页翻译的汇总（page-summary）把它
 * 累计成分组计数并给出控制台那一行。只看外部可观察的行为：那一行里有哪些
 * 原因、各是多少、有没有逐条的元素内容、零跳过时有没有输出。
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mockAllBoundingRects, resetStorage } from '../../setup';
import { collect } from '~/src/dom/walker';
import { emptySkipStats, countSkip, skipConsoleLine } from '~/src/orchestration/page-summary';
import { saveUserSiteRules, siteRulesReady } from '~/src/storage/specialization';

const para = (id: string, text: string) => `<p id="${id}">${text}</p>`;
const tooLong = (id: string) => para(id, `Unique${id} ` + 'This sentence keeps going on and on. '.repeat(100));
const tooComplex = (id: string) => para(id, `Unique${id} ` + '<b>w</b> '.repeat(400));

let restore: () => void;
beforeEach(async () => {
  resetStorage();
  await saveUserSiteRules('localhost', {});
  await siteRulesReady();
  restore = mockAllBoundingRects();
});
afterEach(() => {
  restore();
  document.body.innerHTML = '';
});

/** 整页采集一遍，返回控制台那一行（零跳过时为 null）。 */
function consoleLine(): string | null {
  const stats = emptySkipStats();
  collect(document.body, undefined, { onSkip: (_el, category) => countSkip(stats, category) });
  return skipConsoleLine(stats);
}

describe('控制台按原因分组（#763）', () => {
  test('一行里给出总数与每一类的数量', async () => {
    await saveUserSiteRules('localhost', { exclude: ['.ad'] });
    await siteRulesReady();
    document.body.innerHTML =
      para('a', 'A normal paragraph with some words.') +
      tooLong('l1') + tooLong('l2') + tooLong('l3') +
      tooComplex('c1') +
      '<p class="ad" id="ad">Sponsored content from our partners.</p>';
    const line = consoleLine()!;
    expect(line.split('\n')).toHaveLength(1);
    expect(line).toContain('5');
    expect(line).toMatch(/文字超长\D*3/);
    expect(line).toMatch(/标记过密\D*1/);
    expect(line).toMatch(/站点页面规则\D*1/);
    // 没出现的类不列
    expect(line).not.toContain('其他');
  });

  test('不逐条打印元素：两百段超长也只有一行，不含任何一段的文字', () => {
    document.body.innerHTML = Array.from({ length: 200 }, (_, i) => tooLong(`x${i}`)).join('');
    const line = consoleLine()!;
    expect(line.split('\n')).toHaveLength(1);
    expect(line).toMatch(/文字超长\D*200/);
    expect(line).not.toContain('Unique');
    expect(line.length).toBeLessThan(200);
  });

  test('零跳过时不输出', () => {
    document.body.innerHTML = para('a', 'A normal paragraph with some words.') + para('n', '2026-10-13');
    expect(consoleLine()).toBeNull();
  });

  test('非正文区、不可见这些不算跳过的，也不出现在输出里', () => {
    document.body.innerHTML = '<nav>' + tooLong('nav-long') + '</nav>' + para('a', 'A normal paragraph with some words.');
    expect(consoleLine()).toBeNull();
  });
});
